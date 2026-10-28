-- Added at runtime (duplicate columns would stop every later migration): ALTER TABLE accounts ADD COLUMN profile_tabs TEXT NOT NULL DEFAULT '';
SELECT 1;
