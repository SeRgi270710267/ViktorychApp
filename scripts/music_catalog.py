#!/usr/bin/env python3
"""Turn a repo-owner Music catalog issue into data/music.json.

Anyone else is ignored. The workflow only starts this for the owner, and
this script checks the actor again before it writes. Uploaded files never
belong in the catalog: only https audio and YouTube links.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "data" / "music.json"
ID = __import__("re").compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
AUDIO = (".mp3", ".m4a", ".ogg", ".opus", ".aac", ".wav")
YT_HOSTS = {
    "youtu.be",
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
}


class Reject(Exception):
    pass


def allowed(actor: str, owner: str) -> bool:
    return bool(actor) and actor == owner


def _fields(body: str) -> dict:
    fields = {}
    current = ""
    buf = []
    for line in (body or "").splitlines():
        if line.startswith("### "):
            if current:
                fields[current] = "\n".join(buf).strip()
            current = line[4:].strip().lower()
            buf = []
        elif current:
            buf.append(line)
    if current:
        fields[current] = "\n".join(buf).strip()
    return fields


def _local(host: str) -> bool:
    host = (host or "").lower().rstrip(".")
    return host in {"localhost", "127.0.0.1", "0.0.0.0", "::1"} or host.endswith(".localhost")


def _https(value: str, label: str) -> str:
    raw = (value or "").strip()
    if not raw.startswith("https://"):
        raise Reject(label + " must be an https URL")
    if len(raw) > 2000:
        raise Reject(label + " is too long")
    try:
        parsed = urlparse(raw)
    except ValueError as exc:
        raise Reject(label + " is not a URL") from exc
    if parsed.username or parsed.password:
        raise Reject(label + " must not include credentials")
    if _local(parsed.hostname or ""):
        raise Reject(label + " must not point at a local machine")
    return raw


def _youtube(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if host not in YT_HOSTS:
        return False
    if host == "youtu.be":
        ident = [part for part in parsed.path.split("/") if part]
        token = ident[0] if ident else ""
    elif parsed.path.startswith(("/embed/", "/shorts/", "/live/")):
        parts = [part for part in parsed.path.split("/") if part]
        token = parts[1] if len(parts) > 1 else ""
    else:
        token = ""
        query = parsed.query
        for bit in query.split("&"):
            if bit.startswith("v="):
                token = bit[2:]
    return 6 <= len(token) <= 20 and all(ch.isalnum() or ch in "_-" for ch in token)


def _audio(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    path = parsed.path.lower()
    if path.endswith(AUDIO):
        return True
    return (host == "archive.org" or host.endswith(".archive.org")) and "/download/" in path


def _song(raw, seen: set) -> dict:
    if not isinstance(raw, dict):
        raise Reject("each song must be an object")
    ident = str(raw.get("id") or "")
    if not ID.match(ident):
        raise Reject("song id must be letters, numbers, _ or -")
    if ident in seen:
        raise Reject("duplicate song id " + ident)
    seen.add(ident)
    title = str(raw.get("title") or "").strip()
    if not title or len(title) > 200:
        raise Reject("each song needs a title")
    artist = str(raw.get("artist") or "").strip()
    album = str(raw.get("album") or "").strip()
    if len(artist) > 200 or len(album) > 200:
        raise Reject("artist and album stay under 200 characters")
    source = _https(str(raw.get("source") or ""), "audio")
    kind = str(raw.get("kind") or "")
    if kind == "youtube":
        if not _youtube(source):
            raise Reject("a YouTube song needs a YouTube link")
    elif kind == "audio":
        if not _audio(source):
            raise Reject("audio needs an mp3, m4a, ogg, opus, aac, wav, or Archive download link")
    else:
        raise Reject("kind must be audio or youtube")
    cover = str(raw.get("cover") or "").strip()
    if cover:
        cover = _https(cover, "cover")
    duration = raw.get("duration") or 0
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or duration < 0 or duration > 86400:
        raise Reject("duration is seconds")
    license_name = str(raw.get("license") or "").strip()
    if len(license_name) > 120:
        raise Reject("license is too long")
    song = {
        "id": ident,
        "title": title,
        "artist": artist,
        "album": album,
        "cover": cover,
        "source": source,
        "kind": kind,
        "duration": int(duration),
    }
    if license_name:
        song["license"] = license_name
    return song


def clean_catalog(data) -> dict:
    if isinstance(data, str):
        text = data.strip()
        if text.startswith("```"):
            lines = [line for line in text.splitlines() if not line.startswith("```")]
            text = "\n".join(lines).strip()
        if len(text) > 180000:
            raise Reject("catalog is too large")
        try:
            data = json.loads(text or "{}")
        except json.JSONDecodeError as exc:
            raise Reject("catalog is not JSON") from exc
    if not isinstance(data, dict):
        raise Reject("catalog must be an object")
    songs_raw = data.get("songs") or []
    lists_raw = data.get("playlists") or []
    if not isinstance(songs_raw, list) or not isinstance(lists_raw, list):
        raise Reject("songs and playlists must be lists")
    if len(songs_raw) > 400 or len(lists_raw) > 100:
        raise Reject("too many songs or playlists")
    seen = set()
    songs = [_song(item, seen) for item in songs_raw]
    playlists = []
    used = set()
    for item in lists_raw:
        if not isinstance(item, dict):
            raise Reject("each playlist must be an object")
        ident = str(item.get("id") or "")
        name = str(item.get("name") or "").strip()
        if not ID.match(ident) or ident in used:
            raise Reject("playlist id must be unique")
        used.add(ident)
        if not name or len(name) > 80:
            raise Reject("each playlist needs a name")
        ids = item.get("songIds") or []
        if not isinstance(ids, list) or len(ids) > 500:
            raise Reject("playlist songs are a short list of ids")
        cleaned = []
        for song_id in ids:
            token = str(song_id or "")
            if token not in seen:
                raise Reject("playlist " + name + " names a missing song")
            if token not in cleaned:
                cleaned.append(token)
        playlists.append({"id": ident, "name": name, "songIds": cleaned})
    updated = str(data.get("updated") or "").strip()
    if updated and (len(updated) > 40 or "T" not in updated):
        raise Reject("updated must be a timestamp")
    return {"updated": updated, "songs": songs, "playlists": playlists}


def catalog_from_issue(title: str, body: str) -> dict:
    if not (title or "").strip().lower().startswith("music catalog"):
        raise Reject("title must start with Music catalog")
    raw = _fields(body).get("catalog") or (body or "").strip()
    catalog = clean_catalog(raw)
    if not catalog["updated"]:
        catalog["updated"] = "1970-01-01T00:00:00Z"
    return catalog


def _comment_and_close(number: str, message: str, repo: str) -> None:
    env = dict(os.environ)
    subprocess.run(["gh", "issue", "comment", number, "--repo", repo, "--body", message], check=True, env=env)
    subprocess.run(["gh", "issue", "close", number, "--repo", repo, "--reason", "completed"], check=True, env=env)


def _selftest() -> None:
    empty = catalog_from_issue("Music catalog", "### Catalog\n\n{\"songs\": [], \"playlists\": []}\n")
    assert empty["songs"] == []
    good = {
        "updated": "2026-10-21T19:40:00Z",
        "songs": [{
            "id": "tone",
            "title": "Tone",
            "artist": "SIntelMusic",
            "album": "",
            "cover": "",
            "source": "https://archive.org/download/example/tone.mp3",
            "kind": "audio",
            "duration": 3,
        }],
        "playlists": [{"id": "p1", "name": "Demo", "songIds": ["tone"]}],
    }
    parsed = clean_catalog(good)
    assert parsed["songs"][0]["source"].endswith("tone.mp3")
    youtube = dict(good)
    youtube["songs"] = [dict(good["songs"][0], source="https://www.youtube.com/watch?v=dQw4w9WgXcQ", kind="youtube")]
    youtube["playlists"] = []
    assert clean_catalog(youtube)["songs"][0]["kind"] == "youtube"
    for bad in (
        {"songs": [dict(good["songs"][0], source="http://archive.org/download/example/tone.mp3")]},
        {"songs": [dict(good["songs"][0], source="https://user:pass@archive.org/download/example/tone.mp3")]},
        {"songs": [dict(good["songs"][0], source="https://localhost/tone.mp3")]},
        {"songs": [dict(good["songs"][0], source="idb:tone:audio", kind="audio")]},
        {"songs": [dict(good["songs"][0], kind="youtube", source="https://example.com/a.mp3")]},
    ):
        try:
            clean_catalog(bad)
        except Reject:
            continue
        raise SystemExit("accepted unsafe catalog " + json.dumps(bad))
    print("music catalog selftest ok")


def main() -> int:
    if "--selftest" in sys.argv:
        _selftest()
        return 0
    actor = os.environ.get("ACTOR") or ""
    owner = os.environ.get("OWNER") or ""
    if not allowed(actor, owner):
        print("ignoring issue from", actor or "unknown")
        return 0
    title = os.environ.get("ISSUE_TITLE") or ""
    body = os.environ.get("ISSUE_BODY") or ""
    number = os.environ.get("ISSUE_NUMBER") or ""
    repo = os.environ.get("REPO") or ""
    try:
        catalog = catalog_from_issue(title, body)
    except Reject as exc:
        if number and repo:
            _comment_and_close(number, "Not applied: " + str(exc), repo)
        print("rejected:", exc, file=sys.stderr)
        return 0
    if not catalog["updated"] or catalog["updated"] == "1970-01-01T00:00:00Z":
        from datetime import datetime, timezone
        catalog["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    subprocess.run(["git", "config", "user.name", "github-actions[bot]"], check=True)
    subprocess.run(["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], check=True)
    subprocess.run(["git", "add", "data/music.json"], check=True)
    commit = subprocess.run(["git", "diff", "--cached", "--quiet"])
    message = "Updated the SIntelMusic catalog (" + str(len(catalog["songs"])) + " songs)."
    if commit.returncode == 0:
        message += " No file change."
    else:
        subprocess.run(["git", "commit", "-m", "Update the SIntelMusic catalog"], check=True)
        subprocess.run(["git", "push", "origin", "HEAD:main"], check=True)
        subprocess.run(["gh", "workflow", "run", "sync.yml", "--repo", repo], check=False, env=os.environ)
        message += " A sync is queued."
    if number and repo:
        _comment_and_close(number, message, repo)
    print(message)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Reject as exc:
        print("rejected:", exc, file=sys.stderr)
        sys.exit(1)
