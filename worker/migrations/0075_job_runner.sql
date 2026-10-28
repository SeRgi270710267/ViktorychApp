-- The Render backup claims background cron jobs here while it is awake.
CREATE TABLE IF NOT EXISTS job_runner (
  id TEXT PRIMARY KEY,
  jobs TEXT NOT NULL DEFAULT '',
  seen_at INTEGER NOT NULL DEFAULT 0
);
