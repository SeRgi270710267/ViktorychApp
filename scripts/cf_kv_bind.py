"""Point the runner's wrangler.toml at the viktorych-cache KV namespace.

If the existing API token cannot edit Workers KV, the binding is removed
on this runner only so the Worker still deploys and reads D1 directly.
The committed file is not changed. The token is not printed.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

TITLE = "viktorych-cache"
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


def kv_permission_notice() -> str:
    return "\n".join([
        "[kv] CLOUDFLARE_API_TOKEN cannot edit Workers KV. This deploy will not bind CACHE. Public reads keep using D1.",
        "[kv] This is a permission on the token you already use, not a new secret.",
        "[kv] 1. Open https://dash.cloudflare.com/profile/api-tokens",
        "[kv] 2. Edit the token stored in the GitHub Actions secret CLOUDFLARE_API_TOKEN.",
        "[kv] 3. Add permission: Account → Workers KV Storage → Edit.",
        "[kv] 4. Account resources: include the same account that owns the viktorych-accounts Worker.",
        "[kv] 5. Continue to summary, then update the token.",
        "[kv] 6. If Cloudflare shows a new token value, replace the existing GitHub secret CLOUDFLARE_API_TOKEN. Do not add a second secret.",
        "[kv] 7. Re-run Actions → Accounts.",
    ])


def request(method: str, url: str, token: str, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"errors": [{"message": scrub(raw)}]}
        return exc.code, payload


def strip_binding(text: str) -> str:
    return re.sub(r"\n*\[\[kv_namespaces\]\]\n(?:.*\n)*?binding = \"CACHE\"\n(?:.*\n)*?(?=\n\[|\n#|\Z)", "\n", text)


def write_id(text: str, namespace_id: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{32}", namespace_id):
        raise ValueError("bad namespace id")
    return re.sub(
        r'(binding = "CACHE"\n)id = "[^"]*"',
        r'\1id = "%s"' % namespace_id,
        text,
        count=1,
    )


def find_id(payload: dict) -> str:
    result = payload.get("result")
    rows = result if isinstance(result, list) else []
    if isinstance(result, dict):
        rows = result.get("result") or result.get("namespaces") or []
    for row in rows:
        if isinstance(row, dict) and row.get("title") == TITLE and re.fullmatch(r"[0-9a-f]{32}", str(row.get("id") or "")):
            return str(row["id"])
    return ""


def bind(path: Path) -> int:
    token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    account = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    text = path.read_text(encoding="utf-8")
    if 'binding = "CACHE"' not in text:
        print("[kv] CACHE binding is not in wrangler.toml")
        return 0
    if not token or not account:
        print("[kv] Cloudflare credentials are not set; leaving the placeholder id.")
        return 0
    status, payload = request("GET", f"{API}/accounts/{account}/storage/kv/namespaces?per_page=100", token)
    if permission_denied(status, payload):
        path.write_text(strip_binding(text), encoding="utf-8")
        print(kv_permission_notice())
        return 0
    namespace_id = find_id(payload) if status == 200 else ""
    if not namespace_id:
        created, created_body = request("POST", f"{API}/accounts/{account}/storage/kv/namespaces", token, {"title": TITLE})
        if permission_denied(created, created_body):
            path.write_text(strip_binding(text), encoding="utf-8")
            print(kv_permission_notice())
            return 0
        result = created_body.get("result") if isinstance(created_body, dict) else None
        if isinstance(result, dict):
            namespace_id = str(result.get("id") or "")
        if not namespace_id:
            listed, listed_body = request("GET", f"{API}/accounts/{account}/storage/kv/namespaces?per_page=100", token)
            namespace_id = find_id(listed_body) if listed == 200 else ""
    if not re.fullmatch(r"[0-9a-f]{32}", namespace_id or ""):
        path.write_text(strip_binding(text), encoding="utf-8")
        print("[kv] namespace id was not found; deploying without CACHE.")
        print(scrub(json.dumps((payload.get("errors") if isinstance(payload, dict) else []) or [])[:240]))
        return 0
    path.write_text(write_id(text, namespace_id), encoding="utf-8")
    print("[kv] CACHE bound on the runner")
    return 0


def selftest() -> int:
    sample = '''
[[kv_namespaces]]
binding = "CACHE"
id = "00000000-0000-0000-0000-000000000002"

[triggers]
crons = ["* * * * *"]
'''
    stripped = strip_binding(sample)
    if 'binding = "CACHE"' in stripped:
        print("binding was not removed")
        return 1
    if 'crons = ["* * * * *"]' not in stripped:
        print("cron line was removed")
        return 1
    written = write_id('binding = "CACHE"\nid = "placeholder"\n', "ab" * 16)
    if 'id = "' + ("ab" * 16) + '"' not in written:
        print("id was not written")
        return 1
    if not permission_denied(401, {}):
        return 1
    notice = kv_permission_notice()
    if "Workers KV Storage" not in notice or "not a new secret" not in notice:
        return 1
    if find_id({"result": [{"title": TITLE, "id": "cd" * 16}]}) != "cd" * 16:
        return 1
    print("kv bind selftest ok")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--toml")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        return selftest()
    if not args.toml:
        print("pass --toml or --selftest")
        return 1
    return bind(Path(args.toml))


if __name__ == "__main__":
    try:
        from log_redact import auto as _redact_logs

        _redact_logs()
    except ImportError:
        pass
    raise SystemExit(main())
