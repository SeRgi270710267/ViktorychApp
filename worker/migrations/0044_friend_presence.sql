ALTER TABLE account_presence ADD COLUMN seen_lists TEXT NOT NULL DEFAULT '';
ALTER TABLE account_presence ADD COLUMN reciprocal INTEGER NOT NULL DEFAULT 1;
