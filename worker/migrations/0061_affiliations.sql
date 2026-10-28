CREATE TABLE IF NOT EXISTS affiliations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo TEXT NOT NULL,
  profile_ref TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS affiliation_grants (
  affiliation_id TEXT NOT NULL,
  public_id TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  audience TEXT NOT NULL DEFAULT 'public',
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (affiliation_id, public_id)
);

CREATE INDEX IF NOT EXISTS affiliation_grants_account ON affiliation_grants(public_id);

INSERT INTO affiliations (id, name, logo, profile_ref)
VALUES ('viktorych', 'Viktorych', 'logo/affiliation-viktorych.svg', 'owner')
ON CONFLICT(id) DO NOTHING;
