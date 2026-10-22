ALTER TABLE accounts ADD COLUMN hide_avatar TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN avatar_empty TEXT NOT NULL DEFAULT 'default';
ALTER TABLE accounts ADD COLUMN banner_empty TEXT NOT NULL DEFAULT 'default';
