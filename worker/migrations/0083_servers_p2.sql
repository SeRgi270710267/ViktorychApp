-- Native servers phase 2: threads and forums, events with RSVP, polls, stickers.
-- Same statements as the phase 2 part of SERVERS_SCHEMA in servers.js.
CREATE TABLE IF NOT EXISTS srv_threads (id TEXT PRIMARY KEY, server_id TEXT NOT NULL, parent_id TEXT NOT NULL, root_id TEXT NOT NULL DEFAULT '', starter_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, owner_id TEXT NOT NULL, owner_mid TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0, tags TEXT NOT NULL DEFAULT '', message_count INTEGER NOT NULL DEFAULT 0, last_message_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS srv_threads_parent ON srv_threads(parent_id, archived, last_message_id);
CREATE INDEX IF NOT EXISTS srv_threads_root ON srv_threads(root_id);
CREATE INDEX IF NOT EXISTS srv_threads_server ON srv_threads(server_id);
CREATE TABLE IF NOT EXISTS srv_forum_tags (id TEXT PRIMARY KEY, server_id TEXT NOT NULL, channel_id TEXT NOT NULL, name TEXT NOT NULL, emoji TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS srv_forum_tags_server ON srv_forum_tags(server_id, channel_id);
CREATE TABLE IF NOT EXISTS srv_events (id TEXT PRIMARY KEY, server_id TEXT NOT NULL, channel_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', start_at INTEGER NOT NULL, end_at INTEGER NOT NULL DEFAULT 0, image_key TEXT NOT NULL DEFAULT '', creator_id TEXT NOT NULL, creator_mid TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled', going INTEGER NOT NULL DEFAULT 0, interested INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS srv_events_server ON srv_events(server_id, start_at);
CREATE TABLE IF NOT EXISTS srv_event_rsvps (event_id TEXT NOT NULL, server_id TEXT NOT NULL, account_id TEXT NOT NULL, mid TEXT NOT NULL, status TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (event_id, account_id));
CREATE INDEX IF NOT EXISTS srv_event_rsvps_account ON srv_event_rsvps(account_id);
CREATE TABLE IF NOT EXISTS srv_polls (message_id TEXT PRIMARY KEY, server_id TEXT NOT NULL, channel_id TEXT NOT NULL, question TEXT NOT NULL, options TEXT NOT NULL, multi INTEGER NOT NULL DEFAULT 0, ends_at INTEGER NOT NULL, ended INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS srv_polls_server ON srv_polls(server_id);
CREATE TABLE IF NOT EXISTS srv_poll_votes (message_id TEXT NOT NULL, account_id TEXT NOT NULL, mid TEXT NOT NULL, option INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (message_id, account_id, option));
CREATE INDEX IF NOT EXISTS srv_poll_votes_account ON srv_poll_votes(account_id);
CREATE TABLE IF NOT EXISTS srv_stickers (id TEXT PRIMARY KEY, server_id TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL, type TEXT NOT NULL DEFAULT '', by_mid TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS srv_stickers_server ON srv_stickers(server_id);
CREATE TABLE IF NOT EXISTS srv_msg_stickers (message_id TEXT PRIMARY KEY, server_id TEXT NOT NULL, sticker_id TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS srv_msg_stickers_server ON srv_msg_stickers(server_id);
-- Everyone can start threads by default, like Discord.
UPDATE srv_roles SET perms = perms | 16384 WHERE id = server_id;
