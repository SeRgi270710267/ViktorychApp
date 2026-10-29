#!/usr/bin/env python3
"""Fail when a private handle or owner id from the catalog is present in the tree.

The list is built in memory from the private R2 catalog: followed account
handles, owner handles, owner ids, and the tracked and unlocked TikTok
lists. HANDLE_DENYLIST and OWNER_IDS are optional extras. HANDLE_ALLOWLIST
is an optional list of extra words to skip. Comparison uses sha256. A match
is reported as a path and a count. Values are not printed, saved, or uploaded.

A very short token, a numeric id under eight digits, or a platform or
common word is not compared. When the catalog cannot be read, an optional
run uses the extra lists or skips. A required run fails instead of skipping.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from r2_catalog import lastgood_key, usable_catalog  # noqa: E402

TOKEN = re.compile(r"[A-Za-z0-9_\u0400-\u04FF.]{2,64}")
TOKEN_FULL = re.compile(r"^[A-Za-z0-9_\u0400-\u04FF.]{4,64}$")
MIN_TOKEN_LEN = 4
MIN_DIGIT_LEN = 8
BUCKET = "viktorych-data"
CATALOG_KEYS = (
    "feeds.json",
    "feeds.config.json",
    "people.json",
    "stories.json",
    "owner/tiktok.json",
    "owner/tiktok-accounts.json",
    "owner/tiktok-unlocked.json",
    "owner/tiktok-watch.json",
    "owner/added-accounts.json",
)
LIST_ENV = ("HANDLE_DENYLIST", "OWNER_IDS", "HANDLE_ALLOWLIST")
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".wrangler", "_site"}
TEXT_SUFFIXES = {
    ".js", ".mjs", ".cjs", ".py", ".json", ".yml", ".yaml", ".md", ".html",
    ".css", ".toml", ".txt", ".svg", ".webmanifest", ".xml",
}
PLATFORM_PREFIXES = {
    "x", "twitter", "tiktok", "youtube", "instagram", "threads", "telegram",
    "vk", "discord", "facebook", "reddit", "rss", "twitch", "github",
    "bsky", "bluesky",
}
ID_KEYS = (
    "permanentId", "secUid", "channelId", "ownerId", "owner_id",
    "userId", "user_id", "uid",
)
OWNER_FIELDS = {
    "ownerhandle", "owner_handle", "ownerid", "owner_id", "ownerids", "owner_ids",
}
_SKIP_WORDS = """
youtube instagram threads telegram discord tiktok twitter facebook reddit
github twitch spotify whatsapp snapchat linkedin pinterest tumblr vimeo
mastodon bluesky bsky substack patreon soundcloud cloudflare google
microsoft amazon apple meta netflix vk rss atom nitter rsshub invidious
piped fxtwitter youtubei x twitter
true false none null undefined yes off
self args kwargs init main test tests selftest data user users name names
text date time path file files open read write json html http https www
com org net dev app api src href body head link links page pages home post
posts feed feeds item items list lists dict type types kind from with this
that else elif try pass async await class const import export return
function default public private string number object array value values
error errors status config index title content contents media image images
video videos audio owner handle handles account accounts group groups
comment comments profile profiles avatar banner source sources target
result response request header headers params query token tokens secret
secrets hash sha256 catalog preview updated configured platform platforms
adapter adapters fallback fallbacks fixture fixtures limit people person
story stories music radio live sync build deploy worker workers script
scripts workflow workflows action actions ubuntu python node npm wrangler
about after again also back been before being between both came come could
does done down each even ever every first have here into just know last
like long look made make many more most much must need next only other over
same should some such than them then there these they those through under
very want were what when where which while will would your their your
readme license changelog dockerfile makefile package pytest eslint someone
example sample demo placeholder username anonymous deleted removed added
extra local remote static global shared common base core util utils model
view event state style styles asset assets icon icons theme themes dark
light official channel channels community communities message messages
search settings general watch player photo photos login signup email help
info blog news admin root guest unknown custom internal external dynamic
service services client server host port route routes router store cache
props context component components module modules document window console
exports require process buffer current previous first last next
followers following verified joined website bio short shorts unlocked
tracked locked follow follows repost quote reply replies share notification
notifications settings health archive backup private public preview shell
signed session cookie cookies syncing deploy pages mirror worker
flex grid none auto left right block inline width height color font size
margin padding border display position absolute relative hidden visible
center start align justify column wrap scroll fixed sticky opacity hover
focus active solid bold black white gray grey blue green red yellow orange
purple pink brown
"""


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def builtin_skip() -> set[str]:
    return {word.casefold() for word in _SKIP_WORDS.split() if word}


def secret_items(raw: str) -> list[str]:
    found = []
    for line in (raw or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        for part in re.split(r"[,\s]+", line):
            item = part.strip()
            if item:
                found.append(item)
    return found


def mask_env_lists() -> None:
    """Register optional list entries with the Actions log masker.

    Derived catalog values stay in memory and are not sent here.
    """
    if os.environ.get("GITHUB_ACTIONS") != "true":
        return
    for key in LIST_ENV:
        for item in secret_items(os.environ.get(key) or ""):
            sys.__stdout__.write("::add-mask::" + item + "\n")
    sys.__stdout__.flush()


def catalog_required() -> bool:
    raw = (os.environ.get("HANDLE_GUARD_REQUIRE_CATALOG") or "").strip().casefold()
    return raw in {"1", "true", "yes", "required"}


def keep_token(token: str, skip: set[str]) -> bool:
    if token.casefold() in skip:
        return False
    if len(token) < MIN_TOKEN_LEN:
        return False
    if token.isdigit():
        return len(token) >= MIN_DIGIT_LEN
    return any(ch.isalpha() for ch in token)


def add_token(found: set[str], value, skip: set[str]) -> None:
    if isinstance(value, bool) or value is None:
        return
    if isinstance(value, int):
        text = str(value)
    elif isinstance(value, float):
        if not value.is_integer():
            return
        text = str(int(value))
    else:
        text = str(value).strip()
    if text.startswith("@"):
        text = text[1:].strip()
    if not text or text.startswith("#"):
        return
    parts = [text]
    if ":" in text:
        left, right = text.split(":", 1)
        right = right.strip().lstrip("@")
        if left.strip().casefold() in PLATFORM_PREFIXES and right:
            parts.append(right)
    for part in parts:
        if TOKEN_FULL.fullmatch(part) and keep_token(part, skip):
            found.add(part)


def take_identity(found: set[str], row, skip: set[str]) -> None:
    if isinstance(row, (str, int)):
        add_token(found, row, skip)
        return
    if not isinstance(row, dict):
        return
    add_token(found, row.get("handle"), skip)
    add_token(found, row.get("uniqueId"), skip)
    add_token(found, row.get("id"), skip)
    for key in ID_KEYS:
        add_token(found, row.get(key), skip)
    previous = row.get("previousHandles")
    if isinstance(previous, list):
        for item in previous:
            add_token(found, item, skip)


def add_many(found: set[str], value, skip: set[str]) -> None:
    if isinstance(value, dict):
        take_identity(found, value, skip)
        return
    if isinstance(value, list):
        for item in value:
            add_many(found, item, skip)
        return
    add_token(found, value, skip)


def walk_owner_fields(node, found: set[str], skip: set[str]) -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            if str(key).casefold() in OWNER_FIELDS:
                add_many(found, value, skip)
            else:
                walk_owner_fields(value, found, skip)
    elif isinstance(node, list):
        for item in node:
            walk_owner_fields(item, found, skip)


def is_followed(row) -> bool:
    if not isinstance(row, dict):
        return False
    if str(row.get("origin") or "") == "repost":
        return False
    if row.get("defaultFollow") is False:
        return False
    if row.get("configured") is False and row.get("ownerAdded") is not True:
        return False
    return True


def collect_feed_file(doc, found: set[str], skip: set[str]) -> None:
    if not isinstance(doc, dict):
        return
    for row in doc.get("feeds") or []:
        if is_followed(row):
            take_identity(found, row, skip)
    walk_owner_fields(doc, found, skip)


def collect_config(doc, found: set[str], skip: set[str]) -> None:
    if not isinstance(doc, dict):
        return
    for row in doc.get("feeds") or []:
        if is_followed(row):
            take_identity(found, row, skip)
    for person in doc.get("people") or []:
        if not isinstance(person, dict):
            continue
        for account in person.get("accounts") or []:
            take_identity(found, account, skip)
    for item in doc.get("removed") or []:
        if isinstance(item, dict):
            add_token(found, item.get("handle"), skip)
        else:
            add_token(found, item, skip)
    for item in doc.get("ia_tiktok_allow") or []:
        add_token(found, item, skip)
    walk_owner_fields(doc, found, skip)


def collect_people(doc, found: set[str], skip: set[str]) -> None:
    people = doc.get("people") if isinstance(doc, dict) else None
    for person in people or []:
        if not isinstance(person, dict):
            continue
        for account in person.get("accounts") or []:
            take_identity(found, account, skip)
    walk_owner_fields(doc, found, skip)


def collect_stories(doc, found: set[str], skip: set[str]) -> None:
    if isinstance(doc, dict):
        accounts = doc.get("accounts") or []
    elif isinstance(doc, list):
        accounts = doc
    else:
        return
    for account in accounts:
        take_identity(found, account, skip)
    walk_owner_fields(doc, found, skip)


def collect_unlocked(doc, found: set[str], skip: set[str]) -> None:
    if isinstance(doc, list):
        add_many(found, doc, skip)
        return
    if not isinstance(doc, dict):
        return
    for key in ("handles", "unlocked", "accounts", "tracked"):
        if key in doc:
            add_many(found, doc[key], skip)
    walk_owner_fields(doc, found, skip)


def collect_account_book(doc, found: set[str], skip: set[str]) -> None:
    if not isinstance(doc, dict):
        add_many(found, doc, skip)
        return
    for key in ("added", "removed", "removedIds", "handles", "tracked", "unlocked"):
        if key in doc:
            add_many(found, doc[key], skip)
    walk_owner_fields(doc, found, skip)


def collect_tiktok_catalog(doc, found: set[str], skip: set[str]) -> None:
    if not isinstance(doc, dict):
        return
    for row in doc.get("feeds") or []:
        take_identity(found, row, skip)
    live = doc.get("live")
    if isinstance(live, dict):
        for key, row in live.items():
            add_token(found, key, skip)
            if isinstance(row, dict):
                add_token(found, row.get("handle"), skip)
    for key in ("tracked", "unlocked", "handles"):
        if key in doc:
            add_many(found, doc[key], skip)
    walk_owner_fields(doc, found, skip)


def collect_watch(doc, found: set[str], skip: set[str]) -> None:
    if not isinstance(doc, dict):
        return
    accounts = doc.get("accounts")
    if isinstance(accounts, dict):
        for key, row in accounts.items():
            add_token(found, key, skip)
            if isinstance(row, dict):
                add_token(found, row.get("handle"), skip)
    elif isinstance(accounts, list):
        add_many(found, accounts, skip)
    walk_owner_fields(doc, found, skip)


def collect_tokens(docs: list[tuple[str, object]], skip: set[str]) -> set[str]:
    found: set[str] = set()
    for key, doc in docs:
        name = str(key).rsplit("/", 1)[-1]
        if name == "feeds.json":
            collect_feed_file(doc, found, skip)
        elif name == "feeds.config.json":
            collect_config(doc, found, skip)
        elif name == "people.json":
            collect_people(doc, found, skip)
        elif name == "stories.json":
            collect_stories(doc, found, skip)
        elif str(key).endswith("tiktok-unlocked.json"):
            collect_unlocked(doc, found, skip)
        elif str(key).endswith("tiktok-accounts.json") or str(key).endswith("added-accounts.json"):
            collect_account_book(doc, found, skip)
        elif str(key).endswith("tiktok-watch.json"):
            collect_watch(doc, found, skip)
        elif str(key).endswith("tiktok.json"):
            collect_tiktok_catalog(doc, found, skip)
        else:
            walk_owner_fields(doc, found, skip)
    return found


def derived_count(tokens: set[str]) -> int:
    return len({item.casefold() for item in tokens})


def hashes_for(secret: str) -> set[str]:
    found = set()
    for line in (secret or "").splitlines():
        item = line.strip()
        if not item or item.startswith("#"):
            continue
        found.add(digest(item))
        folded = item.casefold()
        if folded != item:
            found.add(digest(folded))
    return found


def hashes_for_tokens(tokens: set[str]) -> set[str]:
    if not tokens:
        return set()
    return hashes_for("\n".join(tokens))


def scan_text(text: str, banned: set[str]) -> int:
    if not banned or not text:
        return 0
    hits = 0
    seen = set()
    for token in TOKEN.findall(text):
        if token in seen:
            continue
        seen.add(token)
        if digest(token) in banned or digest(token.casefold()) in banned:
            hits += 1
    return hits


def iter_files(root: Path):
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        yield path


def scan_tree(root: Path, banned: set[str]) -> list[tuple[str, int]]:
    rows = []
    for path in iter_files(root):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        hits = scan_text(text, banned)
        if hits:
            rows.append((str(path.relative_to(root)), hits))
    return rows


def r2_fetch(key: str) -> tuple[str, bytes | None]:
    """Read one R2 object. Returns ok, missing, or error. The body is not logged."""
    token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    account = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    if not token or not account or not key:
        return "error", None
    quoted = urllib.parse.quote(key, safe="/")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/{BUCKET}/objects/{quoted}"
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                status = getattr(res, "status", 200)
                if status == 404:
                    return "missing", None
                if status != 200:
                    if attempt < 2 and status >= 500:
                        time.sleep(1 + attempt)
                        continue
                    return "error", None
                return "ok", res.read()
        except urllib.error.HTTPError as err:
            if err.code == 404:
                return "missing", None
            if attempt < 2 and err.code >= 500:
                time.sleep(1 + attempt)
                continue
            return "error", None
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt < 2:
                time.sleep(1 + attempt)
                continue
            return "error", None
    return "error", None


def parse_usable(blob, key: str):
    if not blob or not usable_catalog(blob, key):
        return None
    try:
        return json.loads(bytes(blob).decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError, TypeError):
        return None


def read_doc(key: str, fetch) -> tuple[str, object | None]:
    state, blob = fetch(key)
    if state == "error":
        return "error", None
    doc = parse_usable(blob, key) if state == "ok" else None
    if doc is not None:
        return "ok", doc
    backup = lastgood_key(key)
    bstate, bblob = fetch(backup)
    if bstate == "error":
        return "error", None
    bdoc = parse_usable(bblob, key) if bstate == "ok" else None
    if bdoc is not None:
        return "ok", bdoc
    if state == "ok" or bstate == "ok":
        return "empty", None
    return "missing", None


def load_docs(fetch) -> tuple[str, list[tuple[str, object]]]:
    """ok with documents, missing when every key is absent, or error."""
    if fetch is r2_fetch:
        token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
        account = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
        if not token or not account:
            return "error", []
    docs: list[tuple[str, object]] = []
    saw_ok = False
    try:
        for key in CATALOG_KEYS:
            state, doc = read_doc(key, fetch)
            if state == "error":
                return "error", []
            if state == "ok" and doc is not None:
                saw_ok = True
                docs.append((key, doc))
            elif state == "empty":
                saw_ok = True
    except Exception:
        return "error", []
    if not saw_ok:
        return "missing", []
    return "ok", docs


def optional_tokens(skip: set[str]) -> set[str]:
    found: set[str] = set()
    for key in ("HANDLE_DENYLIST", "OWNER_IDS"):
        for item in secret_items(os.environ.get(key) or ""):
            add_token(found, item, skip)
    return found


def skip_set() -> set[str]:
    skip = builtin_skip()
    for item in secret_items(os.environ.get("HANDLE_ALLOWLIST") or ""):
        folded = item.casefold()
        if folded:
            skip.add(folded)
    return skip


def emit(line: str) -> None:
    print(line, flush=True)


def main(argv: list[str] | None = None, fetch=None, root: Path | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if "--selftest" in args:
        code = selftest()
        if argv is None:
            # The CI step that runs this self-test also runs the secret and
            # personal-data scan of the tracked tree (paths and rules only).
            import secret_scan
            code = code or secret_scan.selftest() or secret_scan.report(secret_scan.scan(secret_scan.git_files(False), False))
        return code
    mask_env_lists()
    tree = root or ROOT
    getter = fetch or r2_fetch
    skip = skip_set()
    status, docs = load_docs(getter)
    extras = optional_tokens(skip)
    if status != "ok":
        if catalog_required():
            emit("handle guard: private catalog was not read")
            return 1
        if not extras:
            emit("handle guard: private catalog was not read; hash comparison skipped")
            return 0
        emit("handle guard: private catalog was not read; using the optional list")
        banned = hashes_for_tokens(extras)
    else:
        derived = collect_tokens(docs, skip)
        emit(f"handle guard: derived {derived_count(derived)}")
        banned = hashes_for_tokens(derived | extras)
    if not banned:
        emit("handle guard: no matches")
        return 0
    rows = scan_tree(tree, banned)
    extra = (os.environ.get("PR_TITLE") or "") + "\n" + (os.environ.get("PR_BODY") or "")
    body_hits = scan_text(extra, banned)
    if body_hits:
        rows.append(("pull request text", body_hits))
    if not rows:
        emit("handle guard: no matches")
        return 0
    total = sum(count for _path, count in rows)
    emit(f"handle guard: {total} matches in {len(rows)} places")
    for path, count in rows:
        emit(f"{count}\t{path}")
    return 1


def _blob(doc) -> bytes:
    return (json.dumps(doc, ensure_ascii=False) + "\n").encode("utf-8")


def _sample_store() -> dict[str, bytes]:
    return {
        "feeds.json": _blob({
            "feeds": [
                {
                    "id": "x:orbitfox",
                    "platform": "x",
                    "handle": "OrbitFox",
                    "configured": True,
                    "permanentId": "4242424242",
                    "bio": "postonlyzzz",
                },
                {
                    "id": "x:quietfoxzz",
                    "platform": "x",
                    "handle": "quietfoxzz",
                    "configured": False,
                },
                {
                    "id": "youtube:sampleclip",
                    "platform": "youtube",
                    "handle": "youtube",
                    "configured": True,
                    "channelId": "UCsamplechannel0000000001",
                },
            ],
            "posts": [{"id": "p1", "handle": "postonlyzzz", "text": "hello orbitfox"}],
        }),
        "feeds.config.json": _blob({
            "feeds": [
                {"id": "x:orbitfox", "platform": "x", "handle": "orbitfox", "defaultFollow": True},
                {
                    "id": "x:notafollowzz",
                    "platform": "x",
                    "handle": "notafollowzz",
                    "origin": "repost",
                    "defaultFollow": False,
                },
            ],
            "people": [
                {
                    "id": "sample-person",
                    "accounts": [{"platform": "x", "handle": "mirathorn", "permanentId": "42"}],
                }
            ],
            "removed": ["data"],
            "ia_tiktok_allow": ["user"],
        }),
        "people.json": _blob({
            "people": [{"accounts": [{"handle": "sampleowner", "platform": "instagram"}]}]
        }),
        "stories.json": _blob({"accounts": [{"handle": "ab", "id": "x:ab"}]}),
        "owner/tiktok.json": _blob({
            "feeds": [{"handle": "sampleclip"}],
            "live": {"lockclip": {"handle": "lockclip", "roomId": "99999999"}},
            "posts": [{"handle": "postonlyzzz"}],
        }),
        "owner/tiktok-accounts.json": _blob({
            "added": [{
                "handle": "sampleclip",
                "previousHandles": ["mirathorn"],
                "secUid": "MS4wsampleSecUidValue0001",
            }],
            "removed": ["data"],
        }),
        "owner/tiktok-unlocked.json": _blob({"handles": ["sampleclip", "user"]}),
        "owner/tiktok-watch.json": _blob({"accounts": {"sampleclip": {"handle": "sampleclip"}}}),
        "owner/added-accounts.json": _blob({
            "added": [{
                "handle": "sampleowner",
                "permanentId": "4242424242",
                "previousHandles": ["orbitfox"],
            }],
            "removedIds": ["1234567"],
            "ownerHandle": "sampleowner",
        }),
    }


_EXPECTED = {
    "orbitfox",
    "4242424242",
    "UCsamplechannel0000000001",
    "mirathorn",
    "sampleowner",
    "sampleclip",
    "lockclip",
    "MS4wsampleSecUidValue0001",
}


def _fetch_from(store: dict[str, bytes], errors: set[str] | None = None):
    blocked = errors or set()

    def fetch(key: str):
        if key in blocked:
            return "error", None
        blob = store.get(key)
        if blob is None:
            return "missing", None
        return "ok", blob

    return fetch


def _fail(message: str) -> int:
    print(message)
    return 1



def log_redact_checks() -> int:
    """Scripts run by workflows mask catalog handles, names and ids in logs."""
    import subprocess

    root = Path(__file__).resolve().parents[1]
    workflows = "".join(path.read_text(encoding="utf-8") for path in sorted((root / ".github" / "workflows").glob("*.yml")))
    # Imported by another script that already calls auto().
    modules = {"discord_publish.py", "log_redact.py"}
    missing = []
    for name in sorted(set(re.findall(r"scripts/([a-z0-9_]+\.py)", workflows)) - modules):
        path = root / "scripts" / name
        if path.is_file() and "from log_redact import auto" not in path.read_text(encoding="utf-8"):
            missing.append(name)
    if missing:
        return _fail("workflow scripts without log redaction: " + ", ".join(missing))
    proc = subprocess.run([sys.executable, str(root / "scripts" / "log_redact.py"), "--selftest"], capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        sys.stdout.write(proc.stdout + proc.stderr)
        return _fail("the log redaction self-test failed")
    print("handle guard: workflow scripts redact account values in logs")
    return 0

def selftest() -> int:
    import io
    import tempfile
    from contextlib import redirect_stdout

    saved = {key: os.environ.get(key) for key in (
        "GITHUB_ACTIONS", "HANDLE_GUARD_REQUIRE_CATALOG", "PR_TITLE", "PR_BODY",
        "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", *LIST_ENV,
    )}
    try:
        for key in saved:
            os.environ.pop(key, None)
        result = _selftest(io, tempfile, redirect_stdout)
        return result or log_redact_checks()
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _selftest(io, tempfile, redirect_stdout) -> int:
    skip = builtin_skip()
    if "youtube" not in skip or "user" not in skip or "data" not in skip or "function" not in skip:
        return _fail("the built-in skip list missed a common word")
    if "orbitfox" in skip or "sampleclip" in skip:
        return _fail("the built-in skip list included a sample token")
    store = _sample_store()
    status, docs = load_docs(_fetch_from(store))
    derived = collect_tokens(docs, skip) if status == "ok" else set()
    folded = {item.casefold() for item in derived}
    if status != "ok" or folded != {item.casefold() for item in _EXPECTED}:
        return _fail("the sample catalog did not yield the expected tokens")
    if derived_count(derived) != len(_EXPECTED):
        return _fail("derived count did not collapse case")
    for banned in ("quietfoxzz", "notafollowzz", "postonlyzzz", "youtube", "user", "data", "ab", "42", "1234567", "99999999"):
        if banned in folded:
            return _fail("a skipped token was kept")
    allow = set(skip)
    allow.add("orbitfox")
    narrowed = {item.casefold() for item in collect_tokens(docs, allow)}
    if "orbitfox" in narrowed or len(narrowed) != len(_EXPECTED) - 1:
        return _fail("the allowlist did not drop a token")
    banned = hashes_for_tokens(derived)
    if scan_text("hello orbitfox there orbitfox", banned) != 1:
        return _fail("a folded handle did not match once")
    if scan_text("youtube user data stay", banned) != 0:
        return _fail("a common word matched")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "note.txt").write_text("see orbitfox\n", encoding="utf-8")
        rows = scan_tree(root, banned)
        if rows != [("note.txt", 1)]:
            return _fail("a tree match was not path and count")
        (root / "note.txt").write_text("orbitfox stays out\n".replace("orbitfox", "quietfoxzz"), encoding="utf-8")
        if scan_tree(root, banned) != []:
            return _fail("a skipped handle matched the tree")
        os.environ["HANDLE_GUARD_REQUIRE_CATALOG"] = "true"
        os.environ["PR_TITLE"] = "please add orbitfox"
        (root / "note.txt").write_text("see orbitfox\n", encoding="utf-8")
        code, text = _capture(main, root, _fetch_from(store), redirect_stdout, io)
        os.environ.pop("PR_TITLE", None)
        if code != 1 or "handle guard: derived 8" not in text or "pull request text" not in text or "note.txt" not in text:
            return _fail("a required run did not report the count and the paths")
        for secret in _EXPECTED:
            if secret in text or secret.casefold() in text:
                return _fail("the log included a value")
        (root / "note.txt").write_text("hello\n", encoding="utf-8")
        os.environ.pop("PR_TITLE", None)
        os.environ.pop("PR_BODY", None)
        code, text = _capture(main, root, _fetch_from(store), redirect_stdout, io)
        if code != 0 or "handle guard: derived 8" not in text or "no matches" not in text:
            return _fail("a clean tree was flagged")
        for secret in _EXPECTED:
            if secret in text:
                return _fail("the clean log included a value")
        code, text = _capture(main, root, _fetch_from({}, errors=set(CATALOG_KEYS)), redirect_stdout, io)
        if code != 1 or "private catalog was not read" not in text or "derived" in text:
            return _fail("a required run skipped an unreadable catalog")
        if "orbitfox" in text:
            return _fail("an error log included a value")
        os.environ["HANDLE_GUARD_REQUIRE_CATALOG"] = "false"
        code, text = _capture(main, root, _fetch_from({}), redirect_stdout, io)
        if code != 0 or "hash comparison skipped" not in text:
            return _fail("an optional run failed without a catalog")
        os.environ["HANDLE_DENYLIST"] = "extrahandlezz\n# note\nyoutube\n"
        (root / "note.txt").write_text("extrahandlezz\n", encoding="utf-8")
        code, text = _capture(main, root, _fetch_from({}), redirect_stdout, io)
        if code != 1 or "using the optional list" not in text or "note.txt" not in text:
            return _fail("the optional list was not merged")
        if "extrahandlezz" in text or "youtube" in text.split("using the optional list", 1)[-1]:
            return _fail("the optional list was printed")
        (root / "note.txt").write_text("youtube\n", encoding="utf-8")
        code, text = _capture(main, root, _fetch_from({}), redirect_stdout, io)
        if code != 0 or "no matches" not in text:
            return _fail("a common word in the optional list was compared")
        os.environ.pop("HANDLE_DENYLIST", None)
        os.environ["OWNER_IDS"] = "4343434343"
        (root / "note.txt").write_text("4343434343\n", encoding="utf-8")
        code, text = _capture(main, root, _fetch_from({}), redirect_stdout, io)
        if code != 1 or "note.txt" not in text or "4343434343" in text:
            return _fail("an optional owner id was not merged")
        os.environ.pop("OWNER_IDS", None)
        os.environ["HANDLE_ALLOWLIST"] = "orbitfox"
        os.environ["HANDLE_GUARD_REQUIRE_CATALOG"] = "true"
        (root / "note.txt").write_text("orbitfox\n", encoding="utf-8")
        code, text = _capture(main, root, _fetch_from(store), redirect_stdout, io)
        if code != 0 or "handle guard: derived 7" not in text:
            return _fail("the allowlist secret did not override a sample token")
        if "orbitfox" in text:
            return _fail("the allowlist log included a value")
        os.environ.pop("HANDLE_ALLOWLIST", None)
        seed = {
            "catalogSeed": True,
            "feeds": [{"id": "x:quietfoxzz", "handle": "quietfoxzz", "configured": True}],
            "posts": [{"id": "p"}],
        }
        backed = dict(store)
        backed["feeds.json"] = _blob(seed)
        backed[lastgood_key("feeds.json")] = store["feeds.json"]
        status, docs = load_docs(_fetch_from(backed))
        folded = {item.casefold() for item in collect_tokens(docs, skip)}
        if status != "ok" or "orbitfox" not in folded or "quietfoxzz" in folded:
            return _fail("an unusable catalog did not fall back to the last good copy")
        broken = _fetch_from(store, errors={lastgood_key("feeds.json"), "feeds.json"})
        status, _docs = load_docs(broken)
        if status != "error":
            return _fail("a transport error was treated as an empty catalog")
    os.environ["GITHUB_ACTIONS"] = "true"
    os.environ["HANDLE_DENYLIST"] = "extrahandlezz, otherhandlezz"
    buf = io.StringIO()
    old = sys.__stdout__
    try:
        sys.__stdout__ = buf
        mask_env_lists()
    finally:
        sys.__stdout__ = old
        os.environ.pop("GITHUB_ACTIONS", None)
        os.environ.pop("HANDLE_DENYLIST", None)
    if buf.getvalue() != "::add-mask::extrahandlezz\n::add-mask::otherhandlezz\n":
        return _fail("env values were not masked")
    print("handle guard selftest ok")
    return 0


def _capture(fn, root, fetch, redirect_stdout, io):
    buf = io.StringIO()
    with redirect_stdout(buf):
        code = fn([], fetch=fetch, root=root)
    return code, buf.getvalue()


if __name__ == "__main__":
    try:
        from log_redact import auto as _redact_logs

        _redact_logs()
    except ImportError:
        pass
    sys.exit(main())
