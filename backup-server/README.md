# ViktorychApp Backup Accounts Backend

Backup accounts API for **ViktorychApp**. It answers `/v1/*` whenever the
primary Cloudflare Worker is out of free daily requests (HTTP 429, Error 1027)
or temporarily down.

The key rule: **the backup is stateless and uses the same Cloudflare D1
database and R2 bucket as the primary Worker.** Accounts, passwordless account
numbers, sessions, follows, Drive metadata and media therefore always match,
no matter which endpoint answers the request.

> Earlier versions of this folder ran their own empty Miniflare database. That
> is why signing in failed during a Cloudflare quota outage: the backup did not
> know any Cloudflare account number and could not validate Cloudflare session
> tokens. Local Miniflare mode is still available for development and tests,
> but Render runs in shared mode.

---

## How it works

1. `accounts.config.js` / `accounts_publish.py` publish `backupApi`, so the
   frontend holds the endpoint list `[api, backupApi]`.
2. On 429/502/503/504 or a network error the frontend retries the request
   against the backup endpoint.
3. The backup calls the Cloudflare **D1 REST API** and **R2 REST API**. Those
   products have their own free quotas, so they keep serving while the Worker
   request quota is exhausted.
4. Nothing is stored on Render. A restart or redeploy loses no account data.

Do not create accounts only on the backup and expect them to sync back later:
there is nothing to sync. Both endpoints are views of the same database.

---

## Deploy on Render (free, no credit card)

1. Sign in at [render.com](https://render.com) with GitHub.
2. **New +** → **Blueprint**, choose the `ViktorychApp` repository. Render
   detects `render.yaml`.
3. Fill in these environment variables:

   | Variable | Value |
   | --- | --- |
   | `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account id |
   | `CLOUDFLARE_API_TOKEN` | A scoped token (see below) |
   | `ACCOUNT_PEPPER` | Exactly the same value as the Worker secret |
   | `OWNER_CLAIM_CODE` | Optional, same as the Worker |
   | `TURNSTILE_SECRET` | Optional, same as the Worker |

   `D1_DATABASE_NAME` defaults to `viktorych-accounts`; `R2_BUCKET` defaults
   to `viktorych-data`. Set `D1_DATABASE_ID` only if the lookup by name is not
   allowed by your token.

4. **Cloudflare API token permissions** (Create Token → Custom token):
   - Account → D1 → Edit
   - Account → Workers R2 Storage → Edit
   - Account Resources: include your account only.

   Do not use the Global API Key. The token is only used server-side.

5. Copy the service URL, e.g. `https://viktorych-backup.onrender.com`.
6. In GitHub **Settings → Secrets and variables → Actions → Variables**, add
   `ACCOUNTS_BACKUP_API` with that URL. `sync.yml` writes it into the published
   `accounts.config.js`.

7. Check `https://viktorych-backup.onrender.com/backup/status`. It must report
   `"mode": "remote"` and your D1 id. `/v1/health` should report
   `{"ok":true,"ready":true}`.

If the status shows `"mode": "local"`, the Cloudflare credentials are missing
and the instance is using a private empty database — logins will not transfer.

---

## Keep it warm

Render's free web service sleeps after about 15 minutes without traffic, and a
cold start takes 30-60 seconds. The Worker cron (`worker/src/render-warm.js`)
pings `/backup/health` every 10 minutes, except 21:00-00:59 UTC, which keeps
it awake about 620 hours a month, inside the free 750. The GitHub `Backup
Warmup` workflow still exists but GitHub runs it only every few hours.

When the main API fails, the app also sends one background ping to the
backup so it is already waking while the user retries.

## Free plan limits this server guards against

| Limit | Guard |
| --- | --- |
| 512 MB memory | Bounded edge-cache stand-in (32 MB, honours max-age), R2 bodies streamed instead of buffered, `--max-old-space-size=320`, background jobs pause above 360 MB RSS |
| 5 GB outbound bandwidth a month (over it with no card suspends every free service) | Video relays (`/v1/media?url=`, `/v1/yt/*`) are refused with 503 so the Worker relays them; an egress meter (saved in R2 under `ops/render-egress/`) switches to JSON-only answers and hands jobs back to the Worker past `RENDER_EGRESS_BUDGET_MB` (3500) |
| 500 build minutes a month | `buildFilter` in `render.yaml` rebuilds only when `backup-server/`, `worker/src/` or `shared/` change; the image installs no npm packages |
| Hung upstream calls | 20 s timeout on Cloudflare API calls, 28 s per request (504 with Retry-After so the client fails over) |
| Idle connection 502s | `keepAliveTimeout` 120 s, longer than Render's proxy |

`/backup/health` answers without touching D1 or R2 and is the Render health
check. `/backup/status` shows memory, cache, egress and job state.

---

## Local development

```sh
npm install --prefix backup-server   # dev only: Miniflare for local mode
node backup-server/test.mjs
```

Without `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` the server starts in
local Miniflare mode and stores data under `backup-server/data`. To exercise
shared mode locally, copy `.env` values into your shell and run:

```sh
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... ACCOUNT_PEPPER=... node backup-server/server.mjs
```

Use a test database, never production, for local experiments in shared mode.

---

## Other free hosts

The same Docker image works on Koyeb, Fly.io, a Hugging Face Docker Space, or
Oracle Cloud Always Free. The only requirement is outbound HTTPS access to
`api.cloudflare.com`. A second Cloudflare account is not needed (and would
reintroduce separate account data, which this design avoids).

## Background jobs

While the service is awake it also runs the heavy, non-urgent cron jobs:
feed ingest (several due feeds per pass, three fetches at a time), expired
story cleanup (wider pools), the hourly birthday sweeps, and TikTok live
watching when `GITHUB_DISPATCH_TOKEN` is set. Every minute it writes a claim
to the shared D1 (`job_runner`); the Worker cron skips claimed jobs. If the
free instance sleeps the claim goes stale within 2.5 minutes and the Worker
runs them again by itself. `RENDER_JOBS=0` turns this off. `/backup/status`
shows `jobs` (runs, last run, failures).

Push delivery, account deletion and the D1 export stay on the Worker: they
need secrets, Durable Objects or bindings this service does not have.
