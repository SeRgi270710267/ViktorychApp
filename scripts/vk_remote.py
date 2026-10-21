"""Read a public VK wall during sync.

wall.get requires a token. When VK_SERVICE_TOKEN is set, that token is used.
Otherwise the sync reads the anonymous client id and secret that vk.com ships
in its own public JavaScript, exchanges them for a short-lived anonymous
token, and calls the API. The token stays in this process. It is not written
into the site, the repository, or the browser.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
API = "https://api.vk.com/method/"
CORE_RE = re.compile(r"https://[^\"'\s]+core_spa_vk[^\"'\s]+\.js")
CLIENT_RE = re.compile(
    r"\{clientSecret:\w+,clientId:\w+,authClientId:\w+\}\s*=\s*\(\w+=(\d+),\w+=\"([A-Za-z0-9]{8,})\""
)
VERSION_RE = re.compile(r'mG:"(\d+\.\d+)"')

_CLIENT: tuple[str, str, str] | None = None
_ANON: str | None = None


def _redact(text: str) -> str:
    text = re.sub(r"(client_secret|access_token)=[^&\s]+", r"\1=redacted", text or "")
    return text[:300]


def _get(url: str, timeout: int = 25) -> tuple[int, bytes]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "*/*",
            "Accept-Language": "en",
            "Cookie": "remixlang=3",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return getattr(response, "status", 200) or 200, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def parse_web_client(script: str) -> tuple[str, str, str] | None:
    """Pull the public web client's id, secret, and API version from its bundle."""
    if not script:
        return None
    found = CLIENT_RE.search(script)
    version = VERSION_RE.search(script)
    if not found or not version:
        return None
    return found.group(1), found.group(2), version.group(1)


def _page_script(domain: str) -> str:
    pages = [
        f"https://vk.com/{urllib.parse.quote(domain)}",
        "https://vk.com/feed",
        f"https://m.vk.com/{urllib.parse.quote(domain)}",
    ]
    for page in pages:
        status, body = _get(page, timeout=20)
        if status != 200 or not body:
            continue
        html = body.decode("utf-8", "replace")
        match = CORE_RE.search(html)
        if not match and "windows-1251" in html[:400].lower():
            html = body.decode("windows-1251", "replace")
            match = CORE_RE.search(html)
        if not match:
            continue
        status, script = _get(match.group(0), timeout=40)
        if status == 200 and script:
            return script.decode("utf-8", "replace")
    return ""


def web_client() -> tuple[str, str, str]:
    global _CLIENT
    if _CLIENT:
        return _CLIENT
    parsed = parse_web_client(_page_script("vk"))
    if not parsed:
        raise ValueError("vk.com did not publish its web client credentials")
    _CLIENT = parsed
    return parsed


def _anonymous_token() -> str:
    global _ANON
    if _ANON:
        return _ANON
    client_id, client_secret, version = web_client()
    query = urllib.parse.urlencode(
        {"client_id": client_id, "client_secret": client_secret, "v": version}
    )
    status, body = _get(API + "auth.getAnonymToken?" + query, timeout=20)
    try:
        payload = json.loads(body.decode("utf-8", "replace"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"anonymous token was not JSON (HTTP {status})") from exc
    token = ((payload.get("response") or {}) if isinstance(payload, dict) else {}).get("token") or ""
    if not token:
        error = payload.get("error") if isinstance(payload, dict) else {}
        message = error.get("error_msg") if isinstance(error, dict) else "no token"
        raise ValueError(f"anonymous token failed: {message}")
    _ANON = token
    return token


def api(method: str, **params) -> dict:
    """Call one VK method. A service token is tried first when it is configured."""
    service = (os.environ.get("VK_SERVICE_TOKEN") or "").strip()
    errors = []
    tokens = []
    if service:
        tokens.append(service)
    try:
        tokens.append(_anonymous_token())
    except ValueError as exc:
        if not service:
            raise
        errors.append(str(exc))
    version = "5.199"
    if _CLIENT:
        version = _CLIENT[2]
    last = "no token"
    for token in tokens:
        query = dict(params)
        query["access_token"] = token
        query["v"] = version
        url = API + method + "?" + urllib.parse.urlencode(query)
        status, body = _get(url, timeout=25)
        try:
            payload = json.loads(body.decode("utf-8", "replace"))
        except json.JSONDecodeError:
            last = f"HTTP {status} was not JSON"
            continue
        if not isinstance(payload, dict):
            last = "response was not an object"
            continue
        error = payload.get("error")
        if isinstance(error, dict):
            last = error.get("error_msg") or f"error {error.get('error_code')}"
            continue
        return payload
    raise ValueError(_redact(f"{method} failed: {last}"))


def wall_document(domain: str, count: int = 8) -> dict:
    """wall.get plus the community profile, as one JSON document."""
    domain = (domain or "").strip().lstrip("@")
    if not domain:
        raise ValueError("vk handle is empty")
    wall = api("wall.get", domain=domain, count=max(1, min(int(count or 8), 20)), extended=1)
    response = wall.get("response") if isinstance(wall, dict) else None
    if not isinstance(response, dict) or not isinstance(response.get("items"), list):
        raise ValueError("wall.get returned no items")
    try:
        group = api(
            "groups.getById",
            group_ids=domain,
            fields="description,members_count,counters,photo_200,cover,screen_name,verified,site",
        )
    except ValueError:
        group = {}
    groups = response.get("groups") if isinstance(response.get("groups"), list) else []
    richer = _group_row(group)
    if richer:
        screen = (richer.get("screen_name") or "").lower()
        replaced = False
        merged = []
        for row in groups:
            if isinstance(row, dict) and (row.get("screen_name") or "").lower() == screen:
                merged.append({**row, **richer})
                replaced = True
            else:
                merged.append(row)
        if not replaced:
            merged.insert(0, richer)
        response["groups"] = merged
    return wall


def wall_payload(domain: str, count: int = 8) -> str:
    return json.dumps(wall_document(domain, count), ensure_ascii=False)


def comments_document(owner_id: str, post_id: str, count: int = 20) -> dict:
    return api(
        "wall.getComments",
        owner_id=owner_id,
        post_id=post_id,
        count=max(1, min(int(count or 20), 40)),
        extended=1,
        sort="desc",
        thread_items_count=3,
    )


def _group_row(payload: dict) -> dict | None:
    response = payload.get("response") if isinstance(payload, dict) else None
    if isinstance(response, dict):
        groups = response.get("groups")
        if isinstance(groups, list) and groups and isinstance(groups[0], dict):
            return groups[0]
    if isinstance(response, list) and response and isinstance(response[0], dict):
        return response[0]
    return None
