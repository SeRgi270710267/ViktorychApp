#!/usr/bin/env python3
"""Publish app data to private R2 and turn on the login wall.

The committed site stays public. This runs against the Pages artifact.
It does nothing until the account Worker answers /v1/health with
ready and data. A failed check leaves the artifact unchanged.

Once ACCOUNTS_API or a Cloudflare credential is set, that failure exits
non-zero. The Pages deploy is skipped and the previous site stays up.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DATA_KEY = re.compile(
    r"^(?:feeds|stories|people|suggestions|status|feeds\.config)\.json$"
    r"|^data/music\.json$"
    r"|^(?:live|archive|comments|fallback)/[A-Za-z0-9._-]{1,120}\.json$"
    r"|^discord/(?:index|state)\.json$"
    r"|^discord/(?:messages|pins)/\d{1,22}\.json$"
    r"|^data/communities/(?:index|[a-z0-9_]{2,21})\.json$"
)
SKIP_KEYS = {"archive/ia-state.json", "archive/ia-manifest.json"}
SKIP_DIRS = {".git", "node_modules", "worker", "_site", "scripts", ".github", ".wrangler"}
# A worker deploy plus secret updates can take several minutes. 24 tries
# at 15s is long enough to outlast that and still fail the deploy afterwards.
DEFAULT_HEALTH_ATTEMPTS = 24
DEFAULT_HEALTH_INTERVAL = 15.0
DROP_FILES = (
    "feeds.json",
    "stories.json",
    "people.json",
    "suggestions.json",
    "feeds.config.json",
    "status.json",
    "data/music.json",
)
DROP_DIRS = ("live", "archive", "comments", "fallback", "discord", "s", "u")


def _token() -> str:
    return (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()


def _account() -> str:
    return (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()


def _request(url: str, data: bytes | None = None, method: str | None = None) -> dict:
    headers = {"Authorization": "Bearer " + _token()}
    if data is not None:
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=120) as res:
        raw = res.read()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def workers_api() -> str:
    override = (os.environ.get("ACCOUNTS_API") or "").strip().rstrip("/")
    if override:
        return override
    account = _account()
    body = _request(f"https://api.cloudflare.com/client/v4/accounts/{account}/workers/subdomain")
    sub = str((body.get("result") or {}).get("subdomain") or "").strip()
    if not sub:
        return ""
    return f"https://viktorych-accounts.{sub}.workers.dev"


def fetch_health(api: str) -> dict | None:
    try:
        req = urllib.request.Request(
            api.rstrip("/") + "/v1/health",
            headers={"User-Agent": "viktorych-accounts-publish"},
        )
        with urllib.request.urlopen(req, timeout=20) as res:
            if res.status != 200:
                return None
            body = json.loads(res.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None
    return body if isinstance(body, dict) else None


def health_attempts() -> int:
    raw = (os.environ.get("ACCOUNTS_HEALTH_ATTEMPTS") or "").strip()
    if raw.isdigit() and int(raw) > 0:
        return int(raw)
    return DEFAULT_HEALTH_ATTEMPTS


def health_interval() -> float:
    raw = (os.environ.get("ACCOUNTS_HEALTH_INTERVAL") or "").strip()
    if not raw:
        return DEFAULT_HEALTH_INTERVAL
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_HEALTH_INTERVAL
    return value if value >= 0 else DEFAULT_HEALTH_INTERVAL


def wait_ready(api: str) -> dict | None:
    attempts = health_attempts()
    pause = health_interval()
    for attempt in range(attempts):
        health = fetch_health(api)
        if health and health.get("ready") and health.get("data"):
            return health
        if attempt + 1 < attempts and pause:
            time.sleep(pause)
    return None


def configured() -> bool:
    """True when this site already has an accounts API, so an open shell is a regression."""
    if (os.environ.get("ACCOUNTS_API") or "").strip():
        return True
    return bool(_token() or _account())


def unlocked(reason: str) -> int:
    if configured():
        print(f"{reason} Refusing to publish without the login wall.")
        return 1
    print(f"{reason} publishing the public site.")
    return 0


def collect(root: Path) -> dict[str, Path]:
    found: dict[str, Path] = {}
    if not root.is_dir():
        return found
    for path in root.rglob("*.json"):
        if not path.is_file() or path.is_symlink():
            continue
        rel = path.relative_to(root)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        key = rel.as_posix()
        if key in SKIP_KEYS or not DATA_KEY.match(key):
            continue
        found[key] = path
    return found


def upload(key: str, payload: bytes) -> None:
    account = _account()
    quoted = urllib.parse.quote(key, safe="/")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/viktorych-data/objects/{quoted}"
    _request(url, payload, "PUT")


def _js_string(text: str, name: str) -> str:
    found = re.search(rf'["\']?{name}["\']?\s*:\s*"([^"]*)"', text)
    return found.group(1) if found else ""


def read_gate(site: Path) -> dict:
    path = site / "accounts.config.js"
    text = path.read_text(encoding="utf-8") if path.is_file() else ""
    # Both shapes count: `gate: true` and the older `"gate": true`.
    gate = re.search(r'["\']?gate["\']?\s*:\s*true\b', text) is not None
    return {
        "api": _js_string(text, "api"),
        "gate": gate,
        "turnstileSiteKey": _js_string(text, "turnstileSiteKey"),
    }


def read_audience(site: Path) -> str:
    path = site / "accounts.config.js"
    text = path.read_text(encoding="utf-8") if path.is_file() else ""
    found = re.search(r'["\']?tiktokAudience["\']?\s*:\s*"([^"]*)"', text)
    if found and found.group(1) in ("owner", "all"):
        return found.group(1)
    return "owner"


def lock_shell(site: Path, api: str, turnstile: str) -> None:
    config = site / "accounts.config.js"
    audience = read_audience(site)
    # JS object, not JSON. `gate: true` is what a publisher already in
    # progress looks for when it keeps the wall across a refresh.
    config.write_text(
        "window.VIKTORYCH_ACCOUNTS = {\n"
        f"  api: {json.dumps(api, ensure_ascii=True)},\n"
        "  gate: true,\n"
        f"  turnstileSiteKey: {json.dumps(turnstile, ensure_ascii=True)},\n"
        f"  tiktokAudience: {json.dumps(audience, ensure_ascii=True)},\n"
        "};\n",
        encoding="utf-8",
    )
    worker = site / "sw.js"
    if worker.is_file():
        text = worker.read_text(encoding="utf-8")
        text = text.replace("const ACCOUNTS_WALL = false;", "const ACCOUNTS_WALL = true;")
        worker.write_text(text, encoding="utf-8")
    index = site / "index.html"
    if index.is_file():
        html = index.read_text(encoding="utf-8")
        html = re.sub(r'(<meta name="description" content=")[^"]*(")', r"\1ViktorychApp\2", html, count=1)
        html = re.sub(r'(<meta property="og:description" content=")[^"]*(")', r"\1ViktorychApp\2", html, count=1)
        html = re.sub(r'(<meta name="twitter:description" content=")[^"]*(")', r"\1ViktorychApp\2", html, count=1)
        html = re.sub(r'\n?  <link rel="preload" href="feeds\.json"[^>]*>', "", html, count=1)
        index.write_text(html, encoding="utf-8")
    (site / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")


def strip(site: Path) -> None:
    for name in DROP_FILES:
        path = site / name
        if path.is_file():
            path.unlink()
    communities = site / "data" / "communities"
    if communities.is_dir():
        for path in sorted(communities.rglob("*"), reverse=True):
            if path.is_file() or path.is_symlink():
                path.unlink()
            elif path.is_dir():
                path.rmdir()
        communities.rmdir()
    music_dir = site / "data"
    if music_dir.is_dir() and not any(music_dir.iterdir()):
        music_dir.rmdir()
    for name in DROP_DIRS:
        folder = site / name
        if not folder.is_dir():
            continue
        for path in sorted(folder.rglob("*"), reverse=True):
            if path.is_file() or path.is_symlink():
                path.unlink()
            elif path.is_dir():
                path.rmdir()
        folder.rmdir()
    card = site / "icons" / "og-card.png"
    if card.is_file():
        card.unlink()
    leaked = site / "owner" / "tiktok.json"
    if leaked.is_file():
        leaked.unlink()
    owner_dir = site / "owner"
    if owner_dir.is_dir() and not any(owner_dir.iterdir()):
        owner_dir.rmdir()


def mark_wall() -> None:
    folder = Path("accounts-wall")
    folder.mkdir(exist_ok=True)
    (folder / "on").write_text("1\n", encoding="utf-8")


def publish(site: Path, source: Path) -> int:
    if not _token() or not _account():
        return unlocked("Cloudflare credentials are not set;")
    try:
        api = workers_api()
    except (urllib.error.URLError, TimeoutError, OSError):
        return unlocked("accounts API URL is unknown;")
    if not api:
        return unlocked("accounts API URL is unknown;")
    if not wait_ready(api):
        return unlocked("accounts API is not ready;")
    files = collect(source)
    if "feeds.json" not in files:
        return unlocked("feeds.json is missing;")
    try:
        for key in sorted(files):
            upload(key, files[key].read_bytes())
        owner = source / "owner" / "tiktok.json"
        if owner.is_file():
            upload("owner/tiktok.json", owner.read_bytes())
    except (urllib.error.URLError, TimeoutError, OSError):
        return unlocked("data upload failed;")
    turnstile = (os.environ.get("TURNSTILE_SITEKEY") or "").strip()
    lock_shell(site, api, turnstile)
    strip(site)
    mark_wall()
    print("login wall on; app data is served to signed-in sessions")
    return 0


def repair(site: Path, prior: dict) -> int:
    token = _token()
    account = _account()
    if token and account and prior.get("api"):
        health = fetch_health(str(prior["api"]))
        if health and health.get("ready") and health.get("data"):
            try:
                for key, path in sorted(collect(site).items()):
                    if key.startswith("discord/"):
                        upload(key, path.read_bytes())
            except (urllib.error.URLError, TimeoutError, OSError):
                print("discord data stayed on the previous private copy")
    lock_shell(site, str(prior.get("api") or ""), str(prior.get("turnstileSiteKey") or ""))
    strip(site)
    print("login wall kept; app data was not added to Pages")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", default="_site")
    parser.add_argument("--source", default=".")
    parser.add_argument("--repair", action="store_true")
    args = parser.parse_args()
    site = Path(args.site)
    if args.repair:
        prior = read_gate(site)
        if not prior["gate"]:
            print("login wall is off; leaving this deploy public")
            return 0
        return repair(site, prior)
    return publish(site, Path(args.source))


if __name__ == "__main__":
    sys.exit(main())
