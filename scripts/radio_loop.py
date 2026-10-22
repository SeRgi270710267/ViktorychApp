#!/usr/bin/env python3
"""Build and publish the ViktorychMusic static loop.

The masters are 44.1 kHz 16-bit stereo WAV files. The publish writes a
lossless fMP4 FLAC HLS playlist and an AAC-LC 256 kbps MPEG-TS fallback,
then points loop/current.json at that version. The site never links the
masters, and this script does not upload anything to the Internet Archive.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_BASE = "https://pub-bf9b5e3ebb2b421aa49e7af484f3c22d.r2.dev"
EPOCH = 1792627200
SEGMENT_S = 10
# "tg" starts playback on the Telegram mirror. Any other value stays on R2.
LOOP_PRIMARY = "tg"
# Heard order of the Radio masters. File ids are build inputs, not playback URLs.
MASTERS = (
    ("america.wav", "1szR2F6ttCOiopBdmrsd78JYAxzkGKBWW"),
    ("bandera.wav", "1cg3YOpD1E56h1V6BAM8TVV1wJKT2_N2r"),
    ("centinela.wav", "1VAC5EicmleJId6rSm5SuR3_iwyvVGu6a"),
    ("clone2.wav", "1sU0faa9TA-izYamJw7A9fjGYK8GkOVJ9"),
    ("laroute.wav", "1HJKFZg5pprpaXlRqD758FWDjoYnuOZiy"),
    ("scheo2.wav", "1-XG9DJzOos1iIi9sziPSZd6tdePCU_XO"),
    ("scheoki1.wav", "1UTWBZRhKr5t-wLzctn0_4hEr8UyveoP6"),
    ("scheoki.wav", "1a-ilNKSh3OCZJNsav6_ZxyMo2tgA1yzf"),
    ("sheleft.wav", "1_PfwfHibXfv91T-Dfv1_lwDwXmIFJBW0"),
    ("sveriges.wav", "1wERvuenYvnIU1oYuChMr9WdaGYQdIs4s"),
    ("pobedy.wav", "1RFdGxWm_GfaPEV7oLB8oFx3sSzZlxkSo"),
    ("nash.wav", "1zHTUkZhO2ZhtkhQDSpcIp0dIZrA0I2eD"),
)


def health_index_ok(duration: float, segment_duration: float, count: int) -> bool:
    """The radio health check addresses floor(position / segment_duration)."""
    if duration <= 0 or segment_duration <= 0 or count < 1:
        return False
    index = math.floor((duration - 1e-6) / segment_duration)
    return 0 <= index < count


def playlist_duration(text: str) -> tuple[int, float, float]:
    count = 0
    total = 0.0
    longest = 0.0
    for line in text.splitlines():
        if not line.startswith("#EXTINF:"):
            continue
        value = float(line.split(":", 1)[1].rstrip(","))
        count += 1
        total += value
        longest = max(longest, value)
    return count, total, longest


def raise_target(text: str) -> str:
    _count, _total, longest = playlist_duration(text)
    target = max(1, math.ceil(longest - 1e-6))
    lines = []
    for line in text.splitlines():
        if line.startswith("#EXT-X-TARGETDURATION:"):
            lines.append("#EXT-X-TARGETDURATION:%d" % target)
        else:
            lines.append(line)
    body = "\n".join(lines)
    if text.endswith("\n"):
        body += "\n"
    return body


def primary_value(value: str | None = None) -> str:
    raw = LOOP_PRIMARY if value is None else value
    return "tg" if str(raw or "").strip().lower() == "tg" else "r2"


def durations_match(left: float, right: float) -> bool:
    return abs(float(left) - float(right)) <= 0.05


def build_manifest(version: str, duration: float, updated: str) -> dict:
    base = PUBLIC_BASE + "/loop/" + version
    return {
        "live": True,
        "station": "ViktorychMusic",
        "mode": "loop",
        "codec": "flac",
        "sample_rate": 44100,
        "bits": 16,
        "url": base + "/index.m3u8",
        "fallback": base + "/aac/index.m3u8",
        "duration": round(duration, 6),
        "epoch": EPOCH,
        "segment_duration": SEGMENT_S,
        "version": version,
        "updated": updated,
        "primary": primary_value(),
    }


def fetch_current() -> dict:
    url = PUBLIC_BASE + "/loop/current.json?_=" + str(int(time.time() * 1000))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=60) as res:
        data = json.loads(res.read().decode("utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("loop/current.json is not an object")
    return data


def keep_published_version(existing: dict, duration: float, count: int, playlist_count: int | None) -> bool:
    """Keep the live version when this encode is the same loop.

    A matching duration and segment count means the Telegram mirror already
    has these segments. Replacing the pointer would aim playback at a version
    that is not mirrored yet. A playlist that cannot be read stays put.
    """
    if not isinstance(existing, dict):
        return False
    if str(existing.get("codec") or "") != "flac":
        return False
    version = str(existing.get("version") or "")
    if not version:
        return False
    try:
        segment = int(existing.get("segment_duration") or 0)
        old_duration = float(existing.get("duration"))
    except (TypeError, ValueError):
        return False
    if segment != SEGMENT_S or not durations_match(old_duration, duration):
        return False
    if playlist_count is None:
        return True
    return int(playlist_count) == int(count)


def live_playlist_count(version: str) -> int | None:
    url = PUBLIC_BASE + "/loop/" + urllib.parse.quote(version) + "/index.m3u8"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache"})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            text = res.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, OSError):
        return None
    count, _total, _longest = playlist_duration(text)
    return count


def write_pointer(bucket: str, manifest: dict, dest: Path) -> None:
    dest.write_text(json.dumps(manifest, ensure_ascii=False) + "\n", encoding="utf-8")
    put_object(bucket, "loop/current.json", dest, "application/json", "no-cache")


def _token() -> str:
    return (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()


def _account() -> str:
    return (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()


def _api(method: str, url: str, data: bytes | None = None, headers: dict | None = None, timeout: int = 120):
    req_headers = {"Authorization": "Bearer " + _token()}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def _buckets() -> list[str]:
    names = [
        "viktorych-data",
        "viktorych-music",
        "viktorych-radio",
        "viktorych-public",
        "viktorych",
        "radio",
        "music",
    ]
    status, body = _api(
        "GET",
        "https://api.cloudflare.com/client/v4/accounts/%s/r2/buckets" % _account(),
    )
    if status == 200:
        try:
            parsed = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            parsed = {}
        result = parsed.get("result") if isinstance(parsed, dict) else None
        rows = []
        if isinstance(result, dict):
            rows = result.get("buckets") or []
        elif isinstance(result, list):
            rows = result
        for row in rows:
            if isinstance(row, dict) and row.get("name"):
                names.append(str(row["name"]))
    seen = []
    for name in names:
        if name and name not in seen:
            seen.append(name)
    return seen


def find_bucket() -> str:
    for name in _buckets():
        key = urllib.parse.quote("loop/current.json", safe="/")
        url = "https://api.cloudflare.com/client/v4/accounts/%s/r2/buckets/%s/objects/%s" % (
            _account(),
            urllib.parse.quote(name),
            key,
        )
        status, _body = _api("GET", url, timeout=60)
        if status == 200:
            print("radio bucket", name)
            return name
    raise SystemExit("no R2 bucket holds loop/current.json")


def put_object(bucket: str, key: str, path: Path, content_type: str, cache: str) -> None:
    quoted = urllib.parse.quote(key, safe="/")
    url = "https://api.cloudflare.com/client/v4/accounts/%s/r2/buckets/%s/objects/%s" % (
        _account(),
        urllib.parse.quote(bucket),
        quoted,
    )
    data = path.read_bytes()
    delay = 2
    for attempt in range(5):
        status, body = _api(
            "PUT",
            url,
            data=data,
            headers={"Content-Type": content_type, "Cache-Control": cache},
            timeout=180,
        )
        if status in (200, 201):
            return
        if status not in (408, 429, 500, 502, 503, 504) or attempt == 4:
            raise SystemExit("upload %s failed HTTP %s" % (key, status))
        time.sleep(delay)
        delay = min(delay * 2, 30)
        _ = body


def content_type(name: str) -> str:
    lower = name.lower()
    if lower.endswith(".m3u8"):
        return "application/vnd.apple.mpegurl"
    if lower.endswith(".m4s") or lower.endswith(".mp4"):
        return "video/mp4"
    if lower.endswith(".ts"):
        return "video/mp2t"
    if lower.endswith(".json"):
        return "application/json"
    return "application/octet-stream"


def fetch_masters(dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for name, file_id in MASTERS:
        target = dest / name
        if target.is_file() and target.stat().st_size > 1000 and target.read_bytes()[:4] == b"RIFF":
            continue
        url = "https://drive.usercontent.google.com/download?id=%s&export=download" % file_id
        print("fetch", name)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=300) as res:
            target.write_bytes(res.read())
        if target.read_bytes()[:4] != b"RIFF":
            raise SystemExit(name + " is not a wav")


def encode(wav_dir: Path, out: Path) -> tuple[float, int]:
    flac = out / "flac"
    aac = out / "aac"
    flac.mkdir(parents=True, exist_ok=True)
    aac.mkdir(parents=True, exist_ok=True)
    listing = out / "list.txt"
    rows = []
    for name, _file_id in MASTERS:
        path = (wav_dir / name).resolve()
        if not path.is_file():
            raise SystemExit("missing " + name)
        rows.append("file '%s'" % path.as_posix().replace("'", "'\\''"))
    listing.write_text("\n".join(rows) + "\n", encoding="utf-8")
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
        "-map", "0:a", "-c:a", "flac", "-sample_fmt", "s16", "-ar", "44100", "-ac", "2", "-frame_size", "4096",
        "-f", "hls", "-hls_time", "10", "-hls_playlist_type", "vod", "-hls_segment_type", "fmp4",
        "-hls_fmp4_init_filename", "init.mp4", "-hls_flags", "independent_segments",
        "-hls_segment_filename", str(flac / "seg_%04d.m4s"),
        str(flac / "index.m3u8"),
        "-map", "0:a", "-c:a", "aac", "-profile:a", "aac_low", "-b:a", "256k", "-ar", "44100", "-ac", "2",
        "-metadata", "service_name=ViktorychMusic", "-metadata", "service_provider=ViktorychMusic",
        "-f", "hls", "-hls_time", "10", "-hls_playlist_type", "vod", "-hls_flags", "independent_segments",
        "-hls_segment_filename", str(aac / "seg_%04d.ts"),
        str(aac / "index.m3u8"),
    ]
    subprocess.run(cmd, check=True)
    for playlist in (flac / "index.m3u8", aac / "index.m3u8"):
        playlist.write_text(raise_target(playlist.read_text(encoding="utf-8")), encoding="utf-8")
    count, duration, _longest = playlist_duration((flac / "index.m3u8").read_text(encoding="utf-8"))
    if not health_index_ok(duration, SEGMENT_S, count):
        raise SystemExit("segment grid does not cover the loop")
    if not (flac / "init.mp4").is_file():
        raise SystemExit("flac init segment is missing")
    return duration, count


def _public_ok(url: str) -> bool:
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return res.status == 200
    except urllib.error.HTTPError:
        return False


def wait_for_player(pages: str, timeout_s: int) -> bool:
    deadline = time.time() + timeout_s
    url = pages.rstrip("/") + "/spaces.js"
    while time.time() < deadline:
        try:
            req = urllib.request.Request(url + "?_=" + str(int(time.time())), headers={"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache"})
            with urllib.request.urlopen(req, timeout=60) as res:
                body = res.read().decode("utf-8", "replace")
            if "function loopPlayChoice(" in body and "function flacInMp4(" in body:
                print("player is live")
                return True
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        time.sleep(20)
    print("player wait ended before the FLAC fallback code was on the site")
    return False


def publish(bed: Path, version: str, duration: float, pages: str) -> None:
    if not _token() or not _account():
        raise SystemExit("Cloudflare credentials are not set")
    bucket = find_bucket()
    flac = bed / "flac"
    count, encoded, _longest = playlist_duration(flac.joinpath("index.m3u8").read_text(encoding="utf-8"))
    if not durations_match(encoded, duration):
        duration = encoded
    updated = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    manifest = build_manifest(version, duration, updated)
    try:
        existing = fetch_current()
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
        existing = {}
    playlist_count = live_playlist_count(str(existing.get("version") or "")) if existing.get("version") else None
    if keep_published_version(existing, duration, count, playlist_count):
        kept = dict(existing)
        kept["primary"] = manifest["primary"]
        kept["updated"] = updated
        write_pointer(bucket, kept, bed / "current.json")
        print("kept", kept.get("version"), "primary", kept["primary"])
        return
    aac = bed / "aac"
    immutable = "public, max-age=31536000, immutable"
    files = []
    for path in sorted(flac.iterdir()):
        if path.is_file():
            files.append((path, "loop/%s/%s" % (version, path.name)))
    for path in sorted(aac.iterdir()):
        if path.is_file():
            files.append((path, "loop/%s/aac/%s" % (version, path.name)))
    for path, key in files:
        print("put", key)
        put_object(bucket, key, path, content_type(path.name), immutable)
    probe = PUBLIC_BASE + "/loop/%s/seg_0000.m4s" % version
    if not _public_ok(probe):
        raise SystemExit("public segment is not readable: " + probe)
    if pages:
        wait_for_player(pages, 20 * 60)
    write_pointer(bucket, manifest, bed / "current.json")
    print("published", version, "duration", manifest["duration"], "primary", manifest["primary"])


def set_live_primary() -> None:
    """Write LOOP_PRIMARY onto the live pointer. Does not encode or upload segments."""
    if not _token() or not _account():
        raise SystemExit("Cloudflare credentials are not set")
    bucket = find_bucket()
    current = fetch_current()
    version = str(current.get("version") or "")
    if not version:
        raise SystemExit("loop/current.json has no version")
    current["primary"] = primary_value()
    current["updated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    write_pointer(bucket, current, Path("/tmp/radio-current.json"))
    print("loop primary", current["primary"], "version", version)


def self_check() -> int:
    count, duration, longest = playlist_duration("#EXTINF:10.031020,\nseg_0000.m4s\n#EXTINF:8.4,\nseg_0001.m4s\n")
    assert count == 2 and abs(duration - 18.43102) < 1e-6 and longest > 10
    raised = raise_target("#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10.031020,\nseg.m4s\n")
    assert "#EXT-X-TARGETDURATION:11" in raised
    doc = build_manifest("v1", 2208.532872, "2026-10-22T13:00:00Z")
    assert doc["codec"] == "flac" and doc["sample_rate"] == 44100 and doc["bits"] == 16
    assert doc["url"].endswith("/loop/v1/index.m3u8")
    assert doc["fallback"].endswith("/loop/v1/aac/index.m3u8")
    assert doc["epoch"] == EPOCH and health_index_ok(doc["duration"], doc["segment_duration"], 221)
    assert LOOP_PRIMARY == "tg" and doc["primary"] == "tg"
    assert primary_value("r2") == "r2" and primary_value("nope") == "r2" and primary_value(" TG ") == "tg"
    same = {"codec": "flac", "segment_duration": 10, "duration": 2208.532872, "version": "v202610221355"}
    assert keep_published_version(same, 2208.532872, 221, 221)
    assert keep_published_version(same, 2208.55, 221, None)
    assert not keep_published_version(same, 2208.532872, 221, 220)
    assert not keep_published_version(same, 100.0, 10, 10)
    print("radio loop self-check ok")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the ViktorychMusic FLAC loop")
    parser.add_argument("--self-check", action="store_true")
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--wav-dir", default="")
    parser.add_argument("--out", default="")
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--set-primary", action="store_true")
    parser.add_argument("--pages", default="https://viktorychgroup.github.io/ViktorychApp")
    parser.add_argument("--version", default="")
    args = parser.parse_args(argv)
    if args.self_check:
        return self_check()
    if args.set_primary:
        set_live_primary()
        return 0
    if not _token() or not _account():
        print("radio publish skipped: cloudflare credentials are not set")
        return 1 if args.publish else 0
    wav_dir = Path(args.wav_dir) if args.wav_dir else Path("/tmp/radio-wavs")
    out = Path(args.out) if args.out else Path("/tmp/radio-bed")
    if args.fetch:
        fetch_masters(wav_dir)
    duration, _count = encode(wav_dir, out)
    if args.publish:
        version = args.version or time.strftime("v%Y%m%d%H%M", time.gmtime())
        publish(out, version, duration, args.pages if args.publish else "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
