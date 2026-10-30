-- ReGone social: live invites, party lobbies, self-reported rooms,
-- game achievements, play-together history, game privacy and the
-- NZlay Top 100 snapshot. The Worker also creates these on demand.
CREATE TABLE IF NOT EXISTS game_invites (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  room TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  lobby_id TEXT NOT NULL DEFAULT '',
  private INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  answered_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS game_invites_to ON game_invites(to_id, expires_at);
CREATE INDEX IF NOT EXISTS game_invites_from ON game_invites(from_id, created_at);
CREATE TABLE IF NOT EXISTS game_lobbies (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  room TEXT NOT NULL DEFAULT '',
  private INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  launched_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS game_lobbies_host ON game_lobbies(host_id);
CREATE INDEX IF NOT EXISTS game_lobbies_expires ON game_lobbies(expires_at);
CREATE TABLE IF NOT EXISTS game_lobby_members (
  lobby_id TEXT NOT NULL,
  public_id TEXT NOT NULL,
  ready INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (lobby_id, public_id)
);
CREATE TABLE IF NOT EXISTS game_rooms (
  public_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  room TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS game_achievements (
  public_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  ach_id TEXT NOT NULL,
  earned_at INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (public_id, game_id, ach_id)
);
CREATE TABLE IF NOT EXISTS game_prefs (
  public_id TEXT PRIMARY KEY,
  aud_together TEXT NOT NULL DEFAULT 'only',
  aud_room TEXT NOT NULL DEFAULT 'friends',
  aud_stats TEXT NOT NULL DEFAULT 'public',
  streak_reminder INTEGER NOT NULL DEFAULT 0,
  tz_min INTEGER NOT NULL DEFAULT 0,
  quiet_on INTEGER NOT NULL DEFAULT 0,
  quiet_from INTEGER NOT NULL DEFAULT 22,
  quiet_to INTEGER NOT NULL DEFAULT 7,
  linked_name TEXT NOT NULL DEFAULT '',
  weekend_sat TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS game_together (
  a_id TEXT NOT NULL,
  b_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  times INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (a_id, b_id, game_id)
);
CREATE INDEX IF NOT EXISTS game_together_b ON game_together(b_id);
CREATE TABLE IF NOT EXISTS game_board_snap (
  public_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  rank INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  best_rank INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (public_id, game_id)
);
