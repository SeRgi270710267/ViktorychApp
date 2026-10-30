-- Featured communities on the Explore row: the owner's pinned order.
-- Names and positions only. The Worker also creates this table on first use.
CREATE TABLE IF NOT EXISTS community_featured (
  name TEXT PRIMARY KEY,
  pos INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
