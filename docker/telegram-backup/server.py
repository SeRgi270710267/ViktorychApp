#!/usr/bin/env python3
"""Turnkey zero-cost background runner for Viktorych Telegram backup.

Deployable for free on:
- Hugging Face Spaces (Docker SDK, 16 GB RAM / 2 vCPU, unmetered network, 24/7 forever for $0)
- Oracle Cloud Always Free (4 ARM vCPUs / 24 GB RAM / 200 GB NVMe, 24/7 forever for $0)
- Koyeb / Render / Fly.io free tiers
- Local systemd / Docker container

Exposes a healthcheck endpoint on port 7860 (Hugging Face default) or $PORT,
and runs a continuous backup cycle at the configured interval.
"""

from __future__ import annotations

import http.server
import json
import os
import sys
import threading
import time
from pathlib import Path

# Add project root to sys.path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from scripts.telegram_backup import (  # noqa: E402
    backup,
    current_secrets,
    get_bot_tokens,
    log,
    parse_shard,
    scrub,
)

PORT = int(os.environ.get("PORT") or "7860")
INTERVAL = float(os.environ.get("TG_INTERVAL") or "120.0")
LOOP_ONLY = (os.environ.get("TG_LOOP_ONLY") or "").strip().lower() in {"1", "true", "yes"}

STATE = {
    "status": "idle",
    "last_run": 0,
    "last_duration": 0.0,
    "last_result": 0,
    "runs_total": 0,
    "errors_total": 0,
}
STATE_LOCK = threading.Lock()


def run_single_backup() -> int:
    with STATE_LOCK:
        STATE["status"] = "running"
        start = time.time()
        STATE["last_run"] = int(start)

    shard = parse_shard()
    log("[telegram-worker] starting backup pass (shard=%s, loop_only=%s)" % (shard, LOOP_ONLY))
    result = 1
    try:
        result = backup(loop_only=LOOP_ONLY, shard=shard)
    except Exception as err:
        log("[telegram-worker] cycle failed: %s" % scrub(str(err), current_secrets()))
        result = 1
    finally:
        duration = round(time.time() - start, 2)
        with STATE_LOCK:
            STATE["status"] = "idle"
            STATE["last_duration"] = duration
            STATE["last_result"] = result
            STATE["runs_total"] += 1
            if result != 0:
                STATE["errors_total"] += 1
        log("[telegram-worker] backup pass complete in %ss (code %s)" % (duration, result))
    return result


def background_worker_loop() -> None:
    tokens = get_bot_tokens()
    log("[telegram-worker] background worker started on port %s (interval=%ss, bots=%s)" % (PORT, INTERVAL, len(tokens)))
    while True:
        try:
            run_single_backup()
        except Exception as err:
            log("[telegram-worker] unexpected background error: %s" % scrub(str(err), current_secrets()))
        time.sleep(max(15.0, INTERVAL))


class HealthHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path in {"/", "/health", "/status"}:
            with STATE_LOCK:
                snapshot = dict(STATE)
            snapshot["service"] = "viktorych-telegram-backup"
            snapshot["time"] = int(time.time())
            snapshot["bots_configured"] = len(get_bot_tokens())
            snapshot["shard"] = os.environ.get("TG_SHARD") or "none"
            body = (json.dumps(snapshot, indent=2) + "\n").encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self) -> None:
        if self.path in {"/run", "/trigger"}:
            threading.Thread(target=run_single_backup, daemon=True).start()
            resp = json.dumps({"status": "triggered"}).encode("utf-8")
            self.send_response(202)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format: str, *args) -> None:
        pass


def main() -> None:
    worker_thread = threading.Thread(target=background_worker_loop, daemon=True)
    worker_thread.start()

    server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), HealthHandler)
    log("[telegram-worker] HTTP server listening on http://0.0.0.0:%s" % PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("[telegram-worker] shutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
