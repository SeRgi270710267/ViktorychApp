#!/usr/bin/env python3
"""Copy the live catalog from git history into R2, once.

The public tree keeps a seed. This reads the newest usable blob of each
catalog file and stores it only when R2 does not already have a usable
object. Logs are counts and sizes. Values are never printed.

Worker secrets that can be derived from those historical files are set
with wrangler only when they are not already set. The hash-list secret
is the exception: once, when the R2 marker is absent, it is replaced
with both derived hashes. The values are piped on stdin and the command
output is discarded.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from r2_catalog import lastgood_key, read_catalog, store_usable, usable_catalog  # noqa: E402

FIXED_KEYS = (
    "feeds.json",
    "stories.json",
    "people.json",
    "suggestions.json",
    "status.json",
    "feeds.config.json",
    "owner/tiktok.json",
    "owner/tiktok-accounts.json",
    "owner/tiktok-unlocked.json",
)
SECRET_NAMES = (
    "OWNER_HANDLE",
    "OWNER_ID_SHA256",
    "OWNER_GITHUB_SHA256",
    "OWNER_PUBLIC_ID",
    "TIKTOK_TRACKED",
    "TIKTOK_UNLOCKED",
)
_JS_DQ = r'"((?:\\.|[^"\\])*)"'
OWNER_HANDLE_RE = re.compile(rf"""^[ \t]*const OWNER_HANDLE = {_JS_DQ}\s*;?\s*$""", re.M)
OWNER_GITHUB_RE = re.compile(rf"""^[ \t]*const OWNER_GITHUB = {_JS_DQ}\s*;?\s*$""", re.M)
TRACKED_RE = re.compile(r"""^[ \t]*TRACKED = \[([^\]]*)\]""", re.M)
UNLOCKED_RE = re.compile(r"""var unlockedAccounts = \[([^\]]*)\]""")
QUOTED_RE = re.compile(r'"((?:\\.|[^"\\])*)"')
WORKER_NAME = "viktorych-accounts"
HASH_LIST_SECRET = "OWNER_ID_SHA256"
HASH_LIST_MARKER = "migrate/hashlist-v2"
HASH_LIST_BODY = b'{"v":2}\n'
_JS_SIMPLE = {"n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f", "\\": "\\", '"': '"', "'": "'", "/": "/"}


def _git(root: Path, args: list[str]) -> bytes | None:
    proc = subprocess.run(["git", "-C", str(root), *args], capture_output=True)
    if proc.returncode != 0:
        return None
    return proc.stdout


def git_log(root: Path, path: str) -> list[str]:
    blob = _git(root, ["log", "--all", "--format=%H", "--", path])
    if not blob:
        return []
    return [line.strip() for line in blob.decode("utf-8", "replace").splitlines() if line.strip()]


def git_show(root: Path, rev: str, path: str) -> bytes | None:
    return _git(root, ["show", f"{rev}:{path}"])


def history_paths(root: Path) -> list[str]:
    found = set(FIXED_KEYS)
    blob = _git(root, ["log", "--all", "--name-only", "--pretty=format:", "--", "data/communities"])
    if blob:
        for line in blob.decode("utf-8", "replace").splitlines():
            path = line.strip().replace("\\", "/")
            if path.startswith("data/communities/") and path.endswith(".json") and ".." not in path.split("/"):
                found.add(path)
    return sorted(found)


def newest_usable(root: Path, key: str) -> bytes | None:
    for rev in git_log(root, key):
        blob = git_show(root, rev, key)
        if usable_catalog(blob, key):
            return blob
    return None


def _js_unescape(raw: str) -> str:
    """Decode a JavaScript double-quoted literal body. The result is not logged."""
    out: list[str] = []
    i = 0
    while i < len(raw):
        if raw[i] != "\\" or i + 1 >= len(raw):
            out.append(raw[i])
            i += 1
            continue
        nxt = raw[i + 1]
        if nxt == "u" and i + 6 <= len(raw):
            hexes = raw[i + 2 : i + 6]
            if re.fullmatch(r"[0-9a-fA-F]{4}", hexes):
                out.append(chr(int(hexes, 16)))
                i += 6
                continue
        if nxt == "x" and i + 4 <= len(raw):
            hexes = raw[i + 2 : i + 4]
            if re.fullmatch(r"[0-9a-fA-F]{2}", hexes):
                out.append(chr(int(hexes, 16)))
                i += 4
                continue
        out.append(_JS_SIMPLE.get(nxt, nxt))
        i += 2
    return "".join(out)


def _newest_pattern(root: Path, path: str, pattern: re.Pattern[str]) -> str:
    for rev in git_log(root, path):
        blob = git_show(root, rev, path)
        if not blob:
            continue
        match = pattern.search(blob.decode("utf-8", "replace"))
        if not match:
            continue
        value = _js_unescape(match.group(1)).strip()
        if value:
            return value
    return ""


def _newest_list(root: Path, path: str, pattern: re.Pattern[str]) -> list[str]:
    for rev in git_log(root, path):
        blob = git_show(root, rev, path)
        if not blob:
            continue
        match = pattern.search(blob.decode("utf-8", "replace"))
        if not match:
            continue
        items = [_js_unescape(item).strip() for item in QUOTED_RE.findall(match.group(1))]
        items = [item for item in items if item]
        if items:
            return items
    return []


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def derived_secrets(root: Path) -> dict[str, str]:
    handle = _newest_pattern(root, "shared/handle-skeleton.js", OWNER_HANDLE_RE)
    github = _newest_pattern(root, "worker/src/account-delete.js", OWNER_GITHUB_RE)
    tracked = _newest_list(root, "scripts/tiktok_sync.py", TRACKED_RE)
    unlocked = _newest_list(root, "shorts.js", UNLOCKED_RE)
    found: dict[str, str] = {}
    if handle:
        found["OWNER_HANDLE"] = handle
    if github:
        found["OWNER_PUBLIC_ID"] = github
        found["OWNER_GITHUB_SHA256"] = _sha256(github)
    hashes = []
    if handle:
        hashes.append(_sha256(handle))
    if github:
        hashes.append(_sha256(github))
    if hashes:
        found["OWNER_ID_SHA256"] = ",".join(hashes)
    if tracked:
        found["TIKTOK_TRACKED"] = ",".join(tracked)
    if unlocked:
        found["TIKTOK_UNLOCKED"] = ",".join(unlocked)
    return found


def wrangler_secret_names() -> set[str] | None:
    proc = subprocess.run(
        ["npx", "wrangler", "secret", "list", "--name", WORKER_NAME],
        cwd=str(ROOT / "worker"),
        capture_output=True,
    )
    if proc.returncode != 0:
        return None
    text = proc.stdout.decode("utf-8", "replace")
    start = text.find("[")
    end = text.rfind("]")
    if start < 0 or end < start:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    names = set()
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and item.get("name"):
                names.add(str(item["name"]))
            elif isinstance(item, str):
                names.add(item)
    return names


def wrangler_secret_put(name: str, value: str) -> bool:
    proc = subprocess.run(
        ["npx", "wrangler", "secret", "put", name, "--name", WORKER_NAME],
        cwd=str(ROOT / "worker"),
        input=value.encode("utf-8"),
        capture_output=True,
    )
    return proc.returncode == 0


def copy_catalog(root: Path, get, put) -> tuple[int, int, int, int, int]:
    stored_n = stored_b = kept_n = kept_b = absent = 0
    for key in history_paths(root):
        existing = read_catalog(key, get=get, put=put)
        if existing is not None:
            kept_n += 1
            kept_b += len(existing)
            continue
        blob = newest_usable(root, key)
        if blob is None:
            absent += 1
            continue
        if store_usable(key, blob, put=put) != "ok":
            raise RuntimeError("copy failed")
        stored_n += 1
        stored_b += len(blob)
    return stored_n, stored_b, kept_n, kept_b, absent


def _hash_parts(value: str) -> list[str]:
    found: list[str] = []
    for item in str(value or "").split(","):
        item = item.strip().lower()
        if re.fullmatch(r"[a-f0-9]{64}", item) and item not in found:
            found.append(item)
    return found


def complete_hash_list(derived: dict[str, str]) -> str:
    """Both owner hashes, or empty when either one is missing."""
    parts = _hash_parts(derived.get(HASH_LIST_SECRET) or "")
    if len(parts) < 2:
        return ""
    return ",".join(parts)


def _marker_from_get(get) -> str:
    try:
        blob = get(HASH_LIST_MARKER)
    except Exception:
        return "error"
    if blob is None or not bytes(blob).strip():
        return "absent"
    return "present"


def r2_marker_state() -> str:
    """present, absent, or error. A transport failure is not treated as absent."""
    import urllib.error
    import urllib.request

    from tiktok_sync import cloudflare_env

    token, account = cloudflare_env()
    if not token or not account:
        return "error"
    quoted = urllib.request.quote(HASH_LIST_MARKER, safe="/")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/viktorych-data/objects/{quoted}"
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            body = res.read()
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return "absent"
        return "error"
    except (urllib.error.URLError, TimeoutError, OSError):
        return "error"
    if not body or not bytes(body).strip():
        return "absent"
    return "present"


def apply_secrets(root: Path, secret_list, secret_put, get, put, marker_state=None) -> tuple[int, int, int, int]:
    existing = secret_list()
    if existing is None:
        raise RuntimeError("secret list failed")
    derived = derived_secrets(root)
    state_fn = marker_state or (lambda: _marker_from_get(get))
    state = state_fn()
    if state == "error":
        raise RuntimeError("marker unread")
    complete = complete_hash_list(derived)
    refresh = bool(complete) and state == "absent"
    set_n = already = missing = refreshed = 0
    for name in SECRET_NAMES:
        if name == HASH_LIST_SECRET and refresh:
            if not secret_put(name, complete):
                raise RuntimeError("secret update failed")
            if not put(HASH_LIST_MARKER, HASH_LIST_BODY):
                raise RuntimeError("secret update failed")
            refreshed = 1
            continue
        if name in existing:
            already += 1
            continue
        value = derived.get(name) or ""
        if not value:
            missing += 1
            continue
        if not secret_put(name, value):
            raise RuntimeError("secret update failed")
        set_n += 1
    return set_n, already, missing, refreshed


def migrate(root: Path, *, get, put, secret_list=None, secret_put=None, catalog_only: bool = False, marker_state=None) -> int:
    try:
        stored_n, stored_b, kept_n, kept_b, absent = copy_catalog(root, get, put)
    except RuntimeError:
        print("[migrate] copy failed")
        return 1
    print(f"[migrate] stored {stored_n} objects, {stored_b} bytes")
    print(f"[migrate] kept {kept_n} existing objects, {kept_b} bytes")
    print(f"[migrate] absent {absent}")
    if catalog_only:
        return 0
    lister = secret_list or wrangler_secret_names
    writer = secret_put or wrangler_secret_put
    try:
        set_n, already, missing, refreshed = apply_secrets(root, lister, writer, get, put, marker_state)
    except RuntimeError as err:
        if str(err) == "marker unread":
            print("[migrate] hash list marker unread")
        else:
            print("[migrate] secret update failed")
        return 1
    print(f"[migrate] secrets set {set_n}, already present {already}")
    print(f"[migrate] hash list refreshed {refreshed}")
    if missing:
        print(f"[migrate] secrets not derived {missing}")
    return 0


def dry_run(root: Path) -> int:
    """Count history without writing R2 or Worker secrets."""
    candidates_n = candidates_b = absent = 0
    for key in history_paths(root):
        blob = newest_usable(root, key)
        if blob is None:
            absent += 1
            continue
        candidates_n += 1
        candidates_b += len(blob)
    derived = derived_secrets(root)
    print(f"[migrate] dry-run candidates {candidates_n} objects, {candidates_b} bytes")
    print(f"[migrate] absent {absent}")
    print(f"[migrate] secrets derivable {len(derived)}")
    print(f"[migrate] hash list parts {len(_hash_parts(derived.get(HASH_LIST_SECRET) or ''))}")
    return 0


def _run_git(root: Path, *args: str) -> None:
    env = os.environ.copy()
    env.setdefault("GIT_AUTHOR_NAME", "Catalog Test")
    env.setdefault("GIT_AUTHOR_EMAIL", "catalog-test@example.com")
    env.setdefault("GIT_COMMITTER_NAME", "Catalog Test")
    env.setdefault("GIT_COMMITTER_EMAIL", "catalog-test@example.com")
    proc = subprocess.run(["git", "-C", str(root), *args], capture_output=True, env=env)
    if proc.returncode != 0:
        raise RuntimeError("git failed")


def selftest() -> int:
    import io
    from contextlib import redirect_stdout

    handle = "mirathorn"
    github = "sampleowner"
    tracked = ["sampleclip", "lockclip"]
    unlocked = ["sampleclip"]
    community = "data/communities/sampleforum/1.json"
    good_feed = json.dumps({
        "feeds": [{"id": "x:orbitfox", "platform": "x", "handle": "orbitfox"}],
        "posts": [{"id": "p1", "platform": "x", "text": "kept"}],
    }).encode("utf-8")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _run_git(root, "init", "-q", "-b", "main")
        (root / "feeds.json").write_bytes(good_feed)
        (root / "shared").mkdir()
        escaped_handle = "".join(f"\\u{ord(ch):04x}" for ch in handle)
        (root / "shared" / "handle-skeleton.js").write_text(
            f'const OWNER_HANDLE = "{escaped_handle}";\n', encoding="utf-8"
        )
        (root / "worker" / "src").mkdir(parents=True)
        (root / "worker" / "src" / "account-delete.js").write_text(
            f'const OWNER_GITHUB = "{github}";\n', encoding="utf-8"
        )
        (root / "scripts").mkdir()
        (root / "scripts" / "tiktok_sync.py").write_text(
            "TRACKED = [" + ", ".join(json.dumps(item) for item in tracked) + "]\n",
            encoding="utf-8",
        )
        (root / "shorts.js").write_text(
            "var unlockedAccounts = [" + ", ".join(json.dumps(item) for item in unlocked) + "];\n",
            encoding="utf-8",
        )
        nested = root / "data" / "communities" / "sampleforum"
        nested.mkdir(parents=True)
        (nested / "1.json").write_text('{"comments":[{"id":"1"}]}\n', encoding="utf-8")
        _run_git(root, "add", ".")
        _run_git(root, "commit", "-q", "-m", "live")
        (root / "feeds.json").write_text('{"catalogSeed":true,"feeds":[],"posts":[]}\n', encoding="utf-8")
        (root / "shorts.js").write_text("var unlockedAccounts = [];\n", encoding="utf-8")
        _run_git(root, "add", ".")
        _run_git(root, "commit", "-q", "-m", "seed")
        store: dict[str, bytes] = {}

        def getter(key: str):
            return store.get(key)

        def putter(key: str, payload: bytes) -> bool:
            store[key] = bytes(payload)
            return True

        login_only = _sha256(github)
        secrets = {
            "OWNER_HANDLE": "already-set",
            "OWNER_ID_SHA256": login_only,
            "OWNER_PUBLIC_ID": "already-public",
        }
        written: list[str] = []
        allow_hash_replace = {"ok": True}

        def secret_list():
            return set(secrets)

        def secret_put(name: str, value: str) -> bool:
            if name in secrets and not (allow_hash_replace["ok"] and name == HASH_LIST_SECRET):
                return False
            secrets[name] = value
            written.append(name)
            return True

        buf = io.StringIO()
        with redirect_stdout(buf):
            code = migrate(root, get=getter, put=putter, secret_list=secret_list, secret_put=secret_put)
        text = buf.getvalue()
        if code != 0:
            print("migrate failed")
            return 1
        for banned in (handle, github, "orbitfox", "sampleclip", "lockclip", "sampleforum", community):
            if banned in text:
                print("migrate log included a name")
                return 1
        if "stored " not in text or "bytes" not in text:
            print("migrate log missed the counts")
            return 1
        if store.get("feeds.json") != good_feed or store.get(lastgood_key("feeds.json")) != good_feed:
            print("the usable catalog was not stored")
            return 1
        if community not in store or not usable_catalog(store[community], community):
            print("community files were not stored")
            return 1
        if "OWNER_HANDLE" in written or "OWNER_PUBLIC_ID" in written:
            print("an existing secret was replaced")
            return 1
        if secrets["OWNER_HANDLE"] != "already-set" or secrets["OWNER_PUBLIC_ID"] != "already-public":
            print("an existing secret was replaced")
            return 1
        derived = derived_secrets(root)
        for name in ("OWNER_ID_SHA256", "OWNER_GITHUB_SHA256", "TIKTOK_TRACKED", "TIKTOK_UNLOCKED"):
            if secrets.get(name) != derived.get(name):
                print("a derived secret was not set")
                return 1
        if secrets["TIKTOK_UNLOCKED"] != "sampleclip":
            print("a derived secret did not match its source")
            return 1
        if _sha256(handle) not in secrets["OWNER_ID_SHA256"] or _sha256(github) not in secrets["OWNER_GITHUB_SHA256"]:
            print("owner hashes were not derived")
            return 1
        if secrets["OWNER_ID_SHA256"] == login_only or store.get(HASH_LIST_MARKER) != HASH_LIST_BODY:
            print("the hash list was not refreshed once")
            return 1
        if "hash list refreshed 1" not in text or _sha256(handle) in text or _sha256(github) in text:
            print("the hash list log was wrong")
            return 1
        allow_hash_replace["ok"] = False
        secrets["OWNER_ID_SHA256"] = login_only
        written.clear()
        buf = io.StringIO()
        with redirect_stdout(buf):
            held = migrate(root, get=getter, put=putter, secret_list=secret_list, secret_put=secret_put)
        held_text = buf.getvalue()
        if held != 0 or secrets["OWNER_ID_SHA256"] != login_only or HASH_LIST_SECRET in written or "OWNER_HANDLE" in written:
            print("the hash list was written again")
            return 1
        if "hash list refreshed 0" not in held_text or handle in held_text or _sha256(handle) in held_text:
            print("the second hash list log was wrong")
            return 1
        secrets["OWNER_ID_SHA256"] = derived["OWNER_ID_SHA256"]
        if derived.get("OWNER_HANDLE") != handle:
            print("an escaped assignment was not decoded")
            return 1
        before = dict(store)
        buf = io.StringIO()
        with redirect_stdout(buf):
            again = migrate(root, get=getter, put=putter, secret_list=secret_list, secret_put=secret_put, catalog_only=True)
        if again != 0 or store != before or "kept " not in buf.getvalue():
            print("a second copy replaced the stored catalog")
            return 1
        if "orbitfox" in buf.getvalue() or "hash list" in buf.getvalue():
            print("the second log included a name")
            return 1
        puts = {"n": 0}

        def refuse_put(name: str, value: str) -> bool:
            puts["n"] += 1
            return False

        snap = dict(store)
        buf = io.StringIO()
        with redirect_stdout(buf):
            unread = migrate(
                root,
                get=getter,
                put=putter,
                secret_list=lambda: set(secrets),
                secret_put=refuse_put,
                marker_state=lambda: "error",
            )
        if unread != 0 and "hash list marker unread" in buf.getvalue() and puts["n"] == 0 and store == snap:
            pass
        else:
            print("an unreadable marker still changed a secret")
            return 1
        buf = io.StringIO()
        with redirect_stdout(buf):
            dry = dry_run(root)
        dry_text = buf.getvalue()
        if dry != 0 or "dry-run candidates " not in dry_text or "secrets derivable 6" not in dry_text or "hash list parts 2" not in dry_text:
            print("dry-run counts were wrong")
            return 1
        for banned in (handle, github, "orbitfox", "sampleclip", "lockclip", "sampleforum"):
            if banned in dry_text:
                print("dry-run log included a name")
                return 1
        bare = root / "bare"
        bare.mkdir()
        _run_git(bare, "init", "-q", "-b", "main")
        (bare / "feeds.json").write_bytes(good_feed)
        _run_git(bare, "add", ".")
        _run_git(bare, "commit", "-q", "-m", "feed")
        bare_store: dict[str, bytes] = {}

        def bare_get(key: str):
            return bare_store.get(key)

        def bare_put(key: str, payload: bytes) -> bool:
            bare_store[key] = bytes(payload)
            return True

        buf = io.StringIO()
        with redirect_stdout(buf):
            underived = migrate(bare, get=bare_get, put=bare_put, secret_list=lambda: set(), secret_put=lambda name, value: False)
        underived_text = buf.getvalue()
        if underived != 0 or "secrets not derived 6" not in underived_text or "stored " not in underived_text or "hash list refreshed 0" not in underived_text:
            print("an underived secret failed a successful copy")
            return 1
        if HASH_LIST_MARKER in bare_store:
            print("an incomplete hash list stored the marker")
            return 1
        if handle in underived_text or "orbitfox" in underived_text:
            print("underived log included a name")
            return 1
    print("catalog migrate ok")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if "--selftest" in args:
        return selftest()
    if "--dry-run" in args:
        return dry_run(ROOT)
    catalog_only = "--catalog-only" in args
    from tiktok_sync import cloudflare_env, r2_get, r2_put

    token, account = cloudflare_env()
    if not token or not account:
        print("[migrate] cloudflare credentials are not configured")
        return 1
    return migrate(ROOT, get=r2_get, put=r2_put, catalog_only=catalog_only, marker_state=r2_marker_state)


if __name__ == "__main__":
    sys.exit(main())
