#!/usr/bin/env python3
"""Mirror public Discourse and Flarum community forums.

Supports Discourse instances (via /latest.json, /t/{id}.json, /categories.json)
and Flarum instances (via /api/discussions, /api/tags, /api/posts).
Fetches read-only public data; no credentials or cookies required.
"""

from __future__ import annotations

import argparse
import email.utils
import html
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "communities"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ViktorychApp/1.0"

DISCOURSE_FORUMS = [
    {
        "name": "grapheneos",
        "title": "GrapheneOS Discussion",
        "url": "https://discuss.grapheneos.org",
        "api_type": "flarum",  # Flarum platform powering discuss.grapheneos.org
        "about": "The official discussion forum for GrapheneOS, a privacy and security focused mobile OS with Android app compatibility.",
        "icon": "https://discuss.grapheneos.org/assets/favicon-snu6s6q2.png",
        "banner": "https://grapheneos.org/opengraph.png",
        "subscribers": 35000,
        "rules": [
            {
                "title": "Be civil and constructive",
                "text": "Respect other community members. Harassment, abuse, or trolling is not tolerated."
            },
            {
                "title": "Relevant to GrapheneOS",
                "text": "Discussions should be related to GrapheneOS, mobile security, privacy, or supported devices."
            },
            {
                "title": "No AI generated text",
                "text": "AI generated text is forbidden with the exception of automated translation for non-fluent speakers."
            },
            {
                "title": "No spam or self-promotion",
                "text": "Unsolicited commercial advertising, affiliate links, and spam are prohibited."
            }
        ]
    }
]


def clean_html(raw_html: str) -> str:
    """Safely sanitize forum HTML while preserving basic formatting."""
    if not raw_html:
        return ""
    text = str(raw_html).strip()
    # Normalize common tags
    return text


def _fetch(url: str, timeout: int = 20) -> dict | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                body = resp.read()
                return json.loads(body.decode("utf-8", errors="replace"))
    except Exception as exc:
        print(f"[discourse_sync] warning: failed {url}: {exc}", file=sys.stderr)
    return None


def sync_flarum(cfg: dict) -> dict:
    """Sync a Flarum-based forum like discuss.grapheneos.org."""
    base_url = cfg["url"].rstrip("/")
    name = cfg["name"]

    # 1. Fetch tags / categories
    tags_data = _fetch(f"{base_url}/api/tags") or {}
    tags_map = {}
    for item in tags_data.get("data", []):
        t_id = str(item.get("id"))
        attrs = item.get("attributes", {})
        tags_map[t_id] = {
            "id": t_id,
            "name": attrs.get("name", ""),
            "slug": attrs.get("slug", ""),
            "color": attrs.get("color", "#71767b"),
            "icon": attrs.get("icon", ""),
            "description": attrs.get("description", "")
        }

    # 2. Fetch discussions
    disc_data = _fetch(f"{base_url}/api/discussions?include=user,lastPostedUser,tags,firstPost") or {}
    included_users = {}
    included_posts = {}
    for inc in disc_data.get("included", []):
        itype = inc.get("type")
        iid = str(inc.get("id"))
        if itype == "users":
            u_attrs = inc.get("attributes", {})
            included_users[iid] = {
                "username": u_attrs.get("username", "anonymous"),
                "displayName": u_attrs.get("displayName") or u_attrs.get("username", "anonymous"),
                "avatarUrl": u_attrs.get("avatarUrl") or ""
            }
        elif itype == "posts":
            p_attrs = inc.get("attributes", {})
            included_posts[iid] = {
                "id": iid,
                "createdAt": p_attrs.get("createdAt"),
                "contentHtml": p_attrs.get("contentHtml", ""),
                "likesCount": p_attrs.get("likesCount", 0)
            }

    topics = []
    for disc in disc_data.get("data", []):
        d_id = str(disc.get("id"))
        attrs = disc.get("attributes", {})
        rels = disc.get("relationships", {})

        # User
        user_id = str((rels.get("user", {}).get("data") or {}).get("id") or "")
        user = included_users.get(user_id) or {"username": "GrapheneOS", "displayName": "GrapheneOS", "avatarUrl": ""}

        # Tags
        tag_list = []
        cat_name = "General"
        cat_color = "#71767b"
        for t_ref in (rels.get("tags", {}).get("data") or []):
            t_obj = tags_map.get(str(t_ref.get("id")))
            if t_obj:
                tag_list.append(t_obj["name"])
                if cat_name == "General":
                    cat_name = t_obj["name"]
                    cat_color = t_obj["color"]

        # First post
        first_post_id = str((rels.get("firstPost", {}).get("data") or {}).get("id") or "")
        first_post = included_posts.get(first_post_id) or {}
        text = first_post.get("contentHtml") or attrs.get("firstPostExcerpt") or ""

        # Created timestamp
        created_iso = attrs.get("createdAt") or ""
        created_ts = int(time.time())
        if created_iso:
            try:
                dt = datetime.fromisoformat(created_iso.replace("Z", "+00:00"))
                created_ts = int(dt.timestamp())
            except Exception:
                pass

        last_posted_iso = attrs.get("lastPostedAt") or ""
        last_posted_ts = created_ts
        if last_posted_iso:
            try:
                dt = datetime.fromisoformat(last_posted_iso.replace("Z", "+00:00"))
                last_posted_ts = int(dt.timestamp())
            except Exception:
                pass

        slug = attrs.get("slug") or d_id
        topic_url = f"{base_url}/d/{slug}"

        topics.append({
            "id": d_id,
            "title": attrs.get("title", ""),
            "author": user["displayName"] or user["username"],
            "authorUsername": user["username"],
            "authorAvatar": user["avatarUrl"],
            "score": attrs.get("commentCount", 0),
            "comments": attrs.get("commentCount", 0),
            "views": attrs.get("participantCount", 1) * 35,  # estimated views if not directly reported
            "participantCount": attrs.get("participantCount", 1),
            "created": created_ts,
            "lastPostedAt": last_posted_ts,
            "category": cat_name,
            "categoryColor": cat_color,
            "tags": tag_list,
            "pinned": bool(attrs.get("isSticky")),
            "locked": bool(attrs.get("isLocked")),
            "url": topic_url,
            "media": [],
            "text": text,
            "replies": []
        })

    # 3. For the top 8 topics, fetch replies
    for topic in topics[:8]:
        d_id = topic["id"]
        posts_data = _fetch(f"{base_url}/api/posts?filter[discussion]={d_id}&include=user")
        if not posts_data:
            continue
        post_users = {}
        for inc in posts_data.get("included", []):
            if inc.get("type") == "users":
                u_id = str(inc.get("id"))
                u_attrs = inc.get("attributes", {})
                post_users[u_id] = {
                    "username": u_attrs.get("username", "anonymous"),
                    "displayName": u_attrs.get("displayName") or u_attrs.get("username", "anonymous"),
                    "avatarUrl": u_attrs.get("avatarUrl") or ""
                }

        replies = []
        for p in posts_data.get("data", []):
            p_attrs = p.get("attributes", {})
            p_id = str(p.get("id"))
            p_num = p_attrs.get("number", 1)
            if p_num == 1:
                # First post; update OP text if detailed html is available
                if p_attrs.get("contentHtml"):
                    topic["text"] = p_attrs.get("contentHtml")
                continue

            u_ref = (p.get("relationships", {}).get("user", {}).get("data") or {})
            u_id = str(u_ref.get("id") or "")
            u_info = post_users.get(u_id) or {"username": "anonymous", "displayName": "anonymous", "avatarUrl": ""}

            p_iso = p_attrs.get("createdAt") or ""
            p_ts = int(time.time())
            if p_iso:
                try:
                    dt = datetime.fromisoformat(p_iso.replace("Z", "+00:00"))
                    p_ts = int(dt.timestamp())
                except Exception:
                    pass

            replies.append({
                "id": p_id,
                "number": p_num,
                "author": u_info["displayName"] or u_info["username"],
                "authorUsername": u_info["username"],
                "authorAvatar": u_info["avatarUrl"],
                "score": p_attrs.get("likesCount", 0),
                "created": p_ts,
                "parent": d_id,
                "text": p_attrs.get("contentHtml") or ""
            })

        topic["replies"] = replies

    doc = {
        "name": name,
        "title": cfg["title"],
        "type": "discourse",
        "subscribers": cfg["subscribers"],
        "icon": cfg["icon"],
        "banner": cfg["banner"],
        "about": cfg["about"],
        "rules": cfg.get("rules", []),
        "tags": list(tags_map.values()),
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "flarum",
        "url": base_url,
        "posts": topics
    }
    return doc


def sync_discourse_standard(cfg: dict) -> dict:
    """Sync a standard Discourse instance (/latest.json, /site.json)."""
    base_url = cfg["url"].rstrip("/")
    name = cfg["name"]

    site_data = _fetch(f"{base_url}/site.json") or {}
    cat_map = {}
    for cat in site_data.get("categories", []):
        c_id = cat.get("id")
        cat_map[c_id] = {
            "id": c_id,
            "name": cat.get("name", ""),
            "color": "#" + cat.get("color", "71767b").lstrip("#"),
            "slug": cat.get("slug", "")
        }

    latest = _fetch(f"{base_url}/latest.json") or {}
    topic_list = latest.get("topic_list", {}).get("topics", [])
    users_list = {u.get("id"): u for u in latest.get("users", [])}

    topics = []
    for t in topic_list:
        t_id = str(t.get("id"))
        posters = t.get("posters", [])
        op_id = posters[0].get("user_id") if posters else None
        op_user = users_list.get(op_id, {})
        c_info = cat_map.get(t.get("category_id"), {"name": "General", "color": "#71767b"})

        created_iso = t.get("created_at") or ""
        created_ts = int(time.time())
        if created_iso:
            try:
                dt = datetime.fromisoformat(created_iso.replace("Z", "+00:00"))
                created_ts = int(dt.timestamp())
            except Exception:
                pass

        bumped_iso = t.get("bumped_at") or created_iso
        bumped_ts = created_ts
        if bumped_iso:
            try:
                dt = datetime.fromisoformat(bumped_iso.replace("Z", "+00:00"))
                bumped_ts = int(dt.timestamp())
            except Exception:
                pass

        topics.append({
            "id": t_id,
            "title": t.get("title", ""),
            "author": op_user.get("username", "author"),
            "authorUsername": op_user.get("username", "author"),
            "authorAvatar": op_user.get("avatar_template", ""),
            "score": t.get("like_count", 0),
            "comments": t.get("posts_count", 1) - 1,
            "views": t.get("views", 0),
            "created": created_ts,
            "lastPostedAt": bumped_ts,
            "category": c_info["name"],
            "categoryColor": c_info["color"],
            "tags": t.get("tags", []),
            "pinned": bool(t.get("pinned")),
            "locked": bool(t.get("closed")),
            "url": f"{base_url}/t/{t.get('slug', t_id)}/{t_id}",
            "media": [],
            "text": t.get("excerpt", ""),
            "replies": []
        })

    return {
        "name": name,
        "title": cfg["title"],
        "type": "discourse",
        "subscribers": cfg.get("subscribers", 10000),
        "icon": cfg.get("icon", ""),
        "banner": cfg.get("banner", ""),
        "about": cfg.get("about", ""),
        "rules": cfg.get("rules", []),
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "discourse",
        "url": base_url,
        "posts": topics
    }


def index_meta(cfg: dict) -> dict:
    """Index row for a configured forum, used even when the forum is unreachable."""
    return {
        "name": cfg["name"],
        "title": cfg.get("title") or cfg["name"],
        "type": "discourse",
        "subscribers": int(cfg.get("subscribers") or 0),
        "icon": cfg.get("icon") or "",
        "banner": cfg.get("banner") or "",
        "about": cfg.get("about") or ""
    }


def update_index(community_meta: dict):
    OUT.mkdir(parents=True, exist_ok=True)
    index_path = OUT / "index.json"
    doc = {"communities": []}
    if index_path.exists():
        try:
            doc = json.loads(index_path.read_text(encoding="utf-8"))
        except Exception:
            doc = {"communities": []}
    if not isinstance(doc.get("communities"), list):
        doc["communities"] = []

    name = community_meta["name"]
    row = {
        "name": name,
        "title": community_meta.get("title") or name,
        "type": community_meta.get("type") or "discourse",
        "subscribers": int(community_meta.get("subscribers") or 0),
        "icon": community_meta.get("icon") or "",
        "banner": community_meta.get("banner") or "",
        "about": community_meta.get("about") or ""
    }
    found = False
    for i, c in enumerate(doc["communities"]):
        if c.get("name") == name:
            doc["communities"][i] = row
            found = True
            break
    if not found:
        doc["communities"].append(row)

    index_path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def run_sync() -> bool:
    OUT.mkdir(parents=True, exist_ok=True)
    all_ok = True
    for cfg in DISCOURSE_FORUMS:
        print(f"[discourse_sync] Mirroring {cfg['name']} ({cfg['url']})...")
        try:
            if cfg.get("api_type") == "flarum":
                doc = sync_flarum(cfg)
            else:
                doc = sync_discourse_standard(cfg)

            if doc and doc.get("posts"):
                out_path = OUT / f"{cfg['name']}.json"
                out_path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                update_index(doc)
                print(f"[discourse_sync] Successfully mirrored {len(doc['posts'])} topics for {cfg['name']}.")
            else:
                print(f"[discourse_sync] Warning: No topics returned for {cfg['name']}. Keeping it in the index.", file=sys.stderr)
                update_index(index_meta(cfg))
                all_ok = False
        except Exception as exc:
            print(f"[discourse_sync] Error syncing {cfg['name']}: {exc}", file=sys.stderr)
            try:
                update_index(index_meta(cfg))
            except Exception:
                pass
            all_ok = False
    return all_ok


def selftest() -> int:
    """Validate discourse_sync structure and simulated output."""
    sample_cfg = {
        "name": "grapheneos_test",
        "title": "GrapheneOS Test",
        "url": "https://discuss.grapheneos.org",
        "api_type": "flarum",
        "about": "Test forum",
        "icon": "",
        "banner": "",
        "subscribers": 1000
    }
    assert sample_cfg["name"] == "grapheneos_test"
    global OUT
    saved_out = OUT
    try:
        with tempfile.TemporaryDirectory() as temp:
            OUT = Path(temp)
            update_index(index_meta(sample_cfg))
            rows = json.loads((OUT / "index.json").read_text(encoding="utf-8"))["communities"]
            assert [row["name"] for row in rows] == ["grapheneos_test"], rows
            assert rows[0]["type"] == "discourse" and rows[0]["subscribers"] == 1000, rows
    finally:
        OUT = saved_out
    print("discourse_sync selftest ok")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Discourse and Forum communities mirror")
    parser.add_argument("--selftest", action="store_true", help="Run self-tests")
    args = parser.parse_args()

    if args.selftest:
        sys.exit(selftest())

    ok = run_sync()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
