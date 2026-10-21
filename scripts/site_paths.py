"""GitHub Pages and repository URLs.

Actions sets GITHUB_REPOSITORY to owner/name, so a later rename follows the
repo without editing these strings. Locally the fallback is this repo.

The Internet Archive item id is not a repository path. It stays the item
that already holds the shards.
"""

from __future__ import annotations

import os

FALLBACK_REPOSITORY = "owner-account/SuperintelApp"


def repository() -> str:
    full = os.environ.get("GITHUB_REPOSITORY") or FALLBACK_REPOSITORY
    if full.count("/") != 1 or full.startswith("/") or full.endswith("/"):
        return FALLBACK_REPOSITORY
    return full


def owner() -> str:
    return repository().split("/", 1)[0]


def name() -> str:
    return repository().split("/", 1)[1]


def pages_base() -> str:
    return f"https://{owner().lower()}.github.io/{name()}/"


def github_web() -> str:
    return f"https://github.com/{repository()}"


def raw_data() -> str:
    return f"https://raw.githubusercontent.com/{repository()}/data/"


def cdn_data() -> str:
    return f"https://cdn.jsdelivr.net/gh/{repository()}@data/"


def user_agent() -> str:
    return f"SuperintelApp-preview/1.0 (+{github_web()})"
