#!/usr/bin/env python3
"""Manual full backup of this repository.

Builds a git bundle of every branch and tag, a JSON export of pull request
titles, bodies, and comments, and Actions artifact metadata. Uploads that
archive to the private R2 bucket under backups/github/<UTC date>/. Encrypts
it with KEYS_ENC_KEY when that secret is set. Prints sizes and counts only.
Never uploads an Actions artifact.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BUCKET = "viktorych-data"
API_BASE = "https://api.cloudflare.com/client/v4"
MAGIC = b"VAENC1\x00\x01"
AAD = b"backup-full"
UA = "viktorych-backup-full"
MAX_ARCHIVE = 512 * 1024 * 1024


def scrub(text: str) -> str:
    cleaned = str(text or "")
    for name in ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "KEYS_ENC_KEY", "GH_TOKEN", "GITHUB_TOKEN"):
        value = os.environ.get(name) or ""
        if len(value) >= 6:
            cleaned = cleaned.replace(value, "***")
    return cleaned


def fail(message: str, code: int = 1) -> None:
    print("[backup-full] " + scrub(message), flush=True)
    raise SystemExit(code)


def run(cmd: list[str], cwd: str | None = None) -> str:
    proc = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        err = scrub(proc.stderr.decode("utf-8", "replace"))[-240:].replace("\n", " ")
        fail(f"command failed ({proc.returncode}) {err}".rstrip())
    return proc.stdout.decode("utf-8", "replace")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def object_url(account: str, key: str, base: str = API_BASE) -> str:
    quoted = urllib.parse.quote(key, safe="/")
    return f"{base}/accounts/{account}/r2/buckets/{BUCKET}/objects/{quoted}"


def github_headers() -> dict[str, str]:
    token = (os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or "").strip()
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": UA,
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = "Bearer " + token
    return headers


def next_link(header: str) -> str:
    for part in (header or "").split(","):
        if 'rel="next"' not in part:
            continue
        url = part.split(";", 1)[0].strip()
        if url.startswith("<") and url.endswith(">"):
            return url[1:-1]
    return ""


def github_json(url: str) -> tuple[object, str, dict[str, str]]:
    last = "github request failed"
    for attempt in range(6):
        req = urllib.request.Request(url, headers=github_headers())
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                payload = json.loads(res.read().decode("utf-8"))
                time.sleep(0.12)
                return payload, res.headers.get("Link") or "", dict(res.headers)
        except urllib.error.HTTPError as err:
            last = f"github http {err.code}"
            if err.code not in {403, 429, 500, 502, 503, 504} or attempt == 5:
                fail(last)
            time.sleep(min(60, 2 ** attempt))
        except urllib.error.URLError:
            last = "github network error"
            if attempt == 5:
                fail(last)
            time.sleep(min(60, 2 ** attempt))
        time.sleep(0.15)
    fail(last)
    return None, "", {}


def paginate(path: str) -> list:
    url = "https://api.github.com" + path
    rows: list = []
    while url:
        payload, link, _headers = github_json(url)
        if isinstance(payload, list):
            rows.extend(payload)
        elif isinstance(payload, dict):
            found = None
            for key in ("artifacts", "workflow_runs", "items"):
                if isinstance(payload.get(key), list):
                    found = payload[key]
                    break
            if found is None:
                fail("github list had no rows")
            rows.extend(found)
        else:
            fail("github list was empty")
        url = next_link(link)
    return rows


def slim_comment(row: dict) -> dict:
    user = row.get("user") if isinstance(row.get("user"), dict) else {}
    return {
        "id": row.get("id"),
        "body": row.get("body") or "",
        "created_at": row.get("created_at") or "",
        "updated_at": row.get("updated_at") or "",
        "user_login": user.get("login") or "",
        "path": row.get("path") or "",
        "line": row.get("line"),
    }


def export_pulls(repo: str) -> tuple[dict, dict]:
    pulls = paginate(f"/repos/{repo}/pulls?state=all&per_page=100")
    exported = []
    comments = review_comments = reviews = 0
    for pull in pulls:
        if not isinstance(pull, dict):
            continue
        number = pull.get("number")
        user = pull.get("user") if isinstance(pull.get("user"), dict) else {}
        issue_comments = paginate(f"/repos/{repo}/issues/{number}/comments?per_page=100") if number else []
        pull_comments = paginate(f"/repos/{repo}/pulls/{number}/comments?per_page=100") if number else []
        pull_reviews = paginate(f"/repos/{repo}/pulls/{number}/reviews?per_page=100") if number else []
        comments += len(issue_comments)
        review_comments += len(pull_comments)
        reviews += len(pull_reviews)
        exported.append({
            "number": number,
            "title": pull.get("title") or "",
            "body": pull.get("body") or "",
            "state": pull.get("state") or "",
            "created_at": pull.get("created_at") or "",
            "updated_at": pull.get("updated_at") or "",
            "merged_at": pull.get("merged_at") or "",
            "user_login": user.get("login") or "",
            "comments": [slim_comment(row) for row in issue_comments if isinstance(row, dict)],
            "review_comments": [slim_comment(row) for row in pull_comments if isinstance(row, dict)],
            "reviews": [slim_comment(row) for row in pull_reviews if isinstance(row, dict)],
        })
    counts = {
        "pulls": len(exported),
        "comments": comments,
        "review_comments": review_comments,
        "reviews": reviews,
    }
    return {"pulls": exported}, counts


def export_artifacts(repo: str) -> tuple[dict, dict]:
    rows = paginate(f"/repos/{repo}/actions/artifacts?per_page=100")
    artifacts = []
    total = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        run = row.get("workflow_run") if isinstance(row.get("workflow_run"), dict) else {}
        size = int(row.get("size_in_bytes") or 0)
        total += size
        artifacts.append({
            "id": row.get("id"),
            "name": row.get("name") or "",
            "size_in_bytes": size,
            "created_at": row.get("created_at") or "",
            "updated_at": row.get("updated_at") or "",
            "expires_at": row.get("expires_at") or "",
            "expired": bool(row.get("expired")),
            "digest": row.get("digest") or "",
            "workflow_run": {
                "id": run.get("id"),
                "head_branch": run.get("head_branch") or "",
                "head_sha": run.get("head_sha") or "",
                "event": run.get("event") or "",
                "status": run.get("status") or "",
                "conclusion": run.get("conclusion") or "",
            },
        })
    counts = {"artifacts": len(artifacts), "artifact_bytes": total}
    return {"artifacts": artifacts}, counts


def clone_mirror(repo: str, dest: Path) -> None:
    url = f"https://github.com/{repo}.git"
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    # The checkout action stores an Authorization header globally. Clearing
    # it for this command lets the public mirror clone run on its own.
    cmd = [
        "git",
        "-c",
        "credential.helper=",
        "-c",
        "http.https://github.com/.extraheader=",
        "clone",
        "--mirror",
        "--",
        url,
        str(dest),
    ]
    print("[backup-full] clone_start", flush=True)
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    if proc.returncode != 0:
        err = scrub(proc.stderr.decode("utf-8", "replace"))
        err = re.sub(r"(?i)authorization:\s*\S+", "authorization: ***", err)
        err = re.sub(r"\s+", " ", err).strip()[-180:]
        fail(f"mirror clone failed ({proc.returncode}) {err}".rstrip())


def ref_names(text: str) -> list[str]:
    names = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 2:
            names.append(parts[1])
        elif len(parts) == 1 and parts[0].startswith("refs/"):
            names.append(parts[0])
    return names


def make_bundle(mirror: Path, dest: Path) -> dict:
    run(["git", "-C", str(mirror), "bundle", "create", str(dest), "--all"])
    run(["git", "-C", str(mirror), "bundle", "verify", str(dest)])
    mirror_refs = ref_names(run(["git", "-C", str(mirror), "show-ref"]))
    bundle_refs = ref_names(run(["git", "bundle", "list-heads", str(dest)]))
    missing = set(mirror_refs) - set(bundle_refs)
    extra = set(bundle_refs) - set(mirror_refs) - {"HEAD"}
    if missing or extra:
        fail(f"bundle ref mismatch missing={len(missing)} extra={len(extra)}")
    branches = [name for name in mirror_refs if name.startswith("refs/heads/")]
    tags = [name for name in mirror_refs if name.startswith("refs/tags/")]
    if "refs/heads/data" not in branches:
        fail("data branch missing from bundle")
    return {
        "refs": len(mirror_refs),
        "branches": len(branches),
        "tags": len(tags),
        "data_branch": 1,
        "bundle_bytes": dest.stat().st_size,
    }


def write_tar(path: Path, files: dict[str, Path]) -> None:
    with tarfile.open(path, "w:gz") as archive:
        for name, source in files.items():
            archive.add(source, arcname=name)


def node_crypt(mode: str, source: Path, dest: Path) -> None:
    script = r"""
const crypto = require("crypto");
const fs = require("fs");
const secret = String(process.env.KEYS_ENC_KEY || "").trim();
const mode = process.argv[1];
const source = process.argv[2];
const dest = process.argv[3];
const magic = Buffer.from([0x56, 0x41, 0x45, 0x4e, 0x43, 0x31, 0x00, 0x01]);
const aad = Buffer.from("backup-full");
function rawKey(text) {
  if (!text) return null;
  try {
    const decoded = Buffer.from(text, "base64");
    if (decoded.length === 32 && decoded.toString("base64").replace(/=+$/, "") === text.replace(/=+$/, "")) return decoded;
  } catch (err) {}
  return crypto.createHash("sha256").update(text).digest();
}
const key = rawKey(secret);
if (!key) process.exit(2);
const input = fs.readFileSync(source);
if (mode === "enc") {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(input), cipher.final(), cipher.getAuthTag()]);
  fs.writeFileSync(dest, Buffer.concat([magic, iv, body]));
} else {
  if (input.length < 8 + 12 + 16 || !input.subarray(0, 8).equals(magic)) process.exit(3);
  const iv = input.subarray(8, 20);
  const tag = input.subarray(input.length - 16);
  const data = input.subarray(20, input.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  fs.writeFileSync(dest, Buffer.concat([decipher.update(data), decipher.final()]));
}
"""
    proc = subprocess.run(
        ["node", "-e", script, mode, str(source), str(dest)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=os.environ.copy(),
    )
    if proc.returncode != 0:
        fail(f"encrypt failed ({proc.returncode})")


def r2_call(method: str, account: str, token: str, key: str, body: bytes | None = None, base: str = API_BASE) -> tuple[int, bytes, dict[str, str]]:
    url = object_url(account, key, base)
    headers = {"Authorization": "Bearer " + token, "User-Agent": UA}
    data = body
    if body is not None:
        headers["Content-Type"] = "application/octet-stream"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=600) as res:
            return getattr(res, "status", 200), res.read(), dict(res.headers)
    except urllib.error.HTTPError as err:
        try:
            payload = err.read() or b""
        except OSError:
            payload = b""
        return err.code, payload, dict(getattr(err, "headers", {}) or {})


def upload_verified(account: str, token: str, key: str, path: Path, base: str = API_BASE) -> int:
    payload = path.read_bytes()
    status, _body, _headers = r2_call("PUT", account, token, key, payload, base)
    if status not in {200, 201, 204}:
        fail(f"r2 put failed ({status})")
    status, downloaded, headers = r2_call("GET", account, token, key, None, base)
    if status != 200:
        fail(f"r2 get failed ({status})")
    length = int(headers.get("Content-Length") or headers.get("content-length") or len(downloaded))
    if length != len(payload) or len(downloaded) != len(payload):
        fail(f"r2 size mismatch local={len(payload)} remote={len(downloaded)} header={length}")
    if hashlib.sha256(downloaded).hexdigest() != hashlib.sha256(payload).hexdigest():
        fail("r2 hash mismatch")
    return len(downloaded)


def backup(work: Path) -> dict:
    repo = (os.environ.get("REPO") or os.environ.get("GITHUB_REPOSITORY") or "").strip()
    account = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    if not repo:
        fail("repository is unset")
    if not account or not token:
        fail("r2 credentials are unset")
    mirror = work / "mirror.git"
    bundle = work / "repo.bundle"
    clone_mirror(repo, mirror)
    counts = make_bundle(mirror, bundle)
    print(
        "[backup-full] "
        f"branches={counts['branches']} tags={counts['tags']} data_branch={counts['data_branch']} "
        f"bundle_bytes={counts['bundle_bytes']}",
        flush=True,
    )
    pulls, pull_counts = export_pulls(repo)
    artifacts, artifact_counts = export_artifacts(repo)
    counts.update(pull_counts)
    counts.update(artifact_counts)
    pulls_path = work / "pulls.json"
    artifacts_path = work / "artifacts.json"
    pulls_path.write_text(json.dumps(pulls, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    artifacts_path.write_text(json.dumps(artifacts, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    archive = work / "full.tar.gz"
    write_tar(archive, {
        "repo.bundle": bundle,
        "pulls.json": pulls_path,
        "artifacts.json": artifacts_path,
    })
    counts["archive_bytes"] = archive.stat().st_size
    if counts["archive_bytes"] > MAX_ARCHIVE:
        fail(f"archive too large bytes={counts['archive_bytes']}")
    key_material = (os.environ.get("KEYS_ENC_KEY") or "").strip()
    upload_path = archive
    encrypted = False
    if key_material:
        sealed = work / "full.bin"
        node_crypt("enc", archive, sealed)
        upload_path = sealed
        encrypted = True
        # The plaintext archive is no longer needed on the runner.
        archive.unlink()
        pulls_path.unlink()
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    prefix = f"backups/github/{day}/"
    object_name = prefix + ("full.bin" if encrypted else "full.tar.gz")
    remote_bytes = upload_verified(account, token, object_name, upload_path)
    manifest = {
        "version": 1,
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bucket": BUCKET,
        "prefix": prefix,
        "object": object_name,
        "encrypted": encrypted,
        "algorithm": "AES-256-GCM" if encrypted else "",
        "aad": "backup-full" if encrypted else "",
        "key_source": "KEYS_ENC_KEY" if encrypted else "",
        "layout": "8-byte magic VAENC1 NUL SOH, 12-byte iv, ciphertext, 16-byte tag" if encrypted else "gzip tar: repo.bundle, pulls.json, artifacts.json",
        "object_bytes": remote_bytes,
        "object_sha256": sha256_file(upload_path),
        "counts": counts,
    }
    manifest_path = work / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
    manifest_key = prefix + "manifest.json"
    manifest_bytes = upload_verified(account, token, manifest_key, manifest_path)
    print(
        "[backup-full] "
        f"branches={counts['branches']} tags={counts['tags']} data_branch={counts['data_branch']} "
        f"refs={counts['refs']} bundle_bytes={counts['bundle_bytes']}",
        flush=True,
    )
    print(
        "[backup-full] "
        f"pulls={counts['pulls']} comments={counts['comments']} "
        f"review_comments={counts['review_comments']} reviews={counts['reviews']}",
        flush=True,
    )
    print(
        "[backup-full] "
        f"artifacts={counts['artifacts']} artifact_bytes={counts['artifact_bytes']} "
        f"archive_bytes={counts['archive_bytes']} encrypted={1 if encrypted else 0}",
        flush=True,
    )
    print(
        "[backup-full] "
        f"object={object_name} bytes={remote_bytes} manifest={manifest_key} manifest_bytes={manifest_bytes} verified=1",
        flush=True,
    )
    return manifest


def selftest() -> None:
    work = Path(tempfile.mkdtemp(prefix="backup-full-test-"))
    try:
        repo = work / "src"
        repo.mkdir()
        run(["git", "init", "-q", "-b", "main", str(repo)])
        run(["git", "-C", str(repo), "config", "user.email", "backup@example.com"])
        run(["git", "-C", str(repo), "config", "user.name", "backup"])
        (repo / "readme.txt").write_text("hello\n", encoding="utf-8")
        run(["git", "-C", str(repo), "add", "readme.txt"])
        run(["git", "-C", str(repo), "commit", "-q", "-m", "init"])
        run(["git", "-C", str(repo), "branch", "data"])
        run(["git", "-C", str(repo), "tag", "v0"])
        mirror = work / "mirror.git"
        run(["git", "clone", "--mirror", "--", str(repo), str(mirror)])
        bundle = work / "repo.bundle"
        counts = make_bundle(mirror, bundle)
        assert counts["branches"] == 2, counts
        assert counts["tags"] == 1, counts
        assert counts["data_branch"] == 1
        assert counts["bundle_bytes"] > 0
        archive = work / "full.tar.gz"
        note = work / "pulls.json"
        note.write_text('{"pulls":[]}', encoding="utf-8")
        write_tar(archive, {"repo.bundle": bundle, "pulls.json": note, "artifacts.json": note})
        os.environ["KEYS_ENC_KEY"] = "test-key-material"
        sealed = work / "full.bin"
        node_crypt("enc", archive, sealed)
        opened = work / "opened.tar.gz"
        node_crypt("dec", sealed, opened)
        assert opened.read_bytes() == archive.read_bytes()
        raw = bytes(range(32))
        os.environ["KEYS_ENC_KEY"] = __import__("base64").b64encode(raw).decode()
        sealed2 = work / "full2.bin"
        node_crypt("enc", archive, sealed2)
        opened2 = work / "opened2.tar.gz"
        node_crypt("dec", sealed2, opened2)
        assert opened2.read_bytes() == archive.read_bytes()
        assert scrub("token " + os.environ["KEYS_ENC_KEY"]) == "token ***"
        assert object_url("acct", "backups/github/2026-10-27/full.bin", "http://r2.local") == (
            "http://r2.local/accounts/acct/r2/buckets/viktorych-data/objects/backups/github/2026-10-27/full.bin"
        )

        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        import threading

        store: dict[str, bytes] = {}

        class Handler(BaseHTTPRequestHandler):
            def do_PUT(self):  # noqa: N802
                length = int(self.headers.get("Content-Length") or 0)
                store[self.path] = self.rfile.read(length)
                self.send_response(200)
                self.end_headers()

            def do_GET(self):  # noqa: N802
                body = store.get(self.path)
                if body is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                if self.path.endswith("/corrupt.bin"):
                    body = b"xx" + body
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, fmt, *args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        host, port = server.server_address
        base = f"http://{host}:{port}"
        sample = work / "sample.bin"
        sample.write_bytes(b"abc123")
        size = upload_verified("acct", "token", "backups/github/2026-10-27/full.bin", sample, base)
        assert size == 6
        try:
            upload_verified("acct", "token", "backups/github/2026-10-27/corrupt.bin", sample, base)
        except SystemExit as err:
            assert err.code == 1
        else:
            raise AssertionError("size mismatch was accepted")
        server.shutdown()
        print("[backup-full] selftest ok", flush=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)
        os.environ.pop("KEYS_ENC_KEY", None)


def main() -> None:
    if "--selftest" in sys.argv:
        selftest()
        return
    work = Path(tempfile.mkdtemp(prefix="backup-full-"))
    try:
        backup(work)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    try:
        from log_redact import auto as _redact_logs

        _redact_logs()
    except ImportError:
        pass
    main()
