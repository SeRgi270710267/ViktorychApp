-- Play time, streaks and friend boards for games.
CREATE TABLE IF NOT EXISTS game_stats (
  public_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  total_ms INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  streak_day TEXT NOT NULL DEFAULT '',
  beat_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (public_id, game_id)
);
CREATE TABLE IF NOT EXISTS game_days (
  public_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  day TEXT NOT NULL,
  ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (public_id, game_id, day)
);
CREATE INDEX IF NOT EXISTS game_days_day ON game_days(day);
