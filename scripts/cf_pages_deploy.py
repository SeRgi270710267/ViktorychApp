"""Deploy the prepared directory to Cloudflare Pages.

A token that cannot edit Pages skips this step. The GitHub Pages deploy is
unchanged. Nothing here prints the API token.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

PROJECT = "viktorych-app"
API = "https://api.cloudflare.com/client/v4"


def scrub(text: str) -> str:
    return re.sub(r"[A-Za-z0-9_\-]{20,}", "[redacted]", str(text or ""))[:400]


def permission_denied(status: int, payload: dict) -> bool:
    if status in (401, 403):
        return True
    for item in payload.get("errors") or []:
        if not isinstance(item, dict):
            continue
        if item.get("code") in (10000, 9106, 9109, 1003):
            return True
        message = str(item.get("message") or "").lower()
        if "permission" in message or "unauthorized" in message or "authentication" in message:
            return True
    return False


def pages_permission_notice() -> str:
    return "\n".join([
        "[pages] CLOUDFLARE_API_TOKEN cannot edit Cloudflare Pages. The mirror was not deployed. GitHub Pages is unchanged.",
        "[pages] This is a permission on the token you already use, not a new secret.",
        "[pages] 1. Open https://dash.cloudflare.com/profile/api-tokens",
        "[pages] 2. Edit the token stored in the GitHub Actions secret CLOUDFLARE_API_TOKEN.",
        "[pages] 3. Add permission: Account → Cloudflare Pages → Edit.",
        "[pages] 4. Account resources: include the same account that owns the viktorych-accounts Worker.",
        "[pages] 5. Continue to summary, then update the token.",
        "[pages] 6. If Cloudflare shows a new token value, replace the existing GitHub secret CLOUDFLARE_API_TOKEN (Settings → Secrets and variables → Actions). Do not add a second secret. If the value did not change, leave the secret as it is.",
        "[pages] 7. Re-run Actions → Sync feeds.",
        "[pages] The project name is viktorych-app. The public URL is https://viktorych-app.pages.dev/",
    ])


def request(method: str, url: str, token: str, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            payload = json.loads(res.read().decode("utf-8"))
            return res.status, payload
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"errors": [{"message": scrub(raw)}]}
        return exc.code, payload


def ensure_project(account: str, token: str) -> str:
    status, payload = request("GET", f"{API}/accounts/{account}/pages/projects/{PROJECT}", token)
    if status == 200 and payload.get("success"):
        return "exists"
    if permission_denied(status, payload):
        return "denied"
    if status != 404:
        print("[pages] project lookup " + scrub(json.dumps(payload.get("errors") or payload)[:300]))
        if permission_denied(status, payload):
            return "denied"
    created, created_body = request("POST", f"{API}/accounts/{account}/pages/projects", token, {
        "name": PROJECT,
        "production_branch": "main",
    })
    if created in (200, 409) or created_body.get("success"):
        print("[pages] project ready: " + PROJECT)
        return "ready"
    if permission_denied(created, created_body):
        return "denied"
    print("[pages] project create failed " + scrub(json.dumps(created_body.get("errors") or created_body)[:300]))
    return "error"


def deploy(directory: Path) -> int:
    token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    account = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    if not token or not account:
        print("[pages] CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set; skipping the Pages mirror.")
        return 0
    if not directory.is_dir():
        print("[pages] mirror directory is missing; skipping.")
        return 0
    state = ensure_project(account, token)
    if state == "denied":
        print(pages_permission_notice())
        return 0
    if state == "error":
        print(pages_permission_notice())
        return 0
    wrangler = shutil.which("npx") or "npx"
    cmd = [
        wrangler, "wrangler", "pages", "deploy", str(directory),
        "--project-name", PROJECT,
        "--branch", "main",
        "--commit-dirty=true",
    ]
    sha = (os.environ.get("GITHUB_SHA") or "").strip()
    if re.fullmatch(r"[0-9a-f]{7,64}", sha):
        cmd.extend(["--commit-hash", sha])
    print("[pages] uploading " + PROJECT)
    proc = subprocess.run(cmd, cwd=str(Path(__file__).resolve().parents[1] / "worker"), env=os.environ.copy(), text=True)
    if proc.returncode == 0:
        print("[pages] mirror URL https://viktorych-app.pages.dev/")
        return 0
    print("[pages] wrangler exited " + str(proc.returncode))
    print(pages_permission_notice())
    return 0


def selftest() -> int:
    if not permission_denied(403, {}):
        return 1
    if not permission_denied(200, {"errors": [{"code": 10000, "message": "Authentication error"}]}):
        return 1
    if permission_denied(404, {"errors": [{"code": 8000007, "message": "Project not found"}]}):
        return 1
    sample = scrub("token " + ("a" * 40) + " ok")
    if "a" * 40 in sample or "[redacted]" not in sample:
        return 1
    notice = pages_permission_notice()
    if "CLOUDFLARE_API_TOKEN" not in notice or "Cloudflare Pages" not in notice or "new secret" not in notice:
        return 1
    print("pages deploy selftest ok")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        return selftest()
    if not args.dir:
        print("pass --dir or --selftest")
        return 1
    return deploy(Path(args.dir))


if __name__ == "__main__":
    raise SystemExit(main())
