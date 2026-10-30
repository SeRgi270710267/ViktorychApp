-- Store: gifts and sticker packs paid with money or with earned Viktorychs.
-- The Worker also creates these on demand (ensureSchema).
CREATE TABLE IF NOT EXISTS point_engagers (
  post_key TEXT NOT NULL,
  engager_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_key, engager_id)
);
CREATE TABLE IF NOT EXISTS point_guard (
  kind TEXT NOT NULL,
  ok INTEGER NOT NULL,
  CONSTRAINT balance CHECK (kind <> 'balance' OR ok = 1),
  CONSTRAINT edition CHECK (kind <> 'edition' OR ok = 1)
);
CREATE INDEX IF NOT EXISTS point_engagers_pair ON point_engagers(author_id, engager_id, created_at);
CREATE TABLE IF NOT EXISTS store_orders (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  method TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  provider_ref TEXT NOT NULL DEFAULT '',
  payment_ref TEXT NOT NULL DEFAULT '',
  edition INTEGER NOT NULL DEFAULT 0,
  gift_send_id TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  privacy TEXT NOT NULL DEFAULT 'public',
  created_at INTEGER NOT NULL,
  paid_at INTEGER NOT NULL DEFAULT 0,
  refunded_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS store_orders_buyer ON store_orders(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS store_orders_send ON store_orders(gift_send_id);
CREATE TABLE IF NOT EXISTS store_entitlements (
  owner_id TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, pack_id)
);
CREATE TABLE IF NOT EXISTS store_editions (
  item_id TEXT PRIMARY KEY,
  sold INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS gift_opens (
  send_id TEXT PRIMARY KEY,
  opened_at INTEGER NOT NULL
);
