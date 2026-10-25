# Free Cloud Scaling & Speed Multiplier for Viktorych Telegram Backup

This guide explains how to scale the ViktorychApp media and comments backup to maximum speed **100% for free ($0)** by combining:
1. **Free Telegram Bot Pooling**: Multiply upload throughput by 3x–5x by pooling free bots created with `@BotFather`.
2. **Deterministic Parallel Sharding**: Partition media workloads across multiple concurrent runners with `--shard K/N`.
3. **Turnkey 24/7 Free Cloud Workers**: Deploy background workers with 16 GB RAM on **Hugging Face Spaces** or **Oracle Cloud Always Free** at zero cost, without burning GitHub Actions minutes.

---

## 1. Telegram Multi-Bot Pooling (3x–5x Speedup for $0)

### Why this is needed
Telegram limits any single bot in a channel to about 20 messages per minute (roughly 1 message every 3 seconds, enforced by `MIN_INTERVAL = 3.0s`). If you upload with a single bot, 100 media files take at least 300 seconds (5 minutes).

### The Solution: Multi-Bot Round-Robin
Telegram allows you to create up to **20 bots per account for free**. ViktorychApp's backup engine supports `TELEGRAM_BOT_TOKENS`. The engine monitors per-bot cooldown timestamps independently:
- **1 bot**: 1 file every 3.0s (~20 files/min)
- **3 bots**: 1 file every 1.0s (~60 files/min, **3x speedup**)
- **5 bots**: 1 file every 0.6s (~100 files/min, **5x speedup**)

### Setup Instructions
1. Open Telegram and message [@BotFather](https://t.me/BotFather).
2. Run `/newbot` and create 2, 3, or more bots (e.g. `ViktorychBackupBot1`, `ViktorychBackupBot2`, `ViktorychBackupBot3`).
3. Add **all** created bots as administrators to your private Telegram backup channel with permission to post messages.
4. Copy each bot token.
5. In your GitHub repository settings (**Settings > Secrets and variables > Actions > New repository secret**), add:
   - **Name**: `TELEGRAM_BOT_TOKENS`
   - **Value**: A comma-separated list of your bot tokens:
     ```
     123456789:ABCdefGHIjklMNOpqrSTUvwxYZ,987654321:ZYXwvuTSRqpoNMLkjIHGfedCBA,111222333:AAAABBBBCCCCDDDDEEEEFFFFGGGG
     ```
6. ViktorychApp will automatically detect the pool, log `multi-bot pool active (3 bots)`, and dynamically route uploads to whichever bot is idle. Every bot token is automatically redacted from logs.

---

## 2. Parallel Sharding (`--shard K/N`)

You can run multiple instances of `telegram_backup.py` concurrently across multiple machines or workflow matrix runners without race conditions.

ViktorychApp deterministically partitions R2 keys using hash modulo:
$$\text{shard} = \text{MD5}(\text{key}) \pmod N$$

### Usage
- Runner 1: `python3 scripts/telegram_backup.py --shard 0/2`
- Runner 2: `python3 scripts/telegram_backup.py --shard 1/2`

Both runners process completely disjoint file sets in parallel. When uploading manifests, `save_manifest` atomically fetches the remote manifest from R2, merges new entries (`merge_manifest`), and updates Cloudflare D1 with atomic upserts.

In GitHub Actions, you can trigger a specific shard via **Run workflow** by entering `0/2` or `1/2` in the `shard` input.

---

## 3. Turnkey 24/7 Cloud Background Worker on Hugging Face Spaces (Free 16 GB RAM)

Hugging Face Spaces offers **Docker Spaces** that are **100% free forever** with:
- **2 vCPUs**
- **16 GB RAM**
- **50 GB Disk**
- Unmetered network connectivity
- Continuous 24/7 uptime without idle shutdowns when serving an open HTTP port

A ready-to-run Dockerfile and lightweight server are provided in `docker/telegram-backup/`.

### Deployment Steps (5 Minutes)
1. Sign up for free at [huggingface.co](https://huggingface.co).
2. Click your profile icon > **New Space**.
3. Configure the Space:
   - **Space name**: `viktorych-backup`
   - **License**: `mit`
   - **Space SDK**: **Docker**
   - **Docker template**: **Blank**
   - **Space hardware**: **Free (2 vCPU · 16 GB RAM)**
4. Clone your new Hugging Face Space repository locally, or push `ViktorychApp` to it as a git remote:
   ```sh
   git remote add hf https://huggingface.co/spaces/<your-username>/viktorych-backup
   git push hf main
   ```
5. In your Space's **Settings > Variables and secrets > New secret**, add your secrets:
   - `TELEGRAM_BOT_TOKENS`: your comma-separated bot tokens
   - `TELEGRAM_CHANNEL_ID`: your `-100...` channel ID
   - `CLOUDFLARE_API_TOKEN`: your Cloudflare API token
   - `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare Account ID
   - `TG_INTERVAL`: `120` (runs backup every 2 minutes)
   - `TG_SHARD`: optional shard (e.g. `0/2`) if running multiple Spaces
6. The Space will automatically build the container and start `docker/telegram-backup/server.py`.
7. You can check the live status at `https://<your-space-name>.hf.space/health` which outputs:
   ```json
   {
     "status": "idle",
     "runs_total": 4,
     "errors_total": 0,
     "service": "viktorych-telegram-backup",
     "bots_configured": 3,
     "time": 1761400000
   }
   ```
8. To immediately trigger an out-of-band backup run at any time, send a POST request:
   ```sh
   curl -X POST https://<your-space-name>.hf.space/run
   ```

---

## 4. Alternative: Oracle Cloud Always Free (24 GB RAM, 4 vCPUs)

Oracle Cloud Infrastructure (OCI) provides a permanent **Always Free Tier** (not a 30-day trial) that includes:
- **4 Ampere A1 ARM vCPUs**
- **24 GB RAM**
- **200 GB NVMe Storage**
- **10 TB / month** outbound data transfer

### Quick Docker Run on Oracle Cloud
SSH into your free ARM instance and run:
```sh
git clone https://github.com/ViktorychGroup/ViktorychApp.git
cd ViktorychApp

docker build -t viktorych-backup -f docker/telegram-backup/Dockerfile .

docker run -d \
  --name viktorych-backup \
  --restart unless-stopped \
  -e TELEGRAM_BOT_TOKENS="123:ABC,456:DEF,789:GHI" \
  -e TELEGRAM_CHANNEL_ID="-1001234567890" \
  -e CLOUDFLARE_API_TOKEN="..." \
  -e CLOUDFLARE_ACCOUNT_ID="..." \
  -e TG_INTERVAL=120 \
  -p 7860:7860 \
  viktorych-backup
```

---

## Free Platform Comparison

| Platform | Cost | RAM | CPU | Storage | Best For |
|---|---|---|---|---|---|
| **GitHub Actions** | $0 (Free) | 7 GB | 2 vCPU | 14 GB | Scheduled cron runs every 30m |
| **Hugging Face Spaces** | $0 (Free) | 16 GB | 2 vCPU | 50 GB | 24/7 continuous real-time backup |
| **Oracle Cloud Always Free** | $0 (Free) | 24 GB | 4 ARM | 200 GB NVMe | Ultra high-performance continuous HLS remuxing |
| **Cloudflare Workers + D1** | $0 (Free) | 128 MB | Edge | 5 GB D1 | Instant API routing, metadata lookup, and streaming |

All of these options work together synchronously, ensuring your media and comment backups are redundant, fast, and 100% cost-free.
