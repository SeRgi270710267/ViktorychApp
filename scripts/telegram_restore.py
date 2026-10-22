#!/usr/bin/env python3
"""Download one Telegram backup by its R2 key and check every sha256.

Parts of at most 19 MiB come from https://api.telegram.org. Larger archive
parts come from a local telegram-bot-api server on 127.0.0.1:8081. Account
copies decrypt with TG_BACKUP_KEY. Secret values are never printed.

  python3 scripts/telegram_restore.py --key cold/a.jpg --out restored
  python3 scripts/telegram_restore.py --key cold/a.jpg --manifest manifest.json --out restored
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import telegram_backup as tg


def scrub(text: str) -> str:
    return tg.scrub(text, tg.current_secrets())


def safe_name(name: str, fallback: str) -> str:
    base = Path(str(name or fallback)).name
    if not base or base in {".", ".."} or "/" in str(name or "") or "\\" in str(name or ""):
        return fallback
    return base


def call(api_base: str, token: str, method: str, fields: dict) -> dict:
    url = api_base.rstrip("/") + "/bot" + token + "/" + method
    data = urllib.parse.urlencode(fields).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"User-Agent": tg.UA, "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=180) as res:
            raw = res.read()
    except urllib.error.HTTPError as err:
        raw = err.read()
    except urllib.error.URLError as err:
        raise RuntimeError("network error") from err
    try:
        parsed = json.loads(raw.decode("utf-8", "replace"))
    except json.JSONDecodeError as err:
        raise RuntimeError("telegram returned a non-json body") from err
    if not isinstance(parsed, dict) or not parsed.get("ok"):
        description = str((parsed or {}).get("description") or "telegram error") if isinstance(parsed, dict) else "telegram error"
        raise RuntimeError(scrub(description))
    result = parsed.get("result")
    if not isinstance(result, dict):
        raise RuntimeError("telegram returned an unexpected body")
    return result


def file_url(api_base: str, token: str, file_path: str) -> str:
    path = str(file_path or "").lstrip("/")
    lowered = path.lower()
    if not path or ".." in path.split("/") or lowered.startswith("http:") or lowered.startswith("https:"):
        raise RuntimeError("telegram returned an unsafe file path")
    return api_base.rstrip("/") + "/file/bot" + token + "/" + urllib.parse.quote(path, safe="/")


def download_file_id(api_base: str, token: str, file_id: str, dest: Path) -> None:
    result = call(api_base, token, "getFile", {"file_id": file_id})
    url = file_url(api_base, token, str(result.get("file_path") or ""))
    req = urllib.request.Request(url, headers={"User-Agent": tg.UA})
    try:
        with urllib.request.urlopen(req, timeout=3600) as res, dest.open("wb") as out:
            while True:
                block = res.read(1024 * 1024)
                if not block:
                    break
                out.write(block)
    except urllib.error.URLError as err:
        raise RuntimeError("network error") from err


def api_for(size: int) -> str:
    if int(size) <= tg.public_bytes():
        return tg.PUBLIC_API
    if tg.has_local_credentials():
        return tg.LOCAL_API
    raise RuntimeError("this part is larger than 19 MiB and the local server credentials are not set")


def check_hash(path: Path, expect: str) -> None:
    if tg.hash_file(path) != expect:
        raise RuntimeError("sha256 mismatch")


def copy_checked(src: Path, dest, expect: str) -> None:
    digest = hashlib.sha256()
    with src.open("rb") as handle:
        while True:
            block = handle.read(1024 * 1024)
            if not block:
                break
            digest.update(block)
            dest.write(block)
    if digest.hexdigest() != expect:
        raise RuntimeError("sha256 mismatch")


def parts_of(entry: dict, role: str) -> list:
    rows = [part for part in entry.get("parts") or [] if part.get("role") == role and part.get("file_id")]
    rows.sort(key=lambda part: int(part.get("index") or 0))
    return rows


def load_manifest(path: str) -> dict:
    import tempfile
    if path:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("files"), list):
            raise RuntimeError("the manifest is not a telegram backup")
        return data
    token = os_environ("CLOUDFLARE_API_TOKEN")
    account = os_environ("CLOUDFLARE_ACCOUNT_ID")
    if not token or not account:
        raise RuntimeError("pass --manifest or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID")
    buckets = tg.bucket_names(token, account)
    directory = Path(tempfile.mkdtemp(prefix="tg-restore-"))
    try:
        manifest, _bucket = tg.load_remote_manifest(token, account, buckets, directory)
    finally:
        tg.shutil.rmtree(directory, ignore_errors=True)
    return manifest


def os_environ(name: str) -> str:
    import os
    return (os.environ.get(name) or "").strip()


def find_rows(manifest: dict, key: str, bucket: str) -> list:
    rows = []
    for row in manifest.get("files") or []:
        if not isinstance(row, dict) or row.get("key") != key:
            continue
        if bucket and row.get("bucket") != bucket:
            continue
        rows.append(row)
    return rows


def restore_entry(entry: dict, token: str, out_root: Path, work: Path) -> Path:
    key = str(entry.get("key") or "")
    if not key or ".." in key.split("/"):
        raise RuntimeError("the manifest key is not safe")
    dest = out_root / key
    dest.parent.mkdir(parents=True, exist_ok=True)
    kind = entry.get("kind")
    if kind == "hls":
        folder = dest if dest.suffix == "" else dest.with_suffix("")
        if folder.exists() and not folder.is_dir():
            folder = dest.parent / (dest.name + "-hls")
        folder.mkdir(parents=True, exist_ok=True)
        for role, fallback in (("init", "init.mp4"), ("segment", "segment.bin"), ("playlist", "index.m3u8")):
            for part in parts_of(entry, role):
                name = safe_name(str(part.get("name") or ""), fallback if role != "segment" else "seg-%05d.bin" % int(part.get("index") or 0))
                target = folder / name
                api = api_for(int(part.get("size") or 0))
                download_file_id(api, token, str(part["file_id"]), target)
                check_hash(target, str(part.get("sha256") or ""))
        return folder
    if kind == "archive":
        whole = hashlib.sha256()
        with dest.open("wb") as out:
            for part in parts_of(entry, "part"):
                chunk = work / ("part-%s.bin" % part.get("index"))
                api = api_for(int(part.get("size") or 0))
                download_file_id(api, token, str(part["file_id"]), chunk)
                check_hash(chunk, str(part.get("sha256") or ""))
                with chunk.open("rb") as handle:
                    while True:
                        block = handle.read(1024 * 1024)
                        if not block:
                            break
                        whole.update(block)
                        out.write(block)
                chunk.unlink(missing_ok=True)
        expect = str(entry.get("sha256") or "")
        if expect and whole.hexdigest() != expect:
            raise RuntimeError("sha256 mismatch")
        return dest
    files = parts_of(entry, "file")
    if len(files) != 1:
        raise RuntimeError("the manifest entry has no file part")
    part = files[0]
    api = api_for(int(part.get("size") or 0))
    blob = work / "download.bin"
    download_file_id(api, token, str(part["file_id"]), blob)
    check_hash(blob, str(part.get("sha256") or ""))
    if kind == "account" or entry.get("encrypted"):
        if not tg.backup_key():
            raise RuntimeError("TG_BACKUP_KEY is required to decrypt this copy")
        tg.decrypt_file(blob, dest)
        expect = str(entry.get("sha256") or "")
        if expect:
            check_hash(dest, expect)
    else:
        blob.replace(dest)
    blob.unlink(missing_ok=True)
    return dest


def restore(key: str, out: Path, manifest_path: str, bucket: str) -> Path:
    import os
    import tempfile
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not set")
    manifest = load_manifest(manifest_path)
    rows = find_rows(manifest, key, bucket)
    if len(rows) != 1:
        raise RuntimeError("the manifest does not have one matching key")
    out.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="tg-restore-"))
    try:
        return restore_entry(rows[0], token, out, directory)
    finally:
        tg.shutil.rmtree(directory, ignore_errors=True)


def selftest() -> int:
    import tempfile
    plain = b"hello telegram restore"
    first, second = plain[:8], plain[8:]
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        a = folder / "a.bin"
        b = folder / "b.bin"
        joined = folder / "joined.bin"
        a.write_bytes(first)
        b.write_bytes(second)
        check_hash(a, hashlib.sha256(first).hexdigest())
        whole = hashlib.sha256()
        with joined.open("wb") as out:
            copy_checked(a, out, hashlib.sha256(first).hexdigest())
            copy_checked(b, out, hashlib.sha256(second).hexdigest())
            whole.update(first)
            whole.update(second)
        if joined.read_bytes() != plain or whole.hexdigest() != hashlib.sha256(plain).hexdigest():
            print("FAIL join", file=sys.stderr)
            return 1
        try:
            check_hash(a, "0" * 64)
        except RuntimeError as err:
            if "sha256" not in str(err):
                print("FAIL mismatch text", file=sys.stderr)
                return 1
        else:
            print("FAIL expected mismatch", file=sys.stderr)
            return 1
        if file_url(tg.PUBLIC_API, "123:abc", "documents/file.txt").endswith("/documents/file.txt"):
            pass
        else:
            print("FAIL file url", file=sys.stderr)
            return 1
        try:
            file_url(tg.PUBLIC_API, "123:abc", "../secret")
        except RuntimeError:
            pass
        else:
            print("FAIL unsafe path", file=sys.stderr)
            return 1
    leaked = scrub("token sentinel-secret-value")
    if "sentinel-secret-value" in leaked and "sentinel-secret-value" in (tg.current_secrets()):
        print("FAIL secret printed", file=sys.stderr)
        return 1
    print("telegram restore selftest ok")
    return 0


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(description="Restore one file from the Telegram backup")
    parser.add_argument("--key", default="")
    parser.add_argument("--out", default="restored")
    parser.add_argument("--manifest", default="")
    parser.add_argument("--bucket", default="")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    if args.selftest:
        return selftest()
    if not args.key:
        print("pass --key", file=sys.stderr)
        return 2
    try:
        dest = restore(args.key, Path(args.out), args.manifest, args.bucket)
    except Exception as err:
        print("[telegram-restore] " + scrub(str(err)), file=sys.stderr)
        return 1
    print("[telegram-restore] wrote " + str(dest))
    return 0


if __name__ == "__main__":
    sys.exit(main())
