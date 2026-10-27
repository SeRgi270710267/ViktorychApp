"""Add the cookieless Cloudflare Web Analytics beacon when the existing API
token can create the site. A missing analytics permission prints the
dashboard steps and leaves the HTML alone. No new GitHub secret is required.
The beacon token is public; this script does not print it.
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

API = "https://api.cloudflare.com/client/v4"
HOSTS = ("viktorychgroup.github.io", "viktorych-app.pages.dev")


def scrub(text: str) -> str:
    return re.sub(r"[A-Za-z0-9_\-]{20,}", "[redacted]", str(text or ""))[:400]


def analytics_notice() -> str:
    return "\n".join([
        "[analytics] Web Analytics was not added. This is not a new GitHub secret.",
        "[analytics] 1. Open the Cloudflare dashboard → Analytics & logs → Web Analytics → Add a site.",
        "[analytics] 2. Add host viktorych-app.pages.dev. Add viktorychgroup.github.io as a second site if you want the GitHub Pages host too.",
        "[analytics] 3. Choose the JavaScript snippet. Leave it cookieless (the default). There is no DNS change.",
        "[analytics] 4. On the Pages project: Workers & Pages → viktorych-app → Settings → Web Analytics → Enable. That injects the beacon on *.pages.dev.",
        "[analytics] 5. For GitHub Pages, copy the snippet into index.html just before </body>. The token in data-cf-beacon is public. Do not store it as a GitHub secret.",
    ])


def inject(html: str, token: str) -> str:
    if "static.cloudflareinsights.com/beacon.min.js" in html:
        return html
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", token or ""):
        return html
    snippet = (
        "<script defer src=\"https://static.cloudflareinsights.com/beacon.min.js\" "
        "data-cf-beacon='{\"token\":\"%s\"}'></script>" % token
    )
    if "</body>" not in html:
        return html
    return html.replace("</body>", snippet + "\n</body>", 1)


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


def token_of(row: dict) -> str:
    if not isinstance(row, dict):
        return ""
    for key in ("site_token", "siteToken", "token", "beacon_token"):
        value = str(row.get(key) or "")
        if re.fullmatch(r"[A-Za-z0-9_-]{8,128}", value):
            return value
    return ""


def rows_of(payload: dict) -> list:
    result = payload.get("result") if isinstance(payload, dict) else None
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        for key in ("sites", "site_info", "result"):
            value = result.get(key)
            if isinstance(value, list):
                return value
        return [result]
    return []


def site_token(account: str, api_token: str, host: str) -> str:
    status, payload = request("GET", f"{API}/accounts/{account}/rum/site_info/list?per_page=50", api_token)
    if status == 200:
        for row in rows_of(payload):
            if str(row.get("host") or row.get("site") or "") == host:
                found = token_of(row)
                if found:
                    return found
    created, created_body = request("POST", f"{API}/accounts/{account}/rum/site_info", api_token, {"host": host})
    if created not in (200, 201) or not created_body.get("success", True):
        return ""
    result = created_body.get("result")
    if isinstance(result, dict):
        return token_of(result)
    return ""


def apply(site: Path) -> int:
    page = site / "index.html"
    if not page.is_file():
        print("[analytics] index.html is missing; skipping.")
        return 0
    api_token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    account = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    if not api_token or not account:
        print("[analytics] Cloudflare credentials are not set.")
        print(analytics_notice())
        return 0
    found = ""
    for host in HOSTS:
        try:
            found = site_token(account, api_token, host)
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
            found = ""
        if found:
            break
    if not found:
        print(analytics_notice())
        return 0
    page.write_text(inject(page.read_text(encoding="utf-8"), found), encoding="utf-8")
    print("[analytics] cookieless beacon added to the shell")
    return 0


def selftest() -> int:
    html = "<html><body><p>Hi</p></body></html>"
    changed = inject(html, "abcdef1234567890")
    if "beacon.min.js" not in changed or "abcdef1234567890" not in changed:
        return 1
    if inject(changed, "zzzzzzzzzzzzzzzz") != changed:
        return 1
    if inject(html, "bad token") != html:
        return 1
    if "not a new GitHub secret" not in analytics_notice():
        return 1
    long_token = "abcdef1234567890abcd"
    if long_token in scrub("saw " + long_token + " here"):
        return 1
    print("web analytics selftest ok")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        return selftest()
    if not args.site:
        print("pass --site or --selftest")
        return 1
    return apply(Path(args.site))


if __name__ == "__main__":
    raise SystemExit(main())
