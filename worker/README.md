# Accounts

ViktorychApp accounts live in this Worker. The number that signs someone in is created on the server, shown once, and stored only as a PBKDF2-SHA256 hash. A separate HMAC-SHA256 lookup, keyed with `ACCOUNT_PEPPER`, finds the row without scanning the table and without keeping the number.

The Pages site stays public until this API is actually deployed. `accounts.config.js` in git has `gate: false`. The Sync feeds workflow calls `GET /v1/health` and, only when `ready` and `data` are both true, uploads the feed files to the private R2 bucket and rewrites the Pages artifact so `gate` is true. Until the Cloudflare secrets exist, that check fails closed and the current public site is what gets published.

## Secrets

Add these in the GitHub repository settings. Do not commit them, and do not put a production value in `worker/.dev.vars`.

| Name | Where | Required |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | yes, before the worker or the wall can go live |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret | yes |
| `ACCOUNT_PEPPER` | GitHub Actions secret, then Worker secret | yes, or `/v1/health` stays `ready: false` and the wall stays off |
| `OWNER_CLAIM_CODE` | GitHub Actions secret, then Worker secret | yes, to claim the owner handle once |
| `TURNSTILE_SECRET` | GitHub Actions secret, then Worker secret | no |
| `TURNSTILE_SITEKEY` | GitHub Actions secret | no; set it only together with `TURNSTILE_SECRET` |
| `ACCOUNTS_API` | GitHub Actions variable | no; the workflow discovers `https://viktorych-accounts.<account-subdomain>.workers.dev` |
| `TELEGRAM_BOT_TOKEN` | Worker secret | no; `GET /tg/…` stays 503 until it is set. From `worker/`: `npx wrangler secret put TELEGRAM_BOT_TOKEN` |
| `TELEGRAM_CHANNEL_ID` | GitHub Actions secret, then Worker secret | no; Drive uploads need it. The Accounts workflow copies it with `wrangler secret put` when the GitHub secret is set, and does not print it |
| `WORKER_DISPATCH_TOKEN` | GitHub Actions secret | no; fine-grained token with Actions read and write. GitHub rejects a name that starts with `GITHUB_`. `.github/workflows/worker-dispatch-secret.yml` copies it into the Worker secret `GITHUB_DISPATCH_TOKEN` and does not print it |

`OWNER_CLAIM_CODE` and `ACCOUNT_PEPPER` should be long random strings. The Accounts workflow writes them with `wrangler secret put` and does not print them. An empty value is skipped, not stored.

The API token is account-scoped and needs:

- Account / Workers Scripts / Edit
- Account / D1 / Edit
- Account / Account Settings / Read (so the workflow can read the workers.dev subdomain)
- Account / Workers R2 Storage / Edit (private bucket `viktorych-data`)

The Accounts workflow creates the D1 database `viktorych-accounts` and the R2 bucket, applies `migrations/`, and deploys. If `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` is missing, the job exits 0.

## Wall

Signed-in sessions call `GET /v1/data/<path>` (feeds, stories, people, suggestions, music catalog, live, archive, comments, fallback, discord). The same JSON the sync job used to copy onto Pages is uploaded to R2 instead. Pages keeps the shell, the landing page, icons, the manifest, and the service worker.

A session that is not the owner receives those JSON files with TikTok rows, `ownerOnly: true` rows, and YouTube Shorts removed. The owner session receives the file unchanged. That filter applies only after the wall is on, because the public site is unchanged until the health check passes.

The service worker ships with `ACCOUNTS_WALL` false. The artifact that passes the health check sets it true. While the wall is on and the browser has no session, the worker answers data, media, live, Space, and music requests with 401 and does not read those caches. Log out deletes the data, media, and live caches. The shell cache stays.

Discord live keeps a wall that Sync feeds already turned on. It does not turn the wall on by itself, and it does not put feed files back on Pages.

## Handles

Latin and Cyrillic letters, digits, and underscore, at most 15. The skeleton is NFKC, then the confusable map in `shared/handle-skeleton.js`, then case folding. The owner handle is the exact code points S, Cyrillic е, Cyrillic Р, g, Cyrillic И. A lookalike is rejected even with the claim code. The claim code works once, and only for that exact handle. Skeletons of Viktorych, Viktrych, the Cyrillic spellings of those names, and words such as admin, support, and official are reserved.

The public account id is 12 random digits. It is not derived from the secret number. It is the muted line under the handle.

## Sync

The first sign-in unions follows, bookmarks, likes, reposts, saved posts, lists, custom tabs, and mute lists, then uploads that union. A follow removed on one device stays removed there, and a follow added on the other device stays too: the union does not replay an unfollow. `seenDefaults` includes the unioned follows so the default-follow pass does not add them again. Later saves are last-write-wins, with one union retry on 409. Language stays in `superintelapp-lang`. Bell notes stay on the device. Display choices `showPictures` and `showBanners` travel with the other appearance settings (`show`, `default`, or `none`).

Watch and read history syncs as `history`: at most 300 of the newest video and article rows, each just `id`, `kind`, `platform`, `at`, and `progress` when it is not zero. The same id keeps the newer time. While videos or articles are paused, that device does not upload new rows for that kind and does not replace the saved rows for that kind. Clear all on Videos or Articles sets `historyCut` and removes that kind on the account too. The whole sync body stays under 350 KB. Three hundred slim rows are about 25–40 KB.

## Profile photos

Avatars and banners are not stored in D1. The browser crops an avatar to 400×400 WebP at 60 KB or less and a banner to 1500×500 WebP at 150 KB or less, then `PATCH /v1/profile` sends that file. The Worker writes it to the private R2 bucket `viktorych-data` at `media/avatars/<account id>/<sha256>.webp` or `media/banners/<account id>/<sha256>.webp`, deletes the previous object, and stores only that key in D1. `GET /v1/media/...` requires a session. The response is `private` with `cdn-cache-control: no-store`, so the edge does not keep a shared copy. A data-URL already in D1, including the owner account, is copied to R2 on the first request after deploy and the column is replaced with the key. Neither photo is required. Removing one deletes the R2 object. The account then chooses `default` (grey banner or silhouette) or `none` (no strip and no column). Hide my profile picture is the same pair of choices while the file stays in R2: other people get no avatar URL, and `GET /v1/media/...` for that avatar is 404 unless the request is the account itself.

On the free plan that is at most 210 KB of R2 per account (60 KB + 150 KB). The shared R2 allowance is 10 GB, together with the public music bucket, so a thousand accounts with both photos are about 210 MB. D1 keeps a short key instead of a data URL that used to be up to about 150 KB plus 280 KB of text. The account row itself is a few kilobytes. The sync payload, including history, is capped at 350 KB, and the D1 database allowance used here is 500 MB. A full account is about 0.6 MB, almost all of it in R2. A typical account is a few kilobytes in D1 and at most 210 KB in R2.

## Drive

Drive is a private file store for the owner account only. The Photos section uses the same vault, the same trash, and the same storage total. Albums are drive rows with no plaintext name. The browser encrypts each file with AES-256-GCM. A random file key is wrapped by a master key from the owner’s passphrase (PBKDF2-SHA256, 600000 iterations). The passphrase and the master key stay on the device. The Worker stores wrapped keys and ciphertext in D1 and sends each chunk to the backup channel with `sendDocument`. Those rows are not `telegram_files`, and `GET /tg/…` does not serve them.

A missing session gets 404. Any other session gets 403. Chunks stay under 19 MB. A file can be up to 2 GiB. The browser waits about 1.1 seconds between Telegram calls.

## Local checks

```sh
cd worker
cp .dev.vars.example .dev.vars
npm test
npm run dev
```

`.dev.vars.example` uses 1000 PBKDF2 iterations so local checks finish quickly. Production defaults to 8000 (`PBKDF2_ITERATIONS` in `wrangler.toml`). Workers free tier CPU is tight; lower that variable if sign-up starts failing on CPU time. The local claim code and pepper in the example file are not the production secrets.

CORS allows `https://viktorychgroup.github.io`. The example file also allows `http://127.0.0.1:8080` and `http://localhost:8080` for local screenshots.

## TikTok and Shorts

`tiktokAudience` in `accounts.config.js` and `TIKTOK_AUDIENCE` in `wrangler.toml` are the same flag. `owner` (the default) shows TikTok posts and the Shorts page only to the signed-in owner, and only after the login wall is on. `all` stops stripping `platform: "tiktok"` and shows Shorts to everyone. YouTube Shorts stay owner-only either way.

The sync writes `owner/tiktok.json` (gitignored). It is uploaded to the private R2 key `owner/tiktok.json` when `/v1/health` is ready, and it is not copied to Pages, the data branch, or the Internet Archive. `GET /v1/owner/tiktok` requires an owner session while the flag is `owner`.

Added TikTok accounts live in a second private R2 object, `owner/tiktok-accounts.json`. It is not in the public repo and not served from `/v1/data/`. `GET`, `POST`, and `DELETE /v1/owner/tiktok/accounts` require `accounts.owner === 1` even when the audience flag is `all`, and they use the same rate-limit table as the other owner routes. A removed handle stays in that object’s removed list, so the fallback handle stays out too. The sync and the media-extract job read the object with `CLOUDFLARE_API_TOKEN` the same way the live poll reads `owner/tiktok.json`. Identity for those rows (permanent id, secUid, previous handles) stays on the private object and is not written into `feeds.config.json`.

Added X accounts live in `owner/added-accounts.json`, also private and not served from `/v1/data/`. `GET`, `POST`, and `DELETE /v1/owner/accounts` require an owner session (anonymous requests are 404, other accounts are 403) and use the same rate limits as the TikTok account routes. A post looks the account up on `api.fxtwitter.com` and stores the handle, permanent id, and profile. It starts `sync.yml` and `media-extract.yml` when `GITHUB_DISPATCH_TOKEN` is set. A removed handle and permanent id stay in that object, and the sync does not write the row into `feeds.config.json`.

Saving an account asks the Worker to start `.github/workflows/tiktok-added.yml`, `media-extract.yml`, and `tiktok-live.yml` when the Worker secret `GITHUB_DISPATCH_TOKEN` is set. The repository Actions secret is `WORKER_DISPATCH_TOKEN` (a fine-grained token with Actions read and write on this repo). GitHub rejects a secret name that starts with `GITHUB_`. The workflow runs on `workflow_dispatch`, every 30 minutes, and when `.github/worker-dispatch-secret` is pushed to `main`. It copies the value with `npx wrangler secret put GITHUB_DISPATCH_TOKEN` and does not print it. An empty secret exits quietly. A sha256 of the value is the Actions cache key, so the same value is not copied again. The run that stores a new value also starts this Worker in a local isolate with that secret and forwards only the `tiktok-live.yml` dispatch to GitHub. That check does not write an account on the owner account. The add still succeeds when the secret is missing or GitHub refuses the dispatch; the next scheduled sync, extract, and live poll pick the account up. The token is not a wrangler var and is not committed.

Live playback does not store signed stream URLs. `GET /v1/owner/live/:handle` reads the public room page, then `webcast/room/info`, and returns the highest public variant (origin when TikTok offers it, otherwise the best available variant and a `qualityNote`). The room id is cached at the edge for 5 minutes per handle. A top-quality (origin) stream URL is cached for 10 seconds and is never replaced by an older, lower variant. `GET /v1/owner/live/:handle?stats=1` reads only `webcast/room/info` for the known room id and returns `{ live, viewers, title }` from `user_count`. It does not return stream URLs. That stats body is cached for 10 seconds, and a cache hit does not spend the 240-check budget. The player tries the HLS URL directly with hls.js (no cookies, no auth headers to the CDN), pinned to the top level. If direct playback fails, it retries through `GET /v1/owner/media`, then the FLV URL the same way. Playlists rewritten for that fallback keep relative segments on the proxy. Segments are not the normal path through the Worker. Each owner gets 240 live checks and 1200 media requests per 10 minutes. A 403, 429, 503, or captcha page backs that handle off (5 minutes, then 15, 60, up to 6 hours) and `Retry-After` is honored. `GET /v1/owner/tiktok/health` shows the owner the recent counts and the handles currently backing off. It does not call TikTok.

Live recordings are separate from that player. The poll in `.github/workflows/tiktok-live.yml` starts at most 12 capture jobs (`TIKTOK_RECORD_CAP`), one per handle, in the order the accounts were added and then by start time. Each job stream-copies the origin variant with `ffmpeg -c copy` (one connection, the same Chrome user agent). If origin is missing it copies the best public variant and stores `qualityNote`. Segments are fMP4 under 19 MB in R2 until one uploader per backup channel sends them to Telegram at about 20 messages a minute and honors `retry_after`. A high-bitrate live is about 3 of those segments a minute, so one channel keeps up with 6 lives. A sixth-hour job stops cleanly and the next part continues. Nothing is re-encoded, and a segment stays in R2 until Telegram has it. `GET /v1/owner/tiktok/recordings` is owner-only and returns Recording, Queued, or Saved without stream URLs. Saved lives play from `/tg/tiktok/…/live/{part}/index.m3u8`. `POST /v1/owner/tiktok/channels` stores extra backup channel ids; the response shows only how many, and a masked ending, never the id.

A proxied live refreshes the playlist about every two seconds and also requests each segment. That is on the order of 600 Worker requests per 10 minutes, and the media limit above leaves room for one origin stream. The free tier is about 100,000 requests a day, so a few hours of one owner-only live fits and an all-day stream can use the day’s quota. The script time is the Worker CPU, not the time spent waiting on TikTok.

`GET /v1/owner/play?id=&handle=` plays a public TikTok video for an owner session. The Worker loads `https://www.tiktok.com/@handle/video/id` the way a browser would, keeps only the cookies that response sets (such as `tt_chain_token`), and streams the current play URL with the client’s `Range` header. Bytes are not written to R2, KV, D1, or the Cache API. The response is `private, no-store`. The play URL and those cookies stay in the isolate’s memory for 45 seconds so a seek does not fetch the HTML again, and that memory is not durable. The page asks for a video only when it is on screen and preloads only the next Short. One short is one HTML fetch plus the file itself (a few megabytes; one public @gabii_g5 file was about 2.5 MB) and a handful of Range requests, so a few dozen shorts stay well under the daily request quota. Hours of continuous playback can use tens of thousands of requests. If TikTok answers 403, 429, 503, or a captcha page, the route returns that status and content type in `detail` and the player keeps the poster and the Open on TikTok link.

If TikTok returns 403, 429, or 503, the sync and the live route keep the previous status and report that TikTok blocked the runner. There is no cookie, impersonation package, or captcha bypass. A missing room id is treated as offline.

## What stays reachable

After the wall is on, these are still technically public:

- Git history of this public repository, including `feeds.json` and the other seeds already committed. Removing that needs a history rewrite or a private repository, and every clone and fork keeps the old copy.
- The orphan `data` branch and any Internet Archive items already uploaded. The workflow stops pushing new snapshots once the wall is on. Deleting the branch and the Archive item is a separate step; it does not erase mirrors.
- The music and radio bucket on `r2.dev`, if that bucket is public. The site and the service worker stop handing those URLs to logged-out visitors. Someone who already has an object URL can still fetch it. Making the bucket private and proxying media through this Worker would close that.
- The Pages shell itself: HTML, CSS, JS, icons, manifest, service worker. It has no post text once the wall is on.
