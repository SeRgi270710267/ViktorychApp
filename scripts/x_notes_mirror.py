#!/usr/bin/env python3
"""Mirror X's shown Community Notes for the X posts we carry.

X publishes the Community Notes data as free daily downloads
(https://communitynotes.x.com/guide/en/under-the-hood/download-data).
We only need two files: notes (the text) and noteStatusHistory (which
notes are currently shown). Both are big zips, so they are streamed and
filtered on the fly: only notes on tweet IDs that are in our feeds are
kept, and nothing else from the files is stored. No ratings are kept.

Output goes to the private R2 bucket, never to the public repo:
  cnotes/x/<shard>.json   {"v":1,"notes":[{id, ref, cls, reasons, text,
                           sources, media, created, statusAt}]}
  cnotes/x/manifest.json  {"hash", "at", "count", "day"}
The Worker merges these into the public note shards it publishes, with
the "From X Community Notes" label, and the owner's hide/show applies.

Runs at most once a day from update_feeds.py (an R2 marker), only when
the refresh has time left, and gives up quietly when over its own cap.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import time
import urllib.request
import zlib
from datetime import datetime, timedelta, timezone

BASE = "https://ton.twimg.com/birdwatch-public-data"
SHARDS = 16
SHOWN = "CURRENTLY_RATED_HELPFUL"
REASONS = {
    "misleadingFactualError": "factual_error",
    "misleadingManipulatedMedia": "manipulated_media",
    "misleadingOutdatedInformation": "outdated",
    "misleadingMissingImportantContext": "missing_context",
    "misleadingUnverifiedClaimAsFact": "unverified_claim",
    "misleadingSatire": "satire",
    "misleadingOther": "other",
    "notMisleadingFactuallyCorrect": "factually_correct",
    "notMisleadingOutdatedButNotWhenWritten": "outdated_but_not_when_written",
    "notMisleadingClearlySatire": "clearly_satire",
    "notMisleadingPersonalOpinion": "personal_opinion",
    "notMisleadingOther": "other",
}
URL_RE = re.compile(r"https?://[^\s<>\"]+", re.I)
TEXT_MAX = 1200

def shard_of(ref: str) -> str:
    """Same FNV-1a shard as worker/src/community-notes.js shardOf()."""
    h = 2166136261
    for ch in ref:
        h ^= ord(ch) & 0xFF
        h = (h * 16777619) & 0xFFFFFFFF
    return format(h % SHARDS, "x")


def tweet_ids(posts) -> set[str]:
    """X status IDs in the feed, including quoted and reply-parent posts."""
    out: set[str] = set()

    def walk(post, depth=0):
        if not isinstance(post, dict) or depth > 3:
            return
        if str(post.get("platform") or "").lower() in ("x", "twitter"):
            sid = str(post.get("statusId") or post.get("id") or "")
            if sid.isdigit() and len(sid) <= 20:
                out.add(sid)
        for key in ("quoted", "replyParent"):
            walk(post.get(key), depth + 1)

    for post in posts or []:
        walk(post)
    return out


def stream_zip_lines(chunks, deadline: float):
    """Yield text lines of the single member of a streamed zip."""
    buf = b""
    it = iter(chunks)
    while len(buf) < 30:
        buf += next(it)
    if buf[:4] != b"PK\x03\x04":
        raise ValueError("not a zip")
    method = int.from_bytes(buf[8:10], "little")
    name_len = int.from_bytes(buf[26:28], "little")
    extra_len = int.from_bytes(buf[28:30], "little")
    start = 30 + name_len + extra_len
    while len(buf) < start:
        buf += next(it)
    rest = buf[start:]
    inflate = zlib.decompressobj(-15) if method == 8 else None
    tail = b""

    def feed(data):
        nonlocal tail
        out = inflate.decompress(data) if inflate else data
        if not out:
            return []
        out = tail + out
        lines = out.split(b"\n")
        tail = lines.pop()
        return lines

    for line in feed(rest):
        yield line
    for chunk in it:
        if time.monotonic() > deadline:
            raise TimeoutError("mirror time cap")
        for line in feed(chunk):
            yield line
        if inflate and inflate.eof:
            break
    if tail:
        yield tail


def http_chunks(url: str, size=1 << 20):
    req = urllib.request.Request(url, headers={"User-Agent": "Viktorych notes mirror"})
    with urllib.request.urlopen(req, timeout=60) as res:
        while True:
            chunk = res.read(size)
            if not chunk:
                return
            yield chunk


def pick_notes(lines, ids: set[str]) -> dict[str, dict]:
    """Notes on our tweets, keyed by noteId."""
    found: dict[str, dict] = {}
    header = None
    tweet_col = -1
    for raw in lines:
        if header is None:
            header = raw.decode("utf-8", "replace").rstrip("\r").split("\t")
            tweet_col = header.index("tweetId")
            continue
        # Cheap pre-filter before the full parse: most lines are skipped.
        parts = raw.split(b"\t", tweet_col + 1)
        if len(parts) <= tweet_col:
            continue
        tid = parts[tweet_col].decode("ascii", "replace")
        if tid not in ids:
            continue
        cells = raw.decode("utf-8", "replace").rstrip("\r").split("\t")
        row = dict(zip(header, cells))
        note = note_from_row(row)
        if note:
            found[row.get("noteId", "")] = note
    return found


def note_from_row(row: dict) -> dict | None:
    nid = str(row.get("noteId") or "")
    tid = str(row.get("tweetId") or "")
    if not nid.isdigit() or not tid.isdigit():
        return None
    text = (row.get("summary") or "").replace("\\n", "\n").strip()[:TEXT_MAX]
    if not text:
        return None
    cls = "not_misleading" if row.get("classification") == "NOT_MISLEADING" else "misleading"
    reasons = sorted({v for k, v in REASONS.items() if row.get(k) == "1"
                      and (k.startswith("notMisleading") == (cls == "not_misleading"))})
    sources = []
    for url in URL_RE.findall(text):
        url = url.rstrip(".,);:!?'\"")
        if url not in sources:
            sources.append(url)
    return {
        "id": nid,
        "ref": "x:" + tid,
        "cls": cls,
        "reasons": reasons,
        "text": text,
        "sources": sources[:10],
        "media": row.get("isMediaNote") == "1",
        "created": int(row.get("createdAtMillis") or 0),
        "statusAt": 0,
    }


def apply_status(lines, notes: dict[str, dict]) -> dict[str, dict]:
    """Keep only notes X currently shows, with when that status began."""
    shown: dict[str, dict] = {}
    header = None
    for raw in lines:
        if header is None:
            header = raw.decode("utf-8", "replace").rstrip("\r").split("\t")
            continue
        nid = raw.split(b"\t", 1)[0].decode("ascii", "replace")
        if nid not in notes:
            continue
        row = dict(zip(header, raw.decode("utf-8", "replace").rstrip("\r").split("\t")))
        if row.get("currentStatus") != SHOWN:
            continue
        note = dict(notes[nid])
        note["statusAt"] = int(row.get("timestampMillisOfCurrentStatus") or 0)
        shown[nid] = note
    return shown


def build_shards(shown: dict[str, dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for nid in sorted(shown):
        note = shown[nid]
        out.setdefault(shard_of(note["ref"]), {"v": 1, "notes": []})["notes"].append(note)
    return out


def digest(shards: dict[str, dict]) -> str:
    blob = json.dumps(shards, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(blob).hexdigest()


def mirror(posts, *, budget: float = 150.0, now: datetime | None = None, get=None, put=None,
           fetch=http_chunks) -> str:
    """Run the daily mirror. Returns a short status line."""
    if get is None or put is None:
        from tiktok_sync import r2_get, r2_put
        get = get or r2_get
        put = put or r2_put
    now = now or datetime.now(timezone.utc)
    day = now.strftime("%Y-%m-%d")
    try:
        old = json.loads((get("cnotes/x/manifest.json") or b"{}").decode() or "{}")
    except Exception:
        old = {}
    if old.get("day") == day:
        return "already mirrored today"
    ids = tweet_ids(posts)
    if not ids:
        return "no X posts"
    deadline = time.monotonic() + budget
    # Today's files appear during the day; fall back to yesterday's.
    last = None
    for back in (0, 1):
        stamp = (now - timedelta(days=back)).strftime("%Y/%m/%d")
        try:
            notes = pick_notes(stream_zip_lines(fetch(f"{BASE}/{stamp}/notes/notes-00000.zip"), deadline), ids)
            shown = apply_status(stream_zip_lines(fetch(
                f"{BASE}/{stamp}/noteStatusHistory/noteStatusHistory-00000.zip"), deadline), notes) if notes else {}
            break
        except TimeoutError:
            return "time cap reached; retry next run"
        except Exception as exc:  # 404 for a day not yet published, network
            last = exc
    else:
        return f"download failed: {last}"
    shards = build_shards(shown)
    stamp_hash = digest(shards)
    if stamp_hash != old.get("hash"):
        for s in (format(i, "x") for i in range(SHARDS)):
            body = shards.get(s, {"v": 1, "notes": []})
            put(f"cnotes/x/{s}.json", json.dumps(body, separators=(",", ":")).encode())
    put("cnotes/x/manifest.json", json.dumps({
        "hash": stamp_hash, "at": int(now.timestamp() * 1000), "count": len(shown), "day": day,
    }).encode())
    return f"{len(shown)} shown notes on {len(ids)} X posts"


def _zip(text: str) -> bytes:
    raw = text.encode()
    comp = zlib.compressobj(9, zlib.DEFLATED, -15)
    data = comp.compress(raw) + comp.flush()
    name = b"x.tsv"
    head = b"PK\x03\x04" + (20).to_bytes(2, "little") + b"\0\0" + (8).to_bytes(2, "little") + b"\0" * 16
    head += len(name).to_bytes(2, "little") + b"\0\0"
    return head + name + data + b"PK\x01\x02"


def selftest() -> None:
    assert shard_of("x:42") == shard_of("x:42") and len(shard_of("x:1")) == 1
    cols = ["noteId", "noteAuthorParticipantId", "createdAtMillis", "tweetId", "classification",
            "believable", "harmful", "validationDifficulty"] + list(REASONS) + [
            "trustworthySources", "summary", "isMediaNote", "isCollaborativeNote"]

    def row(nid, tid, summary, cls="MISINFORMED_OR_POTENTIALLY_MISLEADING", reason="misleadingMissingImportantContext"):
        cells = {c: "0" for c in cols}
        cells.update(noteId=nid, noteAuthorParticipantId="ABCDEF", createdAtMillis="1700000000000",
                     tweetId=tid, classification=cls, summary=summary, believable="", harmful="")
        cells[reason] = "1"
        return "\t".join(cells[c] for c in cols)

    notes_tsv = "\n".join(["\t".join(cols),
                           row("101", "5001", "Old photo. https://example.org/a."),
                           row("102", "5001", "Not shown yet https://example.org/b"),
                           row("103", "7777", "Other tweet https://example.org/c"),
                           row("104", "5002", "Fine https://example.org/d", "NOT_MISLEADING", "notMisleadingFactuallyCorrect")]) + "\n"
    hist_cols = ["noteId", "noteAuthorParticipantId", "createdAtMillis", "timestampMillisOfFirstNonNMRStatus",
                 "firstNonNMRStatus", "timestampMillisOfCurrentStatus", "currentStatus"]
    hist_tsv = "\n".join(["\t".join(hist_cols),
                          "101\tA\t1\t2\tCURRENTLY_RATED_HELPFUL\t1700000500000\tCURRENTLY_RATED_HELPFUL",
                          "102\tA\t1\t\t\t3\tNEEDS_MORE_RATINGS",
                          "103\tA\t1\t2\tCURRENTLY_RATED_HELPFUL\t4\tCURRENTLY_RATED_HELPFUL",
                          "104\tA\t1\t2\tCURRENTLY_RATED_HELPFUL\t5\tCURRENTLY_RATED_HELPFUL"])
    files = {"notes": _zip(notes_tsv), "noteStatusHistory": _zip(hist_tsv)}

    def fetch(url):
        kind = "noteStatusHistory" if "noteStatusHistory" in url else "notes"
        data = files[kind]
        return (data[i:i + 7] for i in range(0, len(data), 7))

    store: dict[str, bytes] = {}
    posts = [{"platform": "x", "statusId": "5001"},
             {"platform": "instagram", "statusId": "7777"},
             {"platform": "threads", "statusId": "1", "quoted": {"platform": "x", "statusId": "5002"}}]
    now = datetime(2026, 10, 29, 12, tzinfo=timezone.utc)
    msg = mirror(posts, now=now, get=store.get, put=store.__setitem__, fetch=fetch)
    assert msg.startswith("2 shown"), msg
    found = []
    for s in range(SHARDS):
        found += json.loads(store[f"cnotes/x/{s:x}.json"])["notes"]
    by = {n["id"]: n for n in found}
    assert set(by) == {"101", "104"}, by
    assert by["101"]["ref"] == "x:5001" and by["101"]["sources"] == ["https://example.org/a"]
    assert by["101"]["reasons"] == ["missing_context"] and by["101"]["statusAt"] == 1700000500000
    assert by["104"]["cls"] == "not_misleading" and by["104"]["reasons"] == ["factually_correct"]
    assert "ABCDEF" not in json.dumps(found), "no participant ids are kept"
    assert mirror(posts, now=now, get=store.get, put=store.__setitem__, fetch=fetch) == "already mirrored today"
    print("x_notes_mirror selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        path = sys.argv[1] if len(sys.argv) > 1 else "feeds.json"
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        print(mirror(doc.get("posts") or []))
