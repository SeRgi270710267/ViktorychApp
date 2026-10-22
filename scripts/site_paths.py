"""GitHub Pages and repository URLs.

Actions sets GITHUB_REPOSITORY to owner/name. Nothing here stores an owner
or a repository name. Without that variable the helpers return an empty
string, and the browser derives the same pair from location.

The Internet Archive item id is not a repository path. It stays the item
that already holds the shards.
"""

from __future__ import annotations

import os


def repository() -> str:
    full = (os.environ.get("GITHUB_REPOSITORY") or "").strip()
    if full.count("/") != 1 or full.startswith("/") or full.endswith("/") or " " in full:
        return ""
    owner_name, repo_name = full.split("/", 1)
    if not owner_name or not repo_name:
        return ""
    return full


def owner() -> str:
    repo = repository()
    return repo.split("/", 1)[0] if repo else ""


def name() -> str:
    repo = repository()
    return repo.split("/", 1)[1] if repo else ""


def pages_base() -> str:
    if not repository():
        return ""
    return f"https://{owner().lower()}.github.io/{name()}/"


def github_web() -> str:
    repo = repository()
    return f"https://github.com/{repo}" if repo else ""


def raw_data() -> str:
    repo = repository()
    return f"https://raw.githubusercontent.com/{repo}/data/" if repo else ""


def cdn_data() -> str:
    repo = repository()
    return f"https://cdn.jsdelivr.net/gh/{repo}@data/" if repo else ""


def user_agent() -> str:
    web = github_web()
    return f"ViktorychApp-preview/1.0 (+{web})" if web else "ViktorychApp-preview/1.0"
