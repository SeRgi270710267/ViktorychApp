CREATE TABLE IF NOT EXISTS account_friend_requests (
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (sender_id, receiver_id)
);
CREATE INDEX IF NOT EXISTS account_friend_requests_recv ON account_friend_requests(receiver_id, created_at DESC);

CREATE TABLE IF NOT EXISTS account_friends (
  user_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS account_friends_user ON account_friends(user_id, created_at DESC);
