-- Account deletion jobs, the public hash list, handle holds, and fresh re-auth.
-- The job may keep the account id only until every step finishes.
-- account_deletions stores a salted hash and nothing else that identifies the person.

CREATE TABLE IF NOT EXISTS account_deletion_jobs (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL DEFAULT '',
  user_hash TEXT NOT NULL,
  handle TEXT NOT NULL DEFAULT '',
  skeleton TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  steps TEXT NOT NULL,
  resume_hash TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_jobs_user ON account_deletion_jobs(public_id) WHERE public_id != '';
CREATE INDEX IF NOT EXISTS account_deletion_jobs_status ON account_deletion_jobs(status, updated_at);

CREATE TABLE IF NOT EXISTS account_deletions (
  user_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS handle_holds (
  skeleton TEXT PRIMARY KEY,
  held_until INTEGER NOT NULL,
  user_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_reauths (
  token_hash TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS account_reauths_account ON account_reauths(public_id, expires_at);
