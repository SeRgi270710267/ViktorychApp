# rss-feeds

An X-style home for posts from X, Threads, Instagram, and other RSS sources. The page is a static site (`index.html`, `styles.css`, `app.js`) with no build step, so it can be served from GitHub Pages. A separate refresh job writes `feeds.json`. The browser only reads that file.

The preview snapshot in this repo is real public posts converted by the adapters (about six to eight newest items per configured account), with a few images copied into `media/` so the page still renders after CDN links expire.

## Run it

```bash
python3 -m http.server 8080
```

Open `http://127.0.0.1:8080/`. Hash routes keep the back button working on GitHub Pages.

| Route | Page |
| --- | --- |
| `#/` | Home, For you |
| `#/following` | Home, Following |
| `#/tab/<listId>` | Home tab for a pinned List |
| `#/@handle` | X profile |
| `#/@handle/status/<id>` | Post |
| `#/threads/<handle>` | Threads profile |
| `#/instagram/<handle>` | Instagram profile |
| `#/rss/<handle>` | Other RSS profile |
| `#/explore?q=` | Search posts and accounts |
| `#/lists` | Your Lists |
| `#/lists/<id>` | List timeline |
| `#/bookmarks` | Bookmarked posts |
| `#/feeds` | Every account in the snapshot |
| `#/settings` | Export / import |
| `#/notifications`, `#/messages` | Empty X-style states |

`?empty=1` shows the empty timeline. `?error=1` shows the load-failure state.

## What the page does

Everything below is stored in `localStorage` under `rss-feeds-settings-v1` for a single reader on this browser.

- **For you** shows every post, newest first (`sortDate`, otherwise `date`). **Following** shows posts from accounts you follow. **Pinned Lists** appear as extra tabs and scroll sideways on a narrow screen. The selected tab has the blue underline.
- **Follow** is a light pill. **Following** is an outline pill that turns into a red **Unfollow** on hover. On the first visit every configured account is followed. Accounts discovered inside posts are not. They show up in **Who to follow**.
- **Lists** can be created, edited, deleted, pinned, and filled from the accounts in `feeds.json`. A pinned list is a Home tab. Its page shows that list’s banner, name, description, member count, and the members’ posts.
- **Explore** matches post text and account names.
- The bookmark icon saves a post (filled blue). The heart likes it locally (filled pink, count +1). Reposts toggle the same way (green, count +1). None of these leave the browser.
- **Settings** exports and imports that JSON (follows, lists, likes, bookmarks, reposts).

The composer is visual only. This reader does not publish.

## `feeds.json`

```json
{
  "updated": "2026-10-20T19:33:30Z",
  "preview": true,
  "feeds": [],
  "posts": []
}
```

### Account (`feeds[]`)

| Field | Meaning |
| --- | --- |
| `id` | `platform:handle`, for example `x:redacted_handle` |
| `platform` | `x`, `threads`, `instagram`, or `rss` |
| `handle`, `name` | Public identity |
| `avatar`, `banner` | Image URLs, or paths under `media/` |
| `bio`, `location`, `website`, `url`, `joined` | Profile text. `url` is the profile link |
| `followers`, `following`, `postsCount` | Numbers when the source has them. Omitted otherwise |
| `verifiedType` | `blue`, `business` (gold), `government` (gray), or omitted |
| `configured` | `true` for accounts listed in `feeds.config.json` |

### Post (`posts[]`)

One shape for every platform. The card layout does not change with the source. A small badge and the “View on …” link are the only platform-specific bits.

| Field | Meaning |
| --- | --- |
| `id` | Timeline item id. For a repost this is the repost wrapper |
| `statusId` | The original post id, used in the status URL |
| `feedId` | Account whose timeline this item came from |
| `platform` | `x`, `threads`, `instagram`, or `rss` |
| `kind` | `post`, `repost`, `quote`, or `reply` |
| `author`, `handle`, `avatar`, `verifiedType` | The account shown on the card. For a repost this is the original author |
| `repostedBy` | `{name, handle, avatar}` when `kind` is `repost` |
| `quoted` | Embedded post: author, handle, text, date, media, verifiedType |
| `replyingTo` | `{handle}` when this is a reply and the target is known |
| `text` | Plain text, line breaks kept. Long X notes are the full note text |
| `date` | Display time of the original post |
| `sortDate` | Timeline order. Set when a repost should sort by the repost time |
| `url` | Original post URL |
| `links` | `[{expanded, display, anchorText}]` for real URLs. Media and quote `t.co` links are already removed |
| `media` | `[{type, url, poster, width, height, alt}]`. `type` is `photo`, `video`, or `animated_gif` |
| `images` | Photo URLs, a convenience copy of `media` |
| `stats` | `{replies, reposts, quotes, likes, views, bookmarks}`. A missing stat is omitted, not zero. The icon still shows; the number is hidden when the stat is missing or zero |

Counts under 10,000 use commas. Larger counts use `1.2K`, `24K`, `6.1M`. Times under a day are `5s`, `12m`, `3h`. Same-year dates are `Oct 18`. Older dates include the year. The status page uses `5:56 PM · Oct 20, 2026`.

## Refreshing posts

`feeds.config.json` lists each account: platform, handle, adapter, and `source_url` with fallbacks. These placeholders are filled from the top of the config:

- `{rsshubBase}` — default `http://localhost:1200`
- `{fxtwitterBase}` — default `https://api.fxtwitter.com`
- `{base}` — the feed’s own base, when set
- `{handle}`

```bash
python3 scripts/update_feeds.py              # live sources
python3 scripts/update_feeds.py --fixtures   # rebuild the preview from scripts/fixtures
python3 scripts/update_feeds.py --download-media
python3 scripts/selftest.py
python3 scripts/x_to_feed.py response.json --feeds feeds.json --feed x:redacted_handle --handle redacted_handle
```

`update_feeds.py` dedupes on platform + id, sorts newest first, and keeps about 300 posts. If a source fails, that feed’s previous posts stay. Adapters live in `scripts/adapters/`:

| Adapter | Source |
| --- | --- |
| `x_api_v2` | X API v2 payload (`data`, `includes.tweets`, `includes.users`, `includes.media`). A tool header line and a trailing note are ignored |
| `fxtwitter` | `api.fxtwitter.com` profile statuses |
| `nitter_rss` | Nitter RSS (`RT by @…`, blockquote quotes) |
| `rsshub_threads` | RSSHub `/threads/<user>` |
| `rsshub_instagram` | RSSHub `/instagram/user/<user>` |
| `generic_rss` | RSS or Atom: title, description, `content:encoded`, enclosures |

Each adapter strips HTML while keeping line breaks, unescapes entities, drops trailing media links, and fills the same post and profile fields. The configured profile in `feeds.config.json` wins over a thinner profile parsed from a post.

`--download-media` saves expiring images (Meta CDN, `twimg`, and similar) into `media/`. Video files are left remote; the poster is what the card shows until play.

## GitHub Pages

Serve the repository root. `.nojekyll` is present so Pages does not run Jekyll. Paths are relative (`feeds.json`, `styles.css`, `media/…`), so the site works at `/` or under `/rss-feeds/`.
