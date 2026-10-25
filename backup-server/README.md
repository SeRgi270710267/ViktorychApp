# ViktorychApp Turnkey Backup Backend

100% free, zero-maintenance backup accounts backend for **ViktorychApp**.

Provides seamless auto-failover whenever the primary Cloudflare Worker reaches its free daily quota (100,000 requests/day, HTTP 429 Error 1027) or experiences downtime.

---

## How It Works

1. **Dual-Endpoint Architecture**:
   - `accounts.config.js` and `accounts_publish.py` support `backupApi`.
   - The frontend maintains an active API pointer and endpoint list: `[api, backupApi]`.
2. **Seamless Automatic Failover**:
   - If the primary endpoint returns HTTP 429, 502, 503, 504, or network timeout, requests instantly rotate to `backupApi` and retry.
   - Users remain logged in and active without interruptions or blank errors.
3. **100% Code Parity**:
   - Runs the exact same `worker/src/index.js` logic, D1 SQLite database, and R2 storage using Miniflare and Node.js.

---

## Free Hosting Options (No Paid Plans Required)

### Option 1: Secondary Cloudflare Free Account (Recommended — Fastest & Easiest)
Cloudflare free accounts cost **$0 forever** and require **no credit card**. A second free account provides another **100,000 requests/day** with identical D1 and R2 support and zero code translation.

#### Setup Steps:
1. Register a second free account on [cloudflare.com](https://dash.cloudflare.com/sign-up) (or use a secondary worker name).
2. Create an API token with Workers / D1 edit permissions.
3. Deploy the worker from your terminal:
   ```bash
   cd worker
   CLOUDFLARE_API_TOKEN="<token>" CLOUDFLARE_ACCOUNT_ID="<id>" npx wrangler deploy --name viktorych-accounts-backup
   ```
4. Copy the resulting URL:
   - `https://viktorych-accounts-backup.<second-subdomain>.workers.dev`
5. In your GitHub repository **ViktorychApp**:
   - Go to **Settings** -> **Secrets and variables** -> **Actions**.
   - Under **Variables** (or Secrets), add:
     - Name: `ACCOUNTS_BACKUP_API`
     - Value: `https://viktorych-accounts-backup.<second-subdomain>.workers.dev`
6. Done! GitHub Actions automatically injects `backupApi` into your site deploys.

---

### Option 2: Deno Deploy (1,000,000 Free Requests / Month)
Deno Deploy has a generous **Free Tier**:
- **1,000,000 free requests / month**
- **Global edge network** with < 50ms latency
- **No credit card required**
- Automatic HTTPS: `https://<app-name>.deno.dev`

---

### Option 3: Koyeb / Render / Free Docker Host
If you prefer running a containerized Node.js backend:
- **Koyeb**: Free Eco/Hobby tier (runs Docker containers 24/7 without credit card).
- **Render**: Free web services (750 free hours/month).

Run with Docker:
```bash
docker build -f backup-server/Dockerfile -t viktorych-backup-server .
docker run -d -p 7860:7860 \
  -e ACCOUNT_PEPPER="your-secret-pepper" \
  -e OWNER_CLAIM_CODE="your-claim-code" \
  -e ALLOWED_ORIGINS="https://viktorychgroup.github.io" \
  -v viktorych_data:/data \
  --name viktorych-backup \
  viktorych-backup-server
```

---

## Local Testing
Run the automated test suite locally:
```bash
node backup-server/test.mjs
```
All endpoints (`/v1/health`, `/v1/signup`, `/v1/session`, `/v1/login`) are verified against persistent SQLite storage.
