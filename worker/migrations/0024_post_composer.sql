ALTER TABLE public_posts ADD COLUMN audience TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE public_posts ADD COLUMN reply_control TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE public_posts ADD COLUMN location TEXT NOT NULL DEFAULT '';
ALTER TABLE public_posts ADD COLUMN poll_json TEXT NOT NULL DEFAULT '';
ALTER TABLE public_posts ADD COLUMN scheduled_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public_post_media ADD COLUMN alt_text TEXT NOT NULL DEFAULT '';
ALTER TABLE public_post_media ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
