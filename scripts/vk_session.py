"""Read VK stories with the spare account's own web session.

The sync signs in through vk.com the way a browser does, then reads the feed
page. It does not call login.vk.com?act=web_token, does not send an official
app client id, and does not mark stories seen or write anything.

Cookies are reused from the Actions cache. The file is ciphertext. A fresh
sign-in happens only when that session is dead. A captcha, an SMS or call
code, a suspicious-login check, a block, or a 401/403 stops the run.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from stories import StoryAuthError, StoryQueryError

SPARE_ATTENTION = "VK spare account needs attention: sign in once by hand at vk.com"
SESSION_ATTENTION = "VK session needs attention: re-export cookies from the spare account"
VK_WEB_PACE = 2.0
BROWSER = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
_MAX_HOPS = 6
_CHALLENGE = {"captcha", "suspicious", "sms", "blocked", "denied"}
_WRITE = (
    "stories.markseen",
    "stories.markskipped",
    "stories.seenreplies",
    "stories.save",
    "stories.delete",
    "stories.banowner",
    "stories.unbanowner",
    "stories.hidereply",
    "stories.hideallreplies",
    "stories.askquestion",
    "stories.subscribe",
    "stories.unsubscribe",
    "stories.marknotinterested",
    "stories.setdiscovervisible",
    "account.setonline",
    "account.setoffline",
    "likes.add",
    "likes.delete",
    "wall.post",
    "wall.repost",
    "friends.add",
    "friends.delete",
)
_LOGIN_INPUTS = (
    'input[name="login"]',
    'input[name="email"]',
    'input[type="email"]',
    'input[type="tel"]',
    'input[autocomplete="username"]',
    "#quick_email",
)
_PASSWORD_INPUTS = (
    'input[name="password"]',
    'input[name="pass"]',
    'input[type="password"]',
)
_OTP_INPUTS = (
    'input[autocomplete="one-time-code"]',
    'input[name="otp"]',
    'input[name="code"]',
    'input[inputmode="numeric"]',
)
_SUBMIT = (
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Continue")',
    'button:has-text("Продолжить")',
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
    'button:has-text("Войти")',
    'button:has-text("Next")',
    'button:has-text("Далее")',
)
_SIGN_IN = (
    'button:has-text("Sign in")',
    'a:has-text("Sign in")',
    'button:has-text("Войти")',
    'a:has-text("Войти")',
    "#index_login_button",
    ".VkIdForm__signInButton",
)


def totp_code(secret: str, moment: datetime | None = None, step: int = 30, digits: int = 6) -> str:
    """RFC 6238 code. The secret is the base32 setup key from VK's authenticator screen."""
    raw = re.sub(r"[\s-]", "", secret or "").upper()
    if not raw:
        raise ValueError("empty")
    pad = "=" * ((8 - len(raw) % 8) % 8)
    try:
        key = base64.b32decode(raw + pad, casefold=True)
    except (ValueError, base64.Error) as exc:
        raise ValueError("bad") from exc
    if not key:
        raise ValueError("empty")
    when = moment or datetime.now(timezone.utc)
    counter = int(when.timestamp()) // step
    digest = hmac.new(key, counter.to_bytes(8, "big"), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = int.from_bytes(digest[offset : offset + 4], "big") & 0x7FFFFFFF
    return str(code % (10 ** digits)).zfill(digits)


def passphrase(session_key: str, password: str) -> str:
    """Cache key. VK_SESSION_KEY wins. Otherwise the key is derived from the password."""
    material = (session_key or "").strip() or (password or "").strip()
    if not material:
        return ""
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        material.encode("utf-8"),
        b"superintelapp-vk-session-v1",
        200_000,
        dklen=32,
    )
    return digest.hex()


def load_cookie_export(raw: str) -> list:
    """Cookie-Editor JSON, a `{cookies: [...]}` export, or a raw Cookie header."""
    text = (raw or "").strip()
    if not text:
        return []
    if text[0] in "[{":
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            raise StoryAuthError(SESSION_ATTENTION)
        rows = data.get("cookies") if isinstance(data, dict) else data
        if not isinstance(rows, list):
            raise StoryAuthError(SESSION_ATTENTION)
        cookies = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            value = str(row.get("value") or "")
            if not name or value == "":
                continue
            domain = str(row.get("domain") or ".vk.com").strip() or ".vk.com"
            cookies.append({
                "domain": domain,
                "path": str(row.get("path") or "/") or "/",
                "name": name,
                "value": value,
                "secure": bool(row.get("secure", True)),
                "httpOnly": bool(row.get("httpOnly", False)),
            })
        if not cookies:
            raise StoryAuthError(SESSION_ATTENTION)
        return [row for row in cookies if _vk_domain(row["domain"])]
    cookies = []
    for piece in text.split(";"):
        name, sep, value = piece.strip().partition("=")
        if not sep or not name.strip() or not value:
            continue
        cookies.append({
            "domain": ".vk.com",
            "path": "/",
            "name": name.strip(),
            "value": value.strip(),
            "secure": True,
            "httpOnly": False,
        })
    if not cookies:
        raise StoryAuthError(SESSION_ATTENTION)
    return cookies


def _vk_domain(domain: str) -> bool:
    host = (domain or "").lstrip(".").lower()
    return host == "vk.com" or host.endswith(".vk.com") or host == "vk.ru" or host.endswith(".vk.ru")


def _jar(cookies: list) -> dict:
    jar = {}
    for row in cookies or []:
        if not isinstance(row, dict) or not row.get("name"):
            continue
        domain = str(row.get("domain") or ".vk.com")
        path = str(row.get("path") or "/") or "/"
        if not _vk_domain(domain):
            continue
        jar[(domain.lower(), path, row["name"])] = {
            "domain": domain,
            "path": path,
            "name": row["name"],
            "value": str(row.get("value") or ""),
            "secure": bool(row.get("secure", True)),
            "httpOnly": bool(row.get("httpOnly", False)),
        }
    return jar


def _jar_list(jar: dict) -> list:
    return list(jar.values())


def _domain_match(host: str, domain: str) -> bool:
    domain = (domain or "").lstrip(".").lower()
    host = (host or "").lower()
    return bool(domain) and (host == domain or host.endswith("." + domain))


def _cookie_header(jar: dict, url: str) -> str:
    parts = urllib.parse.urlparse(url)
    host = parts.hostname or ""
    path = parts.path or "/"
    pairs = []
    for cookie in jar.values():
        if not _domain_match(host, cookie["domain"]):
            continue
        cookie_path = cookie.get("path") or "/"
        if not path.startswith(cookie_path):
            continue
        pairs.append(cookie["name"] + "=" + cookie["value"])
    return "; ".join(pairs)


def _store_cookie(jar: dict, url: str, line: str) -> None:
    pieces = [part.strip() for part in (line or "").split(";") if part.strip()]
    if not pieces or "=" not in pieces[0]:
        return
    name, _, value = pieces[0].partition("=")
    name = name.strip()
    if not name or name.lower() in ("path", "domain", "expires", "max-age", "samesite"):
        return
    domain = ""
    path = "/"
    secure = False
    http_only = False
    for attr in pieces[1:]:
        key, _, val = attr.partition("=")
        key = key.strip().lower()
        if key == "domain":
            domain = val.strip()
        elif key == "path":
            path = val.strip() or "/"
        elif key == "secure":
            secure = True
        elif key == "httponly":
            http_only = True
    if not domain:
        domain = urllib.parse.urlparse(url).hostname or ""
    if not _vk_domain(domain):
        return
    if value == "":
        jar.pop((domain.lower(), path, name), None)
        return
    jar[(domain.lower(), path, name)] = {
        "domain": domain,
        "path": path,
        "name": name,
        "value": value,
        "secure": secure,
        "httpOnly": http_only,
    }


def _allowed(url: str) -> bool:
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    return _vk_domain(host)


def forbidden_request(url: str, body: str = "") -> bool:
    """True for web_token, story-seen calls, writes, and keep-alive pings."""
    blob = ((url or "") + "\n" + (body or "")).lower()
    if "act=web_token" in blob or "method=web_token" in blob or "/method/web_token" in blob:
        return True
    if re.search(r"(?i)(?:al_ping\.php|/ping\.php|[?&]act=ping(?:&|$))", blob):
        return True
    return any(name in blob for name in _WRITE)


def _markup(html: str) -> str:
    return re.sub(r"<script\b[^>]*>.*?</script>", " ", html or "", flags=re.I | re.S)


def _visible(html: str) -> str:
    text = re.sub(r"<style\b[^>]*>.*?</style>", " ", _markup(html), flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def vk_user_id(html: str) -> int | None:
    match = re.search(
        r"window\.vk\s*=\s*Object\.assign\(\s*window\.vk\s*\|\|\s*\{\}\s*,\s*\{.{0,1200}?\bid\s*:\s*(\d+)",
        html or "",
        re.S,
    )
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def page_state(url: str, status: int, body: str) -> str:
    """One of ok, login, captcha, suspicious, sms, blocked, denied."""
    if status in (401, 403):
        return "denied"
    lowered = (url or "").lower()
    if "act=web_token" in lowered:
        return "denied"
    if "captcha" in lowered:
        return "captcha"
    if any(token in lowered for token in ("act=authcheck", "act=validate", "security_check")):
        return "suspicious"
    markup = _markup(body or "")
    visible = _visible(body or "").lower()
    if re.search(r"(?i)name=[\"']captcha|recaptcha|smartcaptcha|id=[\"']captcha|class=[\"'][^\"']*captcha", markup):
        return "captcha"
    if any(phrase in visible for phrase in ("not a robot", "я не робот", "код с картинки", "введите код с картинки")):
        return "captcha"
    if any(phrase in visible for phrase in (
        "подозрительн",
        "suspicious login",
        "suspicious sign-in",
        "подтвердите, что это вы",
        "confirm that it is you",
        "confirm it's you",
    )):
        return "suspicious"
    if any(phrase in visible for phrase in (
        "код из sms",
        "код из смс",
        "смс-сообщ",
        "we sent an sms",
        "we sent a text",
        "we called",
        "позвоним",
        "код из звонка",
        "sms code",
        "confirmation code by sms",
    )):
        return "sms"
    if any(phrase in visible for phrase in (
        "страница заблокирована",
        "аккаунт заблокирован",
        "account is blocked",
        "account has been blocked",
        "user is banned",
    )):
        return "blocked"
    user_id = vk_user_id(body or "")
    if user_id is not None and user_id > 0:
        return "ok"
    host = (urllib.parse.urlparse(url or "").hostname or "").lower()
    if host in ("id.vk.com", "id.vk.ru", "login.vk.com", "login.vk.ru"):
        if "act=restore" not in lowered and "act=migrate" not in lowered:
            return "login"
    if re.search(r"id=[\"']quick_email[\"']", markup, re.I):
        return "login"
    if re.search(r"<input[^>]*name=[\"'](?:email|login|pass|password)[\"']", markup, re.I):
        return "login"
    if user_id == 0 or (visible.lower().startswith("vk") and "welcome" in visible.lower()):
        return "login"
    if "data-testid=\"feed" in (body or "") or "stories_feed" in (body or ""):
        return "ok"
    return "login"


def _balanced(text: str, start: int) -> str:
    while start < len(text) and text[start].isspace():
        start += 1
    if start >= len(text) or text[start] not in "{[":
        return ""
    pairs = {"{": "}", "[": "]"}
    stack = []
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char in "{[":
            stack.append(pairs[char])
        elif char in "}]":
            if not stack or char != stack[-1]:
                return ""
            stack.pop()
            if not stack:
                return text[start : index + 1]
    return ""


def _json_blobs(html: str) -> list:
    blobs = []
    for match in re.finditer(r"<script[^>]*type=[\"']application/json[\"'][^>]*>(.*?)</script>", html or "", re.I | re.S):
        blobs.append(match.group(1).strip())
    for match in re.finditer(r"apiPrefetchCache\s*=\s*", html or ""):
        blob = _balanced(html, match.end())
        if blob:
            blobs.append(blob)
    return blobs


def has_stories_document(parts: list) -> bool:
    for part in parts or []:
        text = part if isinstance(part, str) else json.dumps(part, ensure_ascii=False)
        if "stories.get" in text and "apiPrefetchCache" in text:
            return True
        if re.search(r'class=["\'][^"\']*stories_feed', text):
            return True
        if "data-story-id" in text:
            return True
        if "owner_id" in text and re.search(r'"type"\s*:\s*"(?:photo|video)"', text):
            return True
    return False


def _is_story(node: dict) -> bool:
    if node.get("is_ads") or node.get("is_promo"):
        return False
    if node.get("type") not in ("photo", "video"):
        return False
    return node.get("owner_id") is not None and node.get("id") is not None


def _people(node: dict) -> bool:
    if node.get("id") is None:
        return False
    if node.get("screen_name") or node.get("domain") or node.get("first_name"):
        return True
    return bool(node.get("name") and (node.get("photo_200") or node.get("photo_100")))


def _walk(node, stories: list, people: list) -> None:
    if isinstance(node, dict):
        if _is_story(node):
            stories.append(node)
        elif _people(node):
            people.append(node)
        for value in node.values():
            _walk(value, stories, people)
    elif isinstance(node, list):
        for value in node:
            _walk(value, stories, people)


def _screen(owner_id: int, people: list) -> str:
    wanted = abs(int(owner_id))
    for row in people:
        try:
            found = int(row.get("id"))
        except (TypeError, ValueError):
            continue
        if found != wanted:
            continue
        name = str(row.get("screen_name") or row.get("domain") or "").strip().lstrip("@")
        if name:
            return name
    if int(owner_id) < 0:
        return "club" + str(wanted)
    return "id" + str(wanted)


def _cards(html: str, now: datetime, viewer_id: int | None) -> list:
    """Story cards that already carry media URLs in the feed markup."""
    if "data-story-id" not in (html or ""):
        return []
    from stories import _iso, _vk_item

    blocks = re.findall(
        r"<div\b(?=[^>]*\bdata-owner-id=[\"'](-?\d+)[\"'])(?=[^>]*\bdata-handle=[\"']([^\"']*)[\"'])"
        r"(?=[^>]*\bdata-name=[\"']([^\"']*)[\"'])(?=[^>]*\bdata-avatar=[\"']([^\"']*)[\"'])[^>]*>"
        r"(.*?)</div>",
        html,
        re.S,
    )
    accounts = []
    for owner_raw, handle, name, avatar, inner in blocks:
        owner_id = int(owner_raw)
        if viewer_id and owner_id == viewer_id:
            continue
        items = []
        for item in re.finditer(
            r"data-story-id=[\"']([^\"']+)[\"'][^>]*data-type=[\"'](photo|video)[\"']"
            r"[^>]*data-date=[\"']([^\"']*)[\"'](?:[^>]*data-expires=[\"']([^\"']*)[\"'])?[^>]*>"
            r"(?:\s*<(?:img|source)\b[^>]*src=[\"'](https://[^\"']+)[\"'])?",
            inner,
            re.S,
        ):
            story_id, kind, date, expires, url = item.groups()
            if not url:
                continue
            taken = _parse_stamp(date)
            if taken is None:
                continue
            raw = {"id": story_id, "owner_id": owner_id, "type": kind, "date": int(taken.timestamp())}
            if expires:
                end = _parse_stamp(expires)
                if end is not None:
                    raw["expires_at"] = int(end.timestamp())
            if kind == "video":
                raw["video"] = {"files": {"mp4_720": url}}
            else:
                raw["photo"] = {"sizes": [{"url": url, "width": 1, "height": 1}]}
            built = _vk_item(raw, now)
            if built:
                items.append(built)
        if not items:
            continue
        handle = (handle or _screen(owner_id, [])).lstrip("@")
        items.sort(key=lambda row: row.get("date") or "")
        accounts.append({
            "id": "vk:" + handle,
            "platform": "vk",
            "handle": handle,
            "name": name or handle,
            "avatar": avatar if str(avatar).startswith("https://") else "",
            "items": items,
        })
    return accounts


def _parse_stamp(value: str):
    text = (value or "").strip()
    if not text:
        return None
    if text.isdigit():
        try:
            return datetime.fromtimestamp(int(text), timezone.utc)
        except (ValueError, OSError, OverflowError):
            return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def parse_vk_web_stories(document, now: datetime, viewer_id: int | None = None) -> list:
    """Accounts the signed-in feed can see. Items are oldest first. Own stories are left out."""
    from stories import _https, _vk_face, _vk_item

    nodes = []
    cards = []
    if isinstance(document, (dict, list)):
        nodes.append(document)
    else:
        text = document or ""
        if viewer_id is None:
            viewer_id = vk_user_id(text)
        stripped = text.lstrip()
        parsed = None
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                parsed = json.loads(stripped)
            except json.JSONDecodeError:
                parsed = None
        if parsed is not None:
            nodes.append(parsed)
        else:
            for blob in _json_blobs(text):
                try:
                    nodes.append(json.loads(blob))
                except json.JSONDecodeError:
                    continue
            cards = _cards(text, now, viewer_id)
    stories = []
    people = []
    for node in nodes:
        _walk(node, stories, people)
    grouped = {}
    order = []
    for raw in stories:
        try:
            owner_id = int(raw.get("owner_id"))
        except (TypeError, ValueError):
            continue
        if viewer_id and owner_id == viewer_id:
            continue
        item = _vk_item(raw, now)
        if not item:
            continue
        if owner_id not in grouped:
            grouped[owner_id] = []
            order.append(owner_id)
        if any(have["id"] == item["id"] for have in grouped[owner_id]):
            continue
        grouped[owner_id].append(item)
    accounts = []
    for owner_id in order:
        handle = _screen(owner_id, people)
        name, avatar = _vk_face({"profiles": people, "groups": people}, owner_id, handle, "")
        items = sorted(grouped[owner_id], key=lambda row: row.get("date") or "")
        accounts.append({
            "id": "vk:" + handle,
            "platform": "vk",
            "handle": handle,
            "name": name or handle,
            "avatar": _https(avatar),
            "items": items,
        })
    seen = {account["id"] for account in accounts}
    for account in cards:
        if account["id"] not in seen and account.get("items"):
            accounts.append(account)
    return accounts


def encrypt_cookies(cookies: list, phrase: str) -> bytes:
    if not phrase:
        raise StoryQueryError("VK session cache was not saved.")
    payload = json.dumps(_jar_list(_jar(cookies)), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return _openssl(payload, phrase, decrypt=False)


def decrypt_cookies(blob: bytes, phrase: str) -> list:
    if not phrase or not blob:
        return []
    try:
        raw = _openssl(blob, phrase, decrypt=True)
        data = json.loads(raw.decode("utf-8"))
    except (StoryQueryError, UnicodeError, json.JSONDecodeError, OSError):
        return []
    if not isinstance(data, list):
        return []
    return load_cookie_export(json.dumps(data)) if data else []


def _openssl(payload: bytes, phrase: str, decrypt: bool) -> bytes:
    env = dict(os.environ)
    env["VK_SESSION_PASSPHRASE"] = phrase
    command = [
        "openssl",
        "enc",
        "-aes-256-cbc",
        "-pbkdf2",
        "-iter",
        "200000",
        "-salt",
        "-pass",
        "env:VK_SESSION_PASSPHRASE",
    ]
    if decrypt:
        command.append("-d")
    try:
        result = subprocess.run(command, input=payload, capture_output=True, env=env, check=False)
    except OSError as exc:
        raise StoryQueryError("VK session cache was not saved.") from exc
    if result.returncode != 0 or not result.stdout:
        raise StoryQueryError("VK session cache was not saved.")
    return result.stdout


def save_cookie_file(path: str, cookies: list, phrase: str) -> bool:
    if not path or not phrase or not cookies:
        return False
    try:
        blob = encrypt_cookies(cookies, phrase)
    except StoryQueryError:
        return False
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    handle = os.open(path, flags, 0o600)
    try:
        os.write(handle, blob)
    finally:
        os.close(handle)
    return True


def load_cookie_file(path: str, phrase: str) -> list:
    if not path or not phrase or not os.path.isfile(path):
        return []
    try:
        blob = open(path, "rb").read()
    except OSError:
        return []
    try:
        return decrypt_cookies(blob, phrase)
    except StoryAuthError:
        return []


class _Pacer:
    def __init__(self, sleep, gap: float):
        self.sleep = sleep
        self.gap = gap
        self.used = False

    def wait(self) -> None:
        if self.used and self.sleep:
            self.sleep(self.gap)
        self.used = True


def read_feed(jar: dict, transport, sleep=None) -> tuple[str, list, dict]:
    """GET the feed once, following VK's own login restore redirects. Not web_token."""
    url = "https://vk.com/feed"
    pacer = _Pacer(sleep, VK_WEB_PACE)
    status = 0
    body = ""
    final = url
    for _hop in range(_MAX_HOPS):
        if not _allowed(url) or forbidden_request(url):
            break
        pacer.wait()
        headers = {
            "User-Agent": BROWSER,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
        }
        cookie = _cookie_header(jar, url)
        if cookie:
            headers["Cookie"] = cookie
        status, location, body, lines = transport(url, headers)
        for line in lines or []:
            _store_cookie(jar, url, line)
        final = url
        if status in (401, 403):
            return "denied", [body or ""], jar
        if status in (301, 302, 303, 307, 308) and location:
            nxt = urllib.parse.urljoin(url, location)
            if forbidden_request(nxt) or not _allowed(nxt):
                break
            url = nxt
            continue
        break
    return page_state(final, status, body or ""), [body or ""], jar


def run_sign_in(browser, login: str, password: str, totp_secret: str) -> list:
    """One pass through the web form. A challenge stops before the next field."""
    browser.open("https://vk.com/")
    state = page_state(browser.url(), 200, browser.html())
    if state in _CHALLENGE:
        raise StoryAuthError(SPARE_ATTENTION)
    if state == "ok":
        return browser.cookies()
    if not browser.fill_login(login):
        browser.click_sign_in()
        state = page_state(browser.url(), 200, browser.html())
        if state in _CHALLENGE:
            raise StoryAuthError(SPARE_ATTENTION)
        if state == "ok":
            return browser.cookies()
        if not browser.fill_login(login):
            raise StoryAuthError(SPARE_ATTENTION)
    browser.submit()
    state = page_state(browser.url(), 200, browser.html())
    if state in _CHALLENGE:
        raise StoryAuthError(SPARE_ATTENTION)
    if state == "ok":
        return browser.cookies()
    if not browser.fill_password(password):
        raise StoryAuthError(SPARE_ATTENTION)
    browser.submit()
    state = page_state(browser.url(), 200, browser.html())
    if state in _CHALLENGE:
        raise StoryAuthError(SPARE_ATTENTION)
    if state == "ok":
        return browser.cookies()
    if browser.needs_otp():
        if not (totp_secret or "").strip():
            raise StoryAuthError(SPARE_ATTENTION)
        try:
            code = totp_code(totp_secret)
        except ValueError:
            raise StoryAuthError(SPARE_ATTENTION)
        if not browser.fill_otp(code):
            raise StoryAuthError(SPARE_ATTENTION)
        browser.submit()
        state = page_state(browser.url(), 200, browser.html())
        if state in _CHALLENGE or state != "ok":
            raise StoryAuthError(SPARE_ATTENTION)
        return browser.cookies()
    raise StoryAuthError(SPARE_ATTENTION)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def urllib_transport(url: str, headers: dict):
    """One GET. Redirects are returned, not followed, so web_token is never requested."""
    request = urllib.request.Request(url, headers=headers, method="GET")
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(request, timeout=25) as response:
            status = getattr(response, "status", 200) or 200
            body = response.read(2_000_000).decode("utf-8", "replace")
            lines = response.headers.get_all("Set-Cookie") if hasattr(response.headers, "get_all") else []
            location = response.headers.get("Location") or ""
            return status, location, body, list(lines or [])
    except urllib.error.HTTPError as exc:
        body = exc.read(8000).decode("utf-8", "replace")
        lines = []
        location = ""
        if exc.headers is not None:
            location = exc.headers.get("Location") or ""
            if hasattr(exc.headers, "get_all"):
                lines = list(exc.headers.get_all("Set-Cookie") or [])
        return exc.code, location, body, lines
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise StoryQueryError("VK stories did not load.") from exc


def fetch_vk_web(
    now: datetime,
    login: str = "",
    password: str = "",
    totp_secret: str = "",
    session_export: str = "",
    session_key: str = "",
    session_file: str = "",
    transport=None,
    sleep=None,
    sign_in=None,
    spa_read=None,
) -> list:
    """Stories visible to the spare account. At most one feed read after a live session.

    A dead cached session may sign in once. A captcha, SMS or call code,
    suspicious-login check, block, or 401/403 does not retry and does not sign in.
    """
    login = (login or "").strip()
    password = (password or "").strip()
    primary = bool(login and password)
    attention = SPARE_ATTENTION if primary else SESSION_ATTENTION
    phrase = passphrase(session_key, password if primary else "")
    cookies = load_cookie_file(session_file, phrase) if phrase else []
    transport = transport or urllib_transport
    if not cookies and session_export:
        cookies = load_cookie_export(session_export)
    if not cookies and not primary:
        raise StoryAuthError(attention)

    def finish(state: str, parts: list, jar: dict) -> list:
        if state in _CHALLENGE:
            raise StoryAuthError(attention)
        if state != "ok":
            return []
        accounts = parse_vk_web_stories_many(parts, now)
        if accounts or has_stories_document(parts) or spa_read is None:
            save_cookie_file(session_file, _jar_list(jar), phrase)
            return accounts
        if sleep:
            sleep(VK_WEB_PACE)
        spa_state, spa_parts, spa_cookies = spa_read(_jar_list(jar))
        if spa_state in _CHALLENGE or spa_state != "ok":
            raise StoryAuthError(attention)
        save_cookie_file(session_file, spa_cookies or _jar_list(jar), phrase)
        return parse_vk_web_stories_many(spa_parts, now)

    if cookies:
        state, parts, jar = read_feed(_jar(cookies), transport, sleep)
        if state in _CHALLENGE:
            raise StoryAuthError(attention)
        if state == "ok":
            return finish(state, parts, jar)
        if not primary:
            raise StoryAuthError(attention)
    if not primary:
        raise StoryAuthError(attention)
    if sign_in is None:
        sign_in = playwright_sign_in
    fresh = sign_in(login, password, totp_secret)
    state, parts, jar = read_feed(_jar(fresh), transport, sleep)
    if state in _CHALLENGE:
        raise StoryAuthError(attention)
    if state != "ok":
        raise StoryAuthError(attention)
    return finish(state, parts, jar)


def parse_vk_web_stories_many(parts, now: datetime) -> list:
    viewer = None
    for part in parts or []:
        if viewer is None and isinstance(part, str):
            viewer = vk_user_id(part)
    accounts = []
    seen = set()
    for part in parts or []:
        for account in parse_vk_web_stories(part, now, viewer_id=viewer):
            if account["id"] in seen:
                continue
            seen.add(account["id"])
            accounts.append(account)
    return accounts


class ScriptedBrowser:
    """In-memory login pages for tests. Field values are not stored."""

    def __init__(self, pages: list, cookies: list | None = None):
        self.pages = pages
        self.index = 0
        self._cookies = list(cookies or [])
        self.events = []

    def open(self, url: str) -> None:
        self.events.append(("open", url))

    def url(self) -> str:
        return self.pages[self.index].get("url") or "https://vk.com/"

    def html(self) -> str:
        return self.pages[self.index].get("html") or ""

    def _has(self, kind: str) -> bool:
        return kind in (self.pages[self.index].get("inputs") or ())

    def fill_login(self, _value: str) -> bool:
        if not self._has("login"):
            return False
        self.events.append(("login",))
        return True

    def fill_password(self, _value: str) -> bool:
        if not self._has("password"):
            return False
        self.events.append(("password",))
        return True

    def fill_otp(self, value: str) -> bool:
        if not self._has("otp"):
            return False
        self.events.append(("otp", len(value or "")))
        return True

    def needs_otp(self) -> bool:
        return self._has("otp")

    def click_sign_in(self) -> None:
        self.events.append(("sign-in",))
        self._advance()

    def submit(self) -> None:
        self.events.append(("submit",))
        self._advance()

    def _advance(self) -> None:
        if self.index + 1 < len(self.pages):
            self.index += 1

    def cookies(self) -> list:
        return list(self._cookies)

    def add_cookies(self, cookies: list) -> None:
        self._cookies = list(cookies or [])


def _ensure_playwright() -> None:
    try:
        import playwright  # noqa: F401
    except ImportError:
        subprocess.run(
            [os.environ.get("PYTHON", "python3"), "-m", "pip", "install", "--disable-pip-version-check", "-q", "playwright"],
            check=True,
        )
    cache = Path.home() / ".cache" / "ms-playwright"
    if cache.is_dir() and any(cache.glob("chromium*")):
        return
    subprocess.run(
        [os.environ.get("PYTHON", "python3"), "-m", "playwright", "install", "--with-deps", "chromium"],
        check=True,
    )


class PlaywrightBrowser:
    """Headless Chromium. Requests that see, write, ping, or mint a web token are aborted."""

    def __init__(self):
        self._pw = None
        self._browser = None
        self._context = None
        self.page = None
        self.captured = []
        self.denied = 0
        try:
            _ensure_playwright()
            from playwright.sync_api import sync_playwright

            self._pw = sync_playwright().start()
            self._browser = self._pw.chromium.launch(headless=True)
            self._context = self._browser.new_context(
                user_agent=BROWSER,
                locale="en-US",
                viewport={"width": 1280, "height": 800},
            )
            self._context.route("**/*", self._route)
            self._context.on("response", self._response)
            self.page = self._context.new_page()
        except StoryAuthError:
            self.close()
            raise
        except Exception as exc:
            self.close()
            raise StoryQueryError("VK stories did not load.") from exc

    def close(self) -> None:
        for obj in (self._context, self._browser):
            try:
                if obj is not None:
                    obj.close()
            except Exception:
                pass
        try:
            if self._pw is not None:
                self._pw.stop()
        except Exception:
            pass
        self.page = None

    def _route(self, route) -> None:
        request = route.request
        post = ""
        try:
            post = request.post_data or ""
        except Exception:
            post = ""
        if forbidden_request(request.url, post):
            route.abort()
            return
        route.continue_()

    def _response(self, response) -> None:
        url = response.url or ""
        if response.status in (401, 403) and _allowed(url):
            self.denied = response.status
            return
        if not _allowed(url):
            return
        try:
            ctype = (response.headers.get("content-type") or "").lower()
        except Exception:
            return
        if "json" not in ctype and "text" not in ctype and "javascript" not in ctype:
            return
        try:
            text = response.text()
        except Exception:
            return
        if "owner_id" in text and ("stories" in text or re.search(r'"type"\s*:\s*"(?:photo|video)"', text)):
            self.captured.append(text[:2_000_000])

    def open(self, url: str) -> None:
        self.page.goto(url, wait_until="domcontentloaded", timeout=30000)
        self.page.wait_for_timeout(1500)

    def url(self) -> str:
        return self.page.url or ""

    def html(self) -> str:
        try:
            return self.page.content()
        except Exception:
            return ""

    def _fill(self, selectors, value: str) -> bool:
        for selector in selectors:
            loc = self.page.locator(selector)
            try:
                if loc.count() and loc.first.is_visible():
                    loc.first.fill(value, timeout=3000)
                    return True
            except Exception:
                continue
        return False

    def fill_login(self, value: str) -> bool:
        return self._fill(_LOGIN_INPUTS, value)

    def fill_password(self, value: str) -> bool:
        return self._fill(_PASSWORD_INPUTS, value)

    def fill_otp(self, value: str) -> bool:
        return self._fill(_OTP_INPUTS, value)

    def needs_otp(self) -> bool:
        for selector in _OTP_INPUTS:
            loc = self.page.locator(selector)
            try:
                if loc.count() and loc.first.is_visible():
                    return True
            except Exception:
                continue
        return False

    def _click(self, selectors) -> bool:
        for selector in selectors:
            loc = self.page.locator(selector)
            try:
                if loc.count() and loc.first.is_visible():
                    loc.first.click(timeout=3000)
                    self.page.wait_for_timeout(1000)
                    return True
            except Exception:
                continue
        return False

    def click_sign_in(self) -> None:
        self._click(_SIGN_IN)

    def submit(self) -> None:
        self._click(_SUBMIT)

    def cookies(self) -> list:
        rows = []
        try:
            found = self._context.cookies()
        except Exception:
            return rows
        for row in found or []:
            domain = row.get("domain") or ""
            if not _vk_domain(domain):
                continue
            rows.append({
                "domain": domain,
                "path": row.get("path") or "/",
                "name": row.get("name") or "",
                "value": row.get("value") or "",
                "secure": bool(row.get("secure", True)),
                "httpOnly": bool(row.get("httpOnly", False)),
            })
        return [row for row in rows if row["name"]]

    def add_cookies(self, cookies: list) -> None:
        payload = []
        for row in cookies or []:
            if not row.get("name"):
                continue
            domain = row.get("domain") or ".vk.com"
            payload.append({
                "name": row["name"],
                "value": row.get("value") or "",
                "domain": domain,
                "path": row.get("path") or "/",
                "secure": True,
                "httpOnly": bool(row.get("httpOnly", False)),
            })
        if payload:
            self._context.add_cookies(payload)


def playwright_sign_in(login: str, password: str, totp_secret: str) -> list:
    browser = PlaywrightBrowser()
    try:
        return run_sign_in(browser, login, password, totp_secret)
    finally:
        browser.close()


def playwright_read(cookies: list):
    """Open the feed once in Chromium and return whatever story payload the page itself loaded."""
    browser = PlaywrightBrowser()
    try:
        browser.add_cookies(cookies)
        browser.open("https://vk.com/feed")
        try:
            browser.page.wait_for_timeout(2500)
        except Exception:
            pass
        status = 401 if browser.denied in (401, 403) else 200
        state = page_state(browser.url(), status, browser.html())
        parts = [browser.html(), *browser.captured]
        return state, parts, browser.cookies()
    finally:
        browser.close()
