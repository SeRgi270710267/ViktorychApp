#!/usr/bin/env python3
"""Delete completed Actions runs and artifacts.

Keeps runs that are still in progress and the latest successful run of each
workflow. Run ids in DROP_RUNS are removed even when they are that latest
success, because their logs matched the private denylist. The older success
is not promoted. Artifacts attached to an in-progress run are kept.

Prints counts only.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

REPO = os.environ.get("REPO") or os.environ.get("GITHUB_REPOSITORY") or ""
# Latest successes whose logs matched the private list. Numeric ids only.
DROP_RUNS = {39525744664, 39685115336}
ACTIVE = {"queued", "in_progress", "waiting", "pending", "requested", "action_required"}


def fail(message: str) -> None:
    print("[actions-cleanup] " + message, flush=True)
    raise SystemExit(1)


def headers() -> dict[str, str]:
    token = (os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or "").strip()
    if not token:
        fail("github token is unset")
    return {
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "User-Agent": "viktorych-actions-cleanup",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def request(method: str, url: str, body: bytes | None = None) -> tuple[int, bytes, str]:
    last = 0
    for attempt in range(8):
        req_headers = headers()
        if body is not None:
            req_headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=body, headers=req_headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return getattr(res, "status", 200), res.read(), res.headers.get("Link") or ""
        except urllib.error.HTTPError as err:
            payload = b""
            try:
                payload = err.read() or b""
            except OSError:
                payload = b""
            last = err.code
            text = payload.lower()
            if err.code == 403 and (b"not accessible" in text or b"must have admin" in text):
                return err.code, payload, ""
            if err.code in {403, 429, 500, 502, 503, 504} and attempt < 7:
                time.sleep(min(60, 2 ** attempt))
                continue
            return err.code, payload, ""
        except urllib.error.URLError:
            if attempt == 7:
                return 0, b"", ""
            time.sleep(min(60, 2 ** attempt))
    return last, b"", ""


def next_link(header: str) -> str:
    for part in (header or "").split(","):
        if 'rel="next"' not in part:
            continue
        url = part.split(";", 1)[0].strip()
        if url.startswith("<") and url.endswith(">"):
            return url[1:-1]
    return ""


def paginate(path: str) -> list:
    url = "https://api.github.com" + path
    rows: list = []
    while url:
        status, payload, link = request("GET", url)
        if status != 200:
            fail(f"list failed ({status})")
        data = json.loads(payload.decode("utf-8"))
        if isinstance(data, list):
            rows.extend(data)
        elif isinstance(data, dict):
            found = None
            for key in ("workflow_runs", "artifacts"):
                if isinstance(data.get(key), list):
                    found = data[key]
                    break
            if found is None:
                fail("list had no rows")
            rows.extend(found)
        else:
            fail("list was empty")
        url = next_link(link)
    return rows


def keep_ids(runs: list) -> set[int]:
    latest: dict[int, dict] = {}
    keep: set[int] = set()
    for run in runs:
        status = run.get("status") or ""
        run_id = int(run.get("id") or 0)
        if status in ACTIVE:
            keep.add(run_id)
            continue
        if status == "completed" and run.get("conclusion") == "success":
            workflow_id = int(run.get("workflow_id") or 0)
            previous = latest.get(workflow_id)
            created = run.get("created_at") or ""
            if previous is None or created > (previous.get("created_at") or ""):
                latest[workflow_id] = run
    for run in latest.values():
        run_id = int(run.get("id") or 0)
        if run_id not in DROP_RUNS:
            keep.add(run_id)
    me = int(os.environ.get("GITHUB_RUN_ID") or 0)
    if me:
        keep.add(me)
    return keep


def main() -> None:
    if not REPO:
        fail("repository is unset")
    runs = paginate(f"/repos/{REPO}/actions/runs?per_page=100")
    artifacts = paginate(f"/repos/{REPO}/actions/artifacts?per_page=100")
    keep = keep_ids(runs)
    active = {int(run.get("id") or 0) for run in runs if (run.get("status") or "") in ACTIVE}
    artifact_delete = []
    artifact_keep = 0
    for artifact in artifacts:
        run = artifact.get("workflow_run") if isinstance(artifact.get("workflow_run"), dict) else {}
        run_id = int(run.get("id") or 0)
        if run_id in active:
            artifact_keep += 1
            continue
        artifact_delete.append(int(artifact.get("id") or 0))
    run_delete = []
    for run in runs:
        run_id = int(run.get("id") or 0)
        if (run.get("status") or "") != "completed":
            continue
        if run_id in keep:
            continue
        run_delete.append(run_id)
    print(
        f"[actions-cleanup] runs_seen={len(runs)} runs_keep={len(keep)} "
        f"runs_delete={len(run_delete)} drop_runs={len(DROP_RUNS)} "
        f"artifacts_seen={len(artifacts)} artifacts_keep={artifact_keep} artifacts_delete={len(artifact_delete)}",
        flush=True,
    )

    deleted_artifacts = 0
    missing_artifacts = 0
    for index, artifact_id in enumerate(artifact_delete, 1):
        status, _body, _link = request(
            "DELETE",
            f"https://api.github.com/repos/{REPO}/actions/artifacts/{artifact_id}",
        )
        if status == 403:
            fail(f"artifact delete forbidden after {deleted_artifacts}")
        if status == 204:
            deleted_artifacts += 1
        elif status == 404:
            missing_artifacts += 1
        else:
            fail(f"artifact delete failed ({status})")
        if index % 25 == 0:
            print(f"[actions-cleanup] artifacts_deleted={deleted_artifacts}", flush=True)

    deleted_runs = 0
    missing_runs = 0
    for index, run_id in enumerate(run_delete, 1):
        status, _body, _link = request(
            "DELETE",
            f"https://api.github.com/repos/{REPO}/actions/runs/{run_id}",
        )
        if status == 403:
            fail(f"run delete forbidden after artifacts_deleted={deleted_artifacts} runs_deleted={deleted_runs}")
        if status == 204:
            deleted_runs += 1
        elif status == 404:
            missing_runs += 1
        else:
            fail(f"run delete failed ({status})")
        if index % 100 == 0:
            print(f"[actions-cleanup] runs_deleted={deleted_runs}", flush=True)
        time.sleep(0.05)

    # Repository retention is an admin setting. Record the status only.
    status, _body, _link = request(
        "PUT",
        f"https://api.github.com/repos/{REPO}/actions/permissions/artifact-and-log-retention",
        json.dumps({"days": 1}).encode("utf-8"),
    )
    print(
        f"[actions-cleanup] artifacts_deleted={deleted_artifacts} artifacts_missing={missing_artifacts} "
        f"artifacts_kept={artifact_keep} runs_deleted={deleted_runs} runs_missing={missing_runs} "
        f"runs_kept={len(keep)} retention_http={status}",
        flush=True,
    )


if __name__ == "__main__":
    main()
