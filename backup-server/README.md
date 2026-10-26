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
cold start can take a minute. The `Backup Warmup` GitHub workflow pings
`/v1/health` every 10 minutes so sign-in does not wait for a cold start. You can
instead use any free uptime pinger.

---

## Local development

```sh
npm install --prefix backup-server
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
