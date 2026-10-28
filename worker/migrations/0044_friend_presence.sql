-- Added at runtime (duplicate columns would stop every later migration): ALTER TABLE account_presence ADD COLUMN seen_lists TEXT NOT NULL DEFAULT '';
-- Added at runtime (duplicate columns would stop every later migration): ALTER TABLE account_presence ADD COLUMN reciprocal INTEGER NOT NULL DEFAULT 1;
SELECT 1;
