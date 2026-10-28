-- Added at runtime (duplicate columns would stop every later migration): ALTER TABLE public_posts ADD COLUMN audience TEXT NOT NULL DEFAULT 'everyone';
-- Added at runtime (duplicate columns would stop every later migration): ALTER TABLE public_posts ADD COLUMN reply_control TEXT NOT NULL DEFAULT 'everyone';
-- Added at runtime (duplicate columns would stop every later migration): ALTER TABLE public_posts ADD COLUMN location TEXT NOT NULL DEFAULT '';
-- Added at runtime (duplicate columns would stop every later migration): ALTER TABLE public_posts ADD COLUMN poll_json TEXT NOT NULL DEFAULT '';
-- Added at runtime (duplicate columns would stop every later migration): ALTER TABLE public_posts ADD COLUMN scheduled_at INTEGER NOT NULL DEFAULT 0;
-- Added at runtime (duplicate columns would stop every later migration): ALTER TABLE public_post_media ADD COLUMN alt_text TEXT NOT NULL DEFAULT '';
-- Added at runtime (duplicate columns would stop every later migration): ALTER TABLE public_post_media ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
SELECT 1;
