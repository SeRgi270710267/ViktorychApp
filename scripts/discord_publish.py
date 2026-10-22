#!/usr/bin/env python3
"""Assemble the site and deploy it through the Pages artifact flow.

The last published Pages artifact is the base, so a discord refresh does not
drop feeds, comments, or the archive. The checkout's shell (including
discord-ui) and the local discord/ JSON are copied on top. Outside Actions
this only builds _site.
"""

from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE_FILES = (
    "index.html",
    "app.js",
    "styles.css",
    "split.js",
    "discord-ui.js",
    "discord-ui.css",
    "translate.js",
    "translate.css",
    "people.js",
    "people.css",
    "tv.js",
    "tv.css",
    "spaces.js",
    "spaces.css",
    "music.js",
    "music.css",
    "i18n.js",
    "stories.js",
    "stories.css",
    "404.html",
    "favicon.svg",
    "favicon.ico",
    "manifest.webmanifest",
    "sw.js",
    ".nojekyll",
    "feeds.config.json",
)
COPY_DIRS = ("icons", "splash", "screenshots", "i18n")
UA = "superintel-preview/1.0"


def _token_clean(root: Path, token: str) -> None:
    if not token:
        return
    folder = root / "discord"
    if not folder.is_dir():
        return
    for path in folder.rglob("*.json"):
        text = path.read_text(encoding="utf-8")
        if token in text:
            raise RuntimeError("refusing to deploy a file that contains the Discord token")


def _github(path: str, token: str, accept: str = "application/vnd.github+json") -> bytes:
    request = urllib.request.Request(
        "https://api.github.com" + path,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": accept,
            "User-Agent": UA,
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        return response.read()


def _latest_artifact(repo: str, token: str) -> dict | None:
    raw = _github(f"/repos/{repo}/actions/artifacts?name=github-pages&per_page=20", token)
    data = json.loads(raw.decode("utf-8"))
    artifacts = [item for item in (data.get("artifacts") or []) if isinstance(item, dict) and not item.get("expired")]
    artifacts.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return artifacts[0] if artifacts else None


def _safe_tar(tar: tarfile.TarFile, dest: Path) -> None:
    root = dest.resolve()
    for member in tar.getmembers():
        if member.issym() or member.islnk():
            continue
        name = member.name
        if name.startswith("/") or ".." in Path(name).parts:
            continue
        target = (dest / name).resolve()
        if root != target and root not in target.parents:
            continue
        kwargs = {"filter": "data"} if sys.version_info >= (3, 12) else {}
        tar.extract(member, dest, **kwargs)


def _extract_artifact(payload: bytes, dest: Path) -> bool:
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    try:
        bundle = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile:
        return False
    tar_name = ""
    for name in bundle.namelist():
        if name.endswith(".tar"):
            tar_name = name
            break
    if not tar_name:
        return False
    with bundle.open(tar_name) as raw:
        blob = raw.read()
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:") as tar:
        _safe_tar(tar, dest)
    return (dest / "index.html").is_file()


def _copy_tree(src: Path, dest: Path) -> None:
    if not src.is_dir():
        return
    for path in src.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        target = dest / path.relative_to(src)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)


def _overlay(root: Path, dest: Path) -> None:
    for name in SITE_FILES:
        src = root / name
        if src.is_file():
            shutil.copy2(src, dest / name)
    for name in COPY_DIRS:
        _copy_tree(root / name, dest / name)
    music = root / "data" / "music.json"
    if music.is_file():
        (dest / "data").mkdir(parents=True, exist_ok=True)
        shutil.copy2(music, dest / "data" / "music.json")
    discord = root / "discord"
    if discord.is_dir():
        for path in discord.rglob("*.json"):
            target = dest / path.relative_to(root)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
    worker = dest / "sw.js"
    if worker.is_file():
        sha = (os.environ.get("GITHUB_SHA") or "discord-live").strip() or "discord-live"
        worker.write_text(worker.read_text(encoding="utf-8").replace("__SW_VERSION__", sha), encoding="utf-8")


def _from_checkout(root: Path, dest: Path) -> None:
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    names = list(SITE_FILES) + ["feeds.json", "people.json", "suggestions.json"]
    for name in names:
        src = root / name
        if src.is_file():
            shutil.copy2(src, dest / name)
    for name in COPY_DIRS:
        _copy_tree(root / name, dest / name)
    for folder in ("fallback", "comments", "archive", "discord"):
        _copy_tree(root / folder, dest / folder)
    status = root / "status.json"
    if status.is_file():
        shutil.copy2(status, dest / "status.json")
    music = root / "data" / "music.json"
    if music.is_file():
        (dest / "data").mkdir(parents=True, exist_ok=True)
        shutil.copy2(music, dest / "data" / "music.json")
    subprocess.run([sys.executable, str(root / "scripts" / "share_pages.py"), "--site", str(dest)], check=False)
    worker = dest / "sw.js"
    if worker.is_file():
        sha = (os.environ.get("GITHUB_SHA") or "discord-live").strip() or "discord-live"
        worker.write_text(worker.read_text(encoding="utf-8").replace("__SW_VERSION__", sha), encoding="utf-8")


def _refresh_checkout(root: Path) -> None:
    if not os.environ.get("GITHUB_ACTIONS"):
        return
    subprocess.run(["git", "fetch", "origin", "main"], cwd=root, check=False)
    subprocess.run(["git", "merge", "--ff-only", "origin/main"], cwd=root, check=False)


def assemble(root: Path, token: str) -> Path:
    _token_clean(root, token)
    _refresh_checkout(root)
    dest = root / "_site"
    repo = os.environ.get("GITHUB_REPOSITORY") or ""
    gh = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
    used_artifact = False
    if repo and gh:
        try:
            artifact = _latest_artifact(repo, gh)
            if artifact and artifact.get("id"):
                payload = _github(f"/repos/{repo}/actions/artifacts/{artifact['id']}/zip", gh, "application/vnd.github+json")
                used_artifact = _extract_artifact(payload, dest)
                if used_artifact:
                    print(f"[discord-live] base artifact {artifact.get('id')}")
        except Exception as exc:
            print(f"[discord-live] artifact base skipped: {type(exc).__name__}")
    if not used_artifact:
        if os.environ.get("GITHUB_ACTIONS"):
            subprocess.run([sys.executable, str(root / "scripts" / "pull_snapshot.py")], cwd=root, check=False)
        _from_checkout(root, dest)
    else:
        _overlay(root, dest)
    _token_clean(dest, token)
    return dest


def make_tar(site: Path, dest: Path) -> None:
    if dest.exists():
        dest.unlink()
    with tarfile.open(dest, "w") as tar:
        for path in sorted(site.rglob("*")):
            if not path.is_file() or path.is_symlink():
                continue
            tar.add(path, arcname=str(path.relative_to(site)), recursive=False)


def publish_site(root: Path, token: str = "") -> None:
    site = assemble(root, token)
    if not os.environ.get("GITHUB_ACTIONS"):
        print("[discord-live] assembled _site; deploy runs in Actions")
        return
    handle = tempfile.NamedTemporaryFile(prefix="artifact-", suffix=".tar", delete=False)
    handle.close()
    tar_path = Path(handle.name)
    try:
        make_tar(site, tar_path)
        script = root / "scripts" / "pages_deploy.js"
        result = subprocess.run(["node", str(script), str(tar_path)], cwd=root, check=False)
        if result.returncode != 0:
            print("[discord-live] pages deploy returned " + str(result.returncode))
    finally:
        tar_path.unlink(missing_ok=True)
