# D1 backups

The account database stays on Cloudflare D1. Two restore paths sit on top of it. Neither replaces the other.

## Time Travel

D1 keeps about seven days of point-in-time history. That path is unchanged.

From `worker/`, with the same `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` the Accounts workflow already uses:

```sh
npx wrangler d1 time-travel info viktorych-accounts --remote
npx wrangler d1 time-travel restore viktorych-accounts --timestamp <unix-seconds> --remote
```

Use Time Travel when the moment you want is inside that window.

## Daily gzip in R2

The Worker cron is still `* * * * *` so TikTok checks stay every minute. At 04:17 UTC, and again at minute 17 of each later hour until today's object exists, the Worker exports D1 to the private R2 bucket `viktorych-data`.

- Object key: `backups/d1/YYYY-MM-DD.sql.gz`
- Format: gzip of SQL (`DROP TABLE`, `CREATE TABLE`, `INSERT`, indexes)
- Retention: the last 14 UTC days. Older keys are deleted.
- The file contains account rows: password hashes, sync payloads, and encrypted connected-key material. The bucket is private. Do not publish the object or paste it into an issue.

Download and restore from `worker/`:

```sh
npx wrangler r2 object get viktorych-data/backups/d1/YYYY-MM-DD.sql.gz --file /tmp/viktorych-d1.sql.gz --remote
gzip -dc /tmp/viktorych-d1.sql.gz > /tmp/viktorych-d1.sql
npx wrangler d1 execute viktorych-accounts --remote --file /tmp/viktorych-d1.sql
```

Delete `/tmp/viktorych-d1.sql` when you are done. A restore replays the SQL and replaces the tables in that file. Prefer Time Travel when it still covers the moment you need.

The export uses the D1 and R2 bindings already on the Worker. It does not add a secret.
