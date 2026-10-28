CREATE TABLE IF NOT EXISTS point_ledger (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS point_ledger_account ON point_ledger(public_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS point_ledger_once ON point_ledger(public_id, reason, ref);

CREATE TABLE IF NOT EXISTS point_balances (
  public_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS point_daily (
  public_id TEXT NOT NULL,
  day TEXT NOT NULL,
  action TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (public_id, day, action)
);

CREATE TABLE IF NOT EXISTS point_streaks (
  public_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  last_day TEXT NOT NULL,
  streak INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (public_id, kind)
);

CREATE TABLE IF NOT EXISTS point_invites (
  code TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  redeemed_by TEXT NOT NULL DEFAULT '',
  redeemed_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gift_sends (
  id TEXT PRIMARY KEY,
  gift_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  privacy TEXT NOT NULL DEFAULT 'public',
  hidden INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS gift_sends_recipient ON gift_sends(recipient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gift_prefs (
  public_id TEXT PRIMARY KEY,
  hide_tab INTEGER NOT NULL DEFAULT 0,
  who TEXT NOT NULL DEFAULT 'everyone',
  updated_at INTEGER NOT NULL
);
