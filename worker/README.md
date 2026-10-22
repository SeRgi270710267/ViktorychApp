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

The first sign-in unions follows, bookmarks, likes, reposts, saved posts, lists, custom tabs, and mute lists, then uploads that union. A follow removed on one device stays removed there, and a follow added on the other device stays too: the union does not replay an unfollow. `seenDefaults` includes the unioned follows so the default-follow pass does not add them again. Later saves are last-write-wins, with one union retry on 409. Language stays in `superintelapp-lang`. Bell notes and watch history stay on the device.

## Local checks

```sh
cd worker
cp .dev.vars.example .dev.vars
npm test
npm run dev
```

`.dev.vars.example` uses 1000 PBKDF2 iterations so local checks finish quickly. Production defaults to 8000 (`PBKDF2_ITERATIONS` in `wrangler.toml`). Workers free tier CPU is tight; lower that variable if sign-up starts failing on CPU time. The local claim code and pepper in the example file are not the production secrets.

CORS allows `https://viktorychgroup.github.io`. The example file also allows `http://127.0.0.1:8080` and `http://localhost:8080` for local screenshots.

## What stays reachable

After the wall is on, these are still technically public:

- Git history of this public repository, including `feeds.json` and the other seeds already committed. Removing that needs a history rewrite or a private repository, and every clone and fork keeps the old copy.
- The orphan `data` branch and any Internet Archive items already uploaded. The workflow stops pushing new snapshots once the wall is on. Deleting the branch and the Archive item is a separate step; it does not erase mirrors.
- The music and radio bucket on `r2.dev`, if that bucket is public. The site and the service worker stop handing those URLs to logged-out visitors. Someone who already has an object URL can still fetch it. Making the bucket private and proxying media through this Worker would close that.
- The Pages shell itself: HTML, CSS, JS, icons, manifest, service worker. It has no post text once the wall is on.
