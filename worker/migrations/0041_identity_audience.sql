-- Added at runtime (duplicate columns would stop every later migration): ALTER TABLE account_identities ADD COLUMN audience TEXT NOT NULL DEFAULT 'public';
-- Added at runtime (duplicate columns would stop every later migration): ALTER TABLE account_identities ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS identity_list_grants (
  identity_id INTEGER NOT NULL,
  list_id TEXT NOT NULL,
  PRIMARY KEY (identity_id, list_id)
);
