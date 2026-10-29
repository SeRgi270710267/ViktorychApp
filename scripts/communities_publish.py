#!/usr/bin/env python3
"""Store the community mirror in R2.

The Reddit and Discourse jobs write data/communities. Signed-in readers load
those files from the accounts Worker, so a successful upload does not need a
commit on main. A missing token leaves the files for the git fallback.
Nothing here prints credentials or file bodies.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = ".communities-r2"
COMMUNITY_KEY = re.compile(
    r"^data/communities/(?:index|[a-z0-9_]{2,21})\.json$"
    r"|^data/communities/[a-z0-9_]{2,21}/\d{1,20}\.json$"
)


def publish(root: Path) -> bool:
    from tiktok_sync import cloudflare_env, r2_put

    marker = root / MARKER
    try:
        marker.unlink()
    except FileNotFoundError:
        pass
    token, account = cloudflare_env()
    if not token or not account:
        print("[communities] R2 credentials are not set; the git mirror remains the fallback")
        return False
    folder = root / "data" / "communities"
    if not folder.is_dir():
        print("[communities] no community directory")
        return False
    keys = []
    for path in sorted(folder.rglob("*.json")):
        if not path.is_file() or path.is_symlink():
            continue
        key = path.relative_to(root).as_posix()
        if COMMUNITY_KEY.match(key):
            keys.append((key, path))
    if not keys:
        print("[communities] no community files")
        return False
    failed = 0
    for key, path in keys:
        if not r2_put(key, path.read_bytes()):
            failed += 1
            print(f"[communities] upload failed {key}")
    if failed:
        print(f"[communities] {failed} uploads failed; not marking R2")
        return False
    marker.write_text("ok\n", encoding="utf-8")
    print(f"[communities] stored {len(keys)} files")
    return True


def selftest() -> int:
    import tempfile

    import tiktok_sync

    def check(cond, message):
        if not cond:
            raise SystemExit("FAIL: " + message)
        print("ok", message)

    check(COMMUNITY_KEY.match("data/communities/index.json"), "the index is a community file")
    check(COMMUNITY_KEY.match("data/communities/teslamotors.json"), "a subreddit file is a community file")
    check(COMMUNITY_KEY.match("data/communities/grapheneos/42.json"), "a topic comment page is a community file")
    check(not COMMUNITY_KEY.match("data/communities/../secrets.json"), "a path escape is not a community file")
    check(not COMMUNITY_KEY.match("data/communities/grapheneos/not-a-topic.json"), "a topic file is numeric")

    saved_put = tiktok_sync.r2_put
    saved_env = tiktok_sync.cloudflare_env
    try:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "data" / "communities" / "grapheneos"
            folder.mkdir(parents=True)
            (root / "data" / "communities" / "index.json").write_text("{}\n", encoding="utf-8")
            (root / "data" / "communities" / "teslamotors.json").write_text("{}\n", encoding="utf-8")
            (folder / "42.json").write_text("{}\n", encoding="utf-8")
            (folder / "note.json").write_text("{}\n", encoding="utf-8")
            seen = []

            def put(key, payload):
                seen.append((key, payload))
                return True

            tiktok_sync.cloudflare_env = lambda: ("token", "account")
            tiktok_sync.r2_put = put
            check(publish(root) is True and (root / MARKER).is_file(), "a full upload marks R2")
            check(
                [key for key, _payload in seen] == [
                    "data/communities/grapheneos/42.json",
                    "data/communities/index.json",
                    "data/communities/teslamotors.json",
                ],
                "only catalog files are uploaded",
            )
            check(all(body == b"{}\n" for _key, body in seen), "the upload sends the file bytes")

            def fail(key, payload):
                return False

            tiktok_sync.r2_put = fail
            check(publish(root) is False and not (root / MARKER).is_file(), "a failed upload does not mark R2")
            tiktok_sync.cloudflare_env = lambda: ("", "")
            check(publish(root) is False and not (root / MARKER).is_file(), "missing credentials leave the git fallback")
    finally:
        tiktok_sync.r2_put = saved_put
        tiktok_sync.cloudflare_env = saved_env
    nested = r"data/communities/[a-z0-9_]{2,21}/\d{1,20}\.json"
    for rel in (
        "worker/src/index.js",
        "accounts.js",
        "scripts/accounts_publish.py",
        "scripts/telegram_backup.py",
    ):
        text = (ROOT / rel).read_text(encoding="utf-8")
        check(nested in text or nested.replace("/", r"\/") in text, rel + " serves a topic comment page")
    workflow = (ROOT / ".github" / "workflows" / "reddit.yml").read_text(encoding="utf-8")
    check(".communities-r2" in workflow and "not committing" in workflow, "the mirror skips the commit after R2 stores it")
    print("communities publish selftest ok")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if "--selftest" in args:
        return selftest()
    publish(ROOT)
    return 0


if __name__ == "__main__":
    try:
        from log_redact import auto as _redact_logs

        _redact_logs()
    except ImportError:
        pass
    sys.exit(main())
