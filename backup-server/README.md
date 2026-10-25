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

## Top 100% Free Hosting Options (No Credit Card Required)

### Option 1: Render (Recommended Container Host — No Credit Card, 1-Click Deploy)
Render offers a **100% Free Hobby Web Service** (750 free hours/month — enough to run 24/7 forever):
- **No credit card required** to sign up or deploy.
- **Auto-builds from Git**: Builds our tested `backup-server/Dockerfile` with full Miniflare and SQLite persistence.
- **1-Click Blueprint (`render.yaml`)**:
  1. Go to [render.com](https://render.com) and sign in with GitHub (free, no credit card).
  2. Click **New +** -> **Blueprint**.
  3. Select your `ViktorychApp` repository. Render automatically detects `render.yaml`!
  4. Fill in:
     - `ACCOUNT_PEPPER`: Your pepper secret (same as your primary worker).
     - `OWNER_CLAIM_CODE`: Your owner claim code.
  5. Click **Apply**. Render builds and deploys your backup server!
  6. Copy your service URL: `https://viktorych-backup.onrender.com`.
  7. In your GitHub repository **ViktorychApp** -> **Settings** -> **Secrets and variables** -> **Actions**:
     - Add Variable: `ACCOUNTS_BACKUP_API` = `https://viktorych-backup.onrender.com`.

---

### Option 2: Deno Deploy (1,000,000 Free Requests / Month)
- **1,000,000 free requests / month**
- **Global edge network** with instant (<10ms) responses
- **No credit card required**
- Deploy directly from GitHub to `https://<app-name>.deno.dev`.

---

### Option 3: Secondary Cloudflare Free Account
- Free forever, no credit card needed.
- Another **100,000 requests/day**.
- Deploy using Wrangler:
  ```bash
  cd worker
  CLOUDFLARE_API_TOKEN="<token>" CLOUDFLARE_ACCOUNT_ID="<id>" npx wrangler deploy --name viktorych-accounts-backup
  ```
- Set `ACCOUNTS_BACKUP_API` in GitHub repository variables.

---

## Local Testing
Run the automated test suite locally:
```bash
node backup-server/test.mjs
```
All endpoints (`/v1/health`, `/v1/signup`, `/v1/session`, `/v1/login`) are verified against persistent SQLite storage.
