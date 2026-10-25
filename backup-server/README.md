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

## Free Hosting Options

### Option 1: Hugging Face Spaces (Recommended — 100% Free Forever)
Hugging Face Spaces provides a **free Docker CPU Basic tier** with:
- **2 vCPUs, 16 GB RAM, 50 GB persistent storage**
- **Unmetered bandwidth and requests** (no 100k daily cap)
- **Automatic HTTPS** (`https://<username>-<spacename>.hf.space`)
- **Cost**: **$0 / month forever**

#### Setup Steps:
1. Go to [Hugging Face](https://huggingface.co/new-space).
2. Create a new Space:
   - **Space name**: `viktorych-backup` (or any name you choose)
   - **License**: MIT or Apache 2.0
   - **Select the Space SDK**: **Docker** -> **Blank**
   - **Space hardware**: **CPU Basic (2 vCPU · 16 GB RAM) - Free**
3. In your Space's **Settings** -> **Variables and secrets**:
   - Secret `ACCOUNT_PEPPER`: Enter the same pepper string used in your primary Cloudflare Worker.
   - Secret `OWNER_CLAIM_CODE`: Enter your owner claim code.
   - Variable `ALLOWED_ORIGINS`: `https://viktorychgroup.github.io`
4. Deploy the code to your Space:
   - You can git push this repository directly to the Hugging Face Space remote, or push just the Dockerfile and source files.
5. Copy your Space URL:
   - `https://<your-username>-<space-name>.hf.space`
6. In your GitHub repository **ViktorychApp**:
   - Go to **Settings** -> **Secrets and variables** -> **Actions**.
   - Under **Variables** (or Secrets), add:
     - Name: `ACCOUNTS_BACKUP_API`
     - Value: `https://<your-username>-<space-name>.hf.space`
7. Done! The next deploy of ViktorychApp will automatically include `backupApi`.

---

### Option 2: Secondary Cloudflare Worker (Free Tier)
If you have a second free Cloudflare account or want to run a secondary worker:
1. Deploy `worker/` to your second Cloudflare account or under a secondary name:
   ```bash
   cd worker
   npx wrangler deploy --name viktorych-accounts-backup
   ```
2. Set `ACCOUNTS_BACKUP_API` in GitHub repository variables:
   - `https://viktorych-accounts-backup.<your-subdomain>.workers.dev`

---

### Option 3: Koyeb / Render / Fly.io / Docker VPS
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
