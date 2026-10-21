# rss-feeds

An X-style home for posts from X, Threads, Instagram, YouTube, VK, and other RSS sources. The page is a static site (`index.html`, `styles.css`, `app.js`). GitHub Actions builds the timeline and publishes it. The repository keeps the code, the config, and a small `feeds.json` seed. X replies and YouTube comments load in the browser when a post opens.

The preview snapshot in this repo is real public posts converted by the adapters (about six to eight newest items per configured account). X images stay on `pbs.twimg.com`. Instagram and Threads images stay on the Meta CDN, with each URL's expiry stored next to it.

VK's official community (`vk.com/vk`) is a followed account. Sync calls `wall.get` for that public wall. A `VK_SERVICE_TOKEN` repository secret is used when it is set. Otherwise the sync reads the anonymous client id and secret from the JavaScript vk.com already ships to browsers, exchanges them for a short-lived token, and discards it. The token is not written into the site. Recent comments are stored with the other synced replies. The browser shows those saved posts on the profile, because `api.vk.com` does not allow this page to read the API directly.

## Run it

```bash
python3 -m http.server 8080
```

Open `http://127.0.0.1:8080/`. Hash routes keep the back button working on GitHub Pages. The installable app is scoped to `/rss-feeds/` (the GitHub Pages path). More and the mobile menu include Install app. `sw.js` caches the shell, refreshes `feeds.json` and archive shards in the background, and keeps bookmarked images for offline reading. Notifications stay off until that setting is tapped.

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
| `#/vk/<handle>` | VK profile from the synced wall |
| `#/u/vk/<handle>` | VK profile, with the synced posts when the browser cannot call VK |
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
| `replyingTo` | `{name, handle, avatar, id}` when this is a reply and the target is known. `id` is the parent status id |
| `text` | Plain text, line breaks kept. Long X notes are the full note text |
| `date` | Display time of the original post |
| `sortDate` | Timeline order. Set when a repost should sort by the repost time |
| `url` | Original post URL |
| `links` | `[{expanded, display, anchorText}]` for real URLs. Media and quote `t.co` links are already removed |
| `media` | `[{type, url, poster, width, height, alt, expires, fallback}]`. `type` is `photo`, `video`, or `animated_gif`. `expires` is the Meta CDN `oe=` time. `fallback` is a second URL tried when the first image fails |
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
python3 scripts/selftest.py
python3 scripts/x_to_feed.py response.json --feeds feeds.json --feed x:redacted_handle --handle redacted_handle
```

`update_feeds.py` dedupes on platform + id, sorts newest first, and keeps about 300 posts. If a source fails, that feed’s previous posts stay. A post that drops out of the latest RSS page stays in the file until the cap, so its media URL can be refreshed later. Adapters live in `scripts/adapters/`:

| Adapter | Source |
| --- | --- |
| `x_api_v2` | Offline for timelines. Parses a saved X API v2 payload (`data`, `includes.tweets`, `includes.users`, `includes.media`), including the fixture files. A tool header line and a trailing note are ignored. The build does not call `api.x.com` or `api.twitter.com` |
| `fxtwitter` | `api.fxtwitter.com` profile statuses. This is the live X source |
| `nitter_rss` | Nitter RSS (`RT by @…`, blockquote quotes). Fallback when fxtwitter fails |
| `rsshub_threads` | RSSHub `/threads/<user>` |
| `rsshub_instagram` | RSSHub `/instagram/user/<user>` |
| `generic_rss` | RSS or Atom: title, description, `content:encoded`, enclosures |
| `youtube_rss` | YouTube’s official channel feed, `https://www.youtube.com/feeds/videos.xml?channel_id=<UC…>`. No API key. That feed has no CORS header, so the build fetches it. `channelId` is copied onto the profile so the browser can ask for subscribers. Durations and subscriber counts are not fetched during the build. Thumbnails stay on `i.ytimg.com`. The live feed is Canadian Prepper (`UCfgtuaUadGgOA-91geQ8Qog`). Marques Brownlee and Tesla exist only as files under `scripts/fixtures/` |
| `youtube_community` | Community posts for a YouTube channel (text, images, polls, shared videos). There is no official feed. The build tries Invidious `/api/v1/channels/<id>/community`, then RSSHub `/youtube/community/<handle>` on the sync container, then Piped if that channel payload has posts, then the public `/posts` page. When that page has fewer than 20 posts, or names the posts tab but the HTML has none, the build sends that tab’s browse id and params to `youtubei/v1/browse` and follows one continuation if it adds posts. Posts already read from the HTML stay. Images stay on `yt3.ggpht.com` / `googleusercontent`. Comments load in the browser from Invidious `/api/v1/post/<id>/comments?ucid=<channelId>` and are not stored. A failed fetch keeps the previous community posts |

Each adapter strips HTML while keeping line breaks, unescapes entities, drops trailing media links, and fills the same post and profile fields. The configured profile in `feeds.config.json` wins over a thinner profile parsed from a post.

X images stay hotlinked (`pbs.twimg.com`, `video.twimg.com`). Instagram and Threads images stay hotlinked too. A Meta CDN URL carries `oe=`, a hex unix timestamp about five days out, and that time is stored as `expires` on the media object (`posterExpires` when the poster is a different URL). Posts in the latest feed take their URLs from that feed. Older posts whose URLs expire within 36 hours are refreshed from `https://www.instagram.com/p/<code>/embed/` or the Threads post page. When the embed page has no image, Instagram falls through to its public oembed thumbnail and `https://www.instagram.com/p/<code>/media/?size=l`. If a Threads page has no image URL, the current URL stays. A second URL, when one comes back, is stored as `fallback`. The page tries that URL if the first image errors, then shows the gray media tile (`#333639`) with no broken-image icon. Avatars hotlink the same way. A file under `media/` is kept only when no CDN URL could be found. `--download-media` no longer copies files.

Live X accounts use fxtwitter, then Nitter RSS (`nitter.meowing.monster`, `nitter.kareem.one`, `nitter.jaydenha.uk`). `TWITTER_AUTH_TOKEN`, if you set it, is sent only as an `auth_token` cookie on those Nitter requests and on RSSHub `/twitter` or `/x` routes. It is not sent anywhere else. `x_to_feed.py` only merges a JSON file you already have.

## Storage

The browser loads whatever a public CORS API will give it. The build stores only what the browser cannot fetch. A half-hour sync does not commit. Archive stubs are published once a day on the orphan `data` branch, with a copy on the Internet Archive.

| Data | Where it comes from | Stored in the site artifact? |
| --- | --- | --- |
| X replies, nested replies, and fresh counts | `api.fxtwitter.com` `/2/conversation/<id>` and `/2/status/<id>`, from the browser, when a post page opens | No. A `comments/<id>.json` file is used only if that call fails |
| YouTube comments, durations, subscriber counts | Invidious, rotating hosts from `api.invidious.io`, then Piped | No. A `comments/yt_<id>.json` file is used only if the live calls fail |
| Photos and video | Hotlinked, or loaded by the browser from a permanent URL or an embed | No binaries |
| Timelines | Build: fxtwitter or Nitter for X, RSSHub for Instagram and Threads, YouTube’s RSS feed, other RSS | Yes, in `feeds.json`, about 300 posts |
| Older posts | Append-only stubs in `archive/YYYY-MM.json` on the `data` branch, copied daily to the Internet Archive | The half-hour artifact includes them. Text only, about 200 bytes each. No media and no comments |
| Meta CDN URL refresh | Build, for posts still in `feeds.json`, because those URLs expire | Yes, as URLs on the post |
| Threads and Instagram comments | Build. The browser cannot call those endpoints without a cookie | Yes, and only for posts under 7 days old. Not copied into the archive |

## Archive

Posts that fall out of the 300-post `feeds.json` window stay on the timeline as stubs. A stub is `p` (platform), `id`, `h` (handle), `d` (date), `k` (kind, omitted for a normal post), and `t` (text, whitespace collapsed, at most 280 characters). Nothing else is stored. `archive/index.json` lists the shard names newest first. The page loads that index and the newest shard with `feeds.json`. Older shards load when the bottom of Home, a profile, or a List scrolls into view.

The seed built from the current `feeds.json` is 35 stubs. Each stub averages **213 bytes** (smallest 106, largest 388, because a 280-character snippet plus the keys can pass 300 bytes). Those 35 posts run from 10 Aug 2026 through 20 Oct 2026, 71 days, which is about 180 posts a year:

`180 × 213 bytes ≈ 38 KB a year`

The 300 KB/year figure is the same stub at a busier pace: `1400 × 213 bytes ≈ 298 KB`, about four posts a day. At the volume in this seed, a year of shards is a few dozen kilobytes.

The browser reads the `data` branch. `archive/index.json`, the current UTC month, and the newest shard are requested from `https://raw.githubusercontent.com/owner-account/rss-feeds/data/archive/<file>` first, because jsDelivr keeps a branch name cached for about 12 hours. Older months start at `https://cdn.jsdelivr.net/gh/owner-account/rss-feeds@data/archive/<file>`. After that host, the page tries the other GitHub URL, then `https://archive.org/download/sergi-rss-feeds-archive/archive/<file>`. All three respond with `Access-Control-Allow-Origin: *`.

Each sync merges a complete archive from the live site, then from the raw `data` branch, then from that Internet Archive item. Stubs already stored keep their first text. A partial download leaves the local files alone, and a source that omits a month leaves that month in place. The half-hour run copies `archive/` into the Pages artifact and does not push the `data` branch. A post that drops out of `feeds.json` between daily updates is in that artifact, and the next build merges it when the live site still has the file. The shards the browser reads change when the daily `data` push lands.

Once a day, at 06:17 UTC, the workflow uploads the shards to the Internet Archive item `sergi-rss-feeds-archive` and force-pushes one squashed commit onto the orphan `data` branch. That branch contains only `archive/`. Squashing keeps it at a single commit so the history stays small. The Internet Archive item is the copy to download again if that commit is replaced. The upload runs when `IA_ACCESS_KEY` and `IA_SECRET_KEY` are both set. With either one missing, the step prints a skip line, exits 0, and the `data` branch is still updated. A push made with `GITHUB_TOKEN` does not start another run. Add the two keys under Settings → Secrets and variables → Actions. They are never written to the repo or printed in the log.

When a stub scrolls into view, the browser fills it in and keeps a successful result in IndexedDB (`rss-feeds-live`, key `arch:`) for about 24 hours. A failed request is not stored as a deleted post.

- **X.** `https://api.fxtwitter.com/2/status/<id>` allows every origin and returns the full text, media, counts, and quotes. A 404, or fxtwitter code 404 or 144, is the tombstone below. A network miss keeps the stored snippet.
- **YouTube.** The card uses `https://i.ytimg.com/vi/<id>/hqdefault.jpg` immediately. That host sends `Cross-Origin-Resource-Policy: cross-origin`, so the image loads in an `<img>`. Title, duration, and view count come from Invidious or Piped when the card is on screen. Comments still load on the watch page.
- **Instagram.** Checked in Chrome on 20 Oct 2026. `https://www.instagram.com/p/<shortcode>/media/?size=l` does redirect to a fresh `cdninstagram.com` JPEG, and curl can download it. The browser cannot show that image: the JPEG is sent with `Cross-Origin-Resource-Policy: same-origin`, so the `<img>` errors (`naturalWidth` 0) even with `referrerpolicy="no-referrer"`. The embed `https://www.instagram.com/p/<shortcode>/embed/` does load in an iframe from another origin. The photo inside that frame was 500×666 for `DeZgzTEggQe`. Archive cards use the embed, plus the stored caption and an Open original link. The embed covers video as well as photos.
- **Threads.** There is no `/media` redirect. `https://www.threads.com/t/<code>/media` is 404, and `https://www.instagram.com/p/<threads code>/media/?size=l` is not that post. `https://graph.threads.net/oembed` allows every origin, but the HTML is a “View on Threads” blockquote plus `embed.js`, and inserting it in the page did not produce an image. The post page’s `og:image` is a signed CDN URL with an `oe=` expiry, and the page itself has no CORS header, so the browser cannot read it. `https://www.threads.net/t/<code>/embed` does load in an iframe: the photo post `DeZtp-TkQHh` rendered a 2160×3260 image and the caption, and a text-only post rendered the text. Archive cards use that embed, the stored snippet, and Open original. Newest Threads posts that are still in `feeds.json` keep the Meta CDN refresh. Those URLs are not copied into the archive. If the embed is blocked later, the snippet and the Open original link remain; the gray media tile (`#333639`) is what an image shows when its URL fails.

Comments stay on demand. X and YouTube load them in the browser. Instagram and Threads are fetched during sync only while the post is under 7 days old, and those files are deleted after that. The archive does not keep them.

A post the source says is gone uses X’s tombstone, including the sentence **This post is unavailable.** A network miss does not.

Live responses sit in memory, then `sessionStorage`, then IndexedDB (`rss-feeds-live`) when that quota is full. The cache lasts about 12 minutes. `fetchedAt` is not shown.

X reply order matches the old stored list: the author’s self-thread first, then `likes + replies*2 + reposts`, with a bump for a verified account. Giveaway, link-only, duplicate, and new-account replies sit behind **Show probable spam**. The number on the post stays the source count. Opening a post also loads replies for about 10 of its busiest replies, about 20 each, and stops there. Opening one of those replies loads the next level the same way. A failed live call, with no snapshot, is “Replies aren’t available for this post.”

YouTube comments keep the watch-page **N replies** control. The build does not fetch them.

## Replies

Replies are not inlined on the home timeline. The reply count on a post opens `#/@handle/status/<id>` (or the platform equivalent). That page shows the post, a read-only reply row, then replies. A missing thread is “Replies aren’t available for this post.” An empty list is “No replies yet.” Counts and reply text are never invented.

```json
{
  "postId": "2112600761762717997",
  "platform": "x",
  "source": "fxtwitter",
  "fetchedAt": "2026-10-20T18:00:00Z",
  "replies": []
}
```

`fetchedAt` is when that file was last written. The page uses it only to hide a stale file. It is not shown in the interface.

Each reply uses the same post shape, with `kind` set to `reply` and `replyingTo` filled in. X keeps about 50 replies in Relevant order: the author’s own self-thread first, with the vertical line between those avatars, then other replies by `likes + replies*2 + reposts`. A verified account is scored a bit higher. Giveaway, link-only, duplicate, and new-account bot replies are flagged and sit behind **Show probable spam**. The number on the post stays the source’s reply count, not the length of this list.

Every reply is a post of its own. Clicking it opens `#/@handle/status/<replyId>` (or `#/<platform>/<handle>/status/<replyId>`). That page shows the posts above it, connected by the thread line, with **Replying to** on each one. A chain longer than three starts with the first post, **Show more**, and the post it is directly under. Replies to the focused post are listed below it. In that list, a direct reply from the same author, or one from the original poster, is shown under the reply with the thread line. **Show replies** opens that reply’s page when none of those are shown and the reply has replies. **Show more replies** does the same when some are already shown and more exist.

For X, that second level is loaded in the browser for the post you are looking at. Threads and Instagram store one extra level next to the post when the build can see those replies. Opening a reply that neither the live call nor a stored file can fill shows “Replies aren’t available for this post.” The page does not invent replies.

Home, Following, and List timelines hide `kind: reply`, except a self-reply that has another self-reply pointing at it. That post shows **Show this thread**. A profile’s **Replies** tab lists replies from that account.

The build writes comment files only for Instagram, Threads, and `commentRss` posts that have a date and are under 7 days old. Older files are deleted. X and YouTube comment files are deleted even when the post is still in `feeds.json`. A failed comment fetch keeps the file pulled from the last published site. On a successful fetch the new replies replace the file, and a reply id that was already stored keeps the new like count when a field is missing on the new copy. `--fixtures` reads `scripts/fixtures/replies/<statusId>.json` (fxtwitter conversation JSON) or `<statusId>.html` (Nitter status HTML) and does not call the network.

| Platform | How replies are fetched |
| --- | --- |
| X | The browser calls `https://api.fxtwitter.com/2/conversation/<statusId>` (`replies`, one page). A reply is kept only when `replying_to.status` or the conversation id is this post. Replies to a reply are kept only when `replying_to.status` is that reply. Duplicate ids collapse. Deleted or unavailable replies are dropped. Missing text, handle, date, or target is filled from `https://api.fxtwitter.com/2/status/<id>`, up to about 15 lookups. The parent’s `status.replies` updates the count on the post. The browser does not call Nitter or `api.twitter.com`. If the live call fails, the page tries `comments/<id>.json` |
| Threads | Logged-out `threads.net` / `threads.com` post HTML. Replies are read from embedded `direct_replies`, `reply_threads`, or `thread_items`, and `direct_reply_count` is written to `stats.replies`. A reply’s own `direct_replies` are stored under that reply’s id. When the page did not include them, the reply’s own Threads page is fetched for about 10 replies that have replies. Then RSSHub `/threads/post/<code>` when that route is up. `THREADS_COOKIE` is only used if those have no reply text. The cookie is never written to disk |
| Instagram | Logged-out GraphQL, in order: `PolarisPostActionLoadPostQuery` (`doc_id` 8845758582119845), then the current post query `PolarisPostRootQuery` (`doc_id` 29336004576007686) with the shortcode. Then `https://www.instagram.com/p/<shortcode>/embed/captioned/`. Then public viewers (picuki, imginn, dumpor, anonyig). Then RSSHub `/instagram/comments/<shortcode>` and `/instagram/post/<shortcode>/comments` when RSSHub is up. `edge_media_to_parent_comment.count` or `comment_count` is written to `stats.replies`. Child replies come from `edge_threaded_comments` or `preview_child_comments` on that same payload and are stored under the comment id. There is no separate request per comment. `INSTAGRAM_COOKIE` (`sessionid`) calls `/api/v1/media/<id>/comments/` only after the public sources miss. The cookie is never written to disk |
| Other RSS | `wfw:commentRss` is fetched and normalized. `slash:comments` is only the count on the post |
| YouTube | The browser calls Invidious `/api/v1/comments/<id>` (top, then one continuation for about 10 comments that have replies, 20 replies each, no third level). Hosts come from `https://api.invidious.io/instances.json` when that directory allows the page origin, otherwise a short built-in list starting with `https://invidious.f5.si`. Piped `/comments/<id>` is the fallback. Durations try Invidious `/api/v1/videos/<id>`, then Piped `/streams/<id>`. Subscriber counts try Invidious `/api/v1/channels/<channelId>`, then Piped `/channel/<channelId>`. The watch page still expands a comment with its own “N replies” control. A failed live call tries `comments/yt_<id>.json`. A missing thread is “Comments aren’t available.” An empty list is “No comments yet.” |

Media inside X replies stays on `pbs.twimg.com` / `video.twimg.com`.

Subscriptions (`#/subscriptions`) lists videos from accounts you follow: YouTube channels, plus video posts from X, Instagram, and Threads. A video opens `#/watch/<platform>:<id>`. The same player is used on the timeline, on a community post, and on the watch page. It shows the poster first. A tap plays. A file in view can start muted. GIFs loop. The duration sits on the poster.

The page sends no referrer, which is what `video.twimg.com` and the Meta CDNs require before they will hand a file to another site. X keeps the mp4 variants and the player picks one for the screen width. An m3u8 playlist loads through hls.js. A post that only came from Nitter, with no file yet, is resolved from fxtwitter. Instagram and Threads never store `/media?size=l` as the video file (that URL is a JPEG). Sync reads a real `video_url` from the embed page or oembed when one is published, probes each file with a range request, and writes misses to `status.json` under `videos`. A signed mp4 whose `oe=` time has passed is resolved again in the browser. If no file comes back, the poster stays up with **Watch on Instagram** or **Watch on Threads**, plus Retry. YouTube tries healthy Invidious instances (combined itag 22 or 18 through `local=true`, then that instance’s HLS playlist), then Piped, and always ends on the `youtube-nocookie` embed. A source that errors or does not advance within 5 seconds is skipped. The embed is the last step, so a dead instance does not end on a blank tile. Separate DASH audio and video tracks are not played. YouTube comments, durations, and subscriber counts still load when you open the watch page. Share on a post, reply, profile, or the watch page opens X’s menu: a dropdown on a wide screen and a bottom sheet on a phone. Copy link and Share post via… use this site’s permalink (`#/@handle/status/id`, or the profile or watch route). Copy original link and Open original on the platform use the source URL. Share via… is hidden when the browser has no share sheet. Crawlers only see the generic preview in `index.html`, because each post is a hash route.

## Adding an account

Edit `feeds.config.json` and add an object under `feeds`. A push to `main` runs the sync workflow.

```json
{
  "id": "x:someone",
  "platform": "x",
  "handle": "someone",
  "adapter": "fxtwitter",
  "source_urls": ["{fxtwitterBase}/2/profile/someone/statuses"],
  "fallbacks": [
    {
      "adapter": "nitter_rss",
      "source_urls": [
        "https://nitter.meowing.monster/{handle}/rss",
        "https://nitter.kareem.one/{handle}/rss",
        "https://nitter.jaydenha.uk/{handle}/rss"
      ]
    }
  ],
  "limit": 8,
  "profile": { "name": "Someone", "url": "https://x.com/someone" }
}
```

`id` is what Follow stores (`platform:handle`). `adapter` is one of the names in the table above. Instagram uses `rsshub_instagram` and `{rsshubBase}/instagram/user/{handle}`. Threads uses `rsshub_threads` and `{rsshubBase}/threads/{handle}`. Other sites use `generic_rss` and the feed URL. `limit` is how many new items to keep from each fetch. The configured `profile` fills in name, avatar, and bio when the feed is thin.

The new account is followed in a fresh browser. An existing browser keeps its saved follow list until you follow the account from the Feeds page.

## Optional secrets

The sync runs without any secrets. Add these only as repository Actions secrets (Settings → Secrets and variables → Actions). They are passed to the job as environment variables when the secret exists, and the workflow never prints them.

| Secret | Used for |
| --- | --- |
| `INSTAGRAM_COOKIE` | Last resort for Instagram comments, after the public sources miss. A `sessionid` value or a full cookie header |
| `THREADS_COOKIE` | Last resort for Threads replies, after the public page and RSSHub miss |
| `TWITTER_AUTH_TOKEN` | Optional `auth_token` cookie sent only to Nitter and to RSSHub `/twitter` or `/x` routes during the build |
| `IA_ACCESS_KEY` | S3 access key for the daily upload to the Internet Archive item `sergi-rss-feeds-archive`. The upload is skipped when this or `IA_SECRET_KEY` is empty |
| `IA_SECRET_KEY` | S3 secret key for that same item. The upload is skipped when this or `IA_ACCESS_KEY` is empty |

The build refuses `api.x.com` and `api.twitter.com`. X replies are loaded by the browser from fxtwitter, which needs no token. Do not put a bearer token in the page.

## Grayjay

The no-login YouTube requests above follow ideas from FUTO Grayjay’s plugins ([gitlab.futo.org/videostreaming/plugins](https://gitlab.futo.org/videostreaming/plugins)), reimplemented here. None of that source is copied.

Licenses checked on 21 Oct 2026:

| Source | License | Used how |
| --- | --- | --- |
| Grayjay app | FUTO Source First License 1.1 (non-commercial, no sublicensing) | Not copied |
| Official YouTube, Odysee, PeerTube, and Rumble plugins | GNU AGPL-3.0 | Not copied. AGPL would cover this repo if the code were included |
| Community Instagram plugin `b-risk/Grayjay-Instagram` | GPL-3.0 | Not copied |
| grayjay-sources.github.io index | Public domain / Unlicense | The index only. Plugin code is separate |

What was worth reimplementing, and what landed:

- The watch page’s comment continuation is the token whose payload names `engagement-panel-comments-section` (or `comments-section`). Current pages omit `CONTINUATION_REQUEST_TYPE_WATCH_NEXT`, which the old matcher required, so the public `next` call never started. The token is read either way.
- `youtubei/v1/next` is called with the WEB client and the key from that page. If `www.youtube.com` returns no comments, the same body is sent to `m.youtube.com`. One more comment page is loaded when the first page is short. One reply page is loaded for up to four threads that have a reply count and no inline replies. Both `commentEntityPayload` and the older `commentRenderer` shape are read. There is no third level.
- Community posts use the posts tab’s `browseEndpoint` from the channel HTML when `ytInitialData` has no posts, and when that page has fewer than 20. One browse continuation is followed when it adds posts. A shared video title is read from either a string or the public text runs.

What was not taken:

- Bot attestation (`jnn-pa.googleapis.com` / botguard) is a bot check. This build does not solve it, and it does not embed another client’s API key.
- The Instagram plugin rotates Kittygram frontends. On 21 Oct 2026 those hosts were down, empty, or behind a proof-of-work challenge. This build does not solve that challenge. Instagram comments stay on logged-out GraphQL, the captioned embed, and the public viewers already listed above.
- Grayjay has no official plugin for X, Threads, or VK. X replies stay on fxtwitter, then Nitter. Threads stays on the public mobile post page. VK stays on the public wall API. A VK Video plugin is only an open request there.

Worth adding later, against each site’s own public API (their Grayjay plugins are AGPL, so only the API is of interest):

- **PeerTube.** `GET /api/v1/videos` and `GET /api/v1/videos/:id/comment-threads` on an instance. No login.
- **Odysee.** Public claim and comment endpoints.
- **Rumble.** Public pages and embeds.

## GitHub Actions

`.github/workflows/sync.yml` runs every 30 minutes, on **Run workflow**, and on every push to `main`. The job starts RSSHub (`diygod/rsshub` on port 1200) and RSS-Bridge (`rssbridge/rss-bridge` on port 8080). It downloads the last published `feeds.json` (and Instagram/Threads comment files under 7 days old) so a failed source can keep the previous data. Instagram and Threads try the local RSSHub container, then the public RSSHub mirrors in `feeds.config.json`, then RSS-Bridge. X timelines try fxtwitter, then the Nitter mirrors. One failed source keeps that feed’s previous posts and does not fail the run.

The half-hour job does not commit `feeds.json`. It copies `index.html`, `app.js`, `styles.css`, `favicon.svg`, `manifest.webmanifest`, `sw.js`, `icons/`, `splash/`, `screenshots/`, `.nojekyll`, `feeds.json`, `archive/*.json`, and any `comments/*.json` into `_site`, stamps the commit SHA into `_site/sw.js`, prints the artifact size, and fails if that directory is over 200 MB. `actions/upload-pages-artifact` and `actions/deploy-pages` publish `_site`. `comments/`, `media/`, and `archive/` are gitignored, so `main` keeps the code and the `feeds.json` seed. At 06:17 UTC the workflow uploads `archive/` to the Internet Archive when the keys are set, then force-pushes one squashed commit to the orphan `data` branch. See Archive above.

## GitHub Pages

Pages has to be built by GitHub Actions (Settings → Pages → Build and deployment → Source: GitHub Actions). A deploy-from-branch source will not pick up this workflow. `.nojekyll` is in the artifact so Pages does not run Jekyll. Paths are relative (`feeds.json`, `styles.css`), so the site works at `/` or under `/rss-feeds/`.
