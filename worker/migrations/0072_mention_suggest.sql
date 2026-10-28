-- Prefix search for @mention autocomplete walks these instead of scanning accounts.
CREATE INDEX IF NOT EXISTS accounts_handle_lower ON accounts(lower(handle));
CREATE INDEX IF NOT EXISTS accounts_name_lower ON accounts(lower(display_name));
