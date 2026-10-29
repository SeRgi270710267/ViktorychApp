# Source lists

Extra sources that only some accounts see. The owner keeps named lists, adds
sources to them, and assigns them to accounts. The owner's own timeline, the
global feed (`feeds.json`) and every other account stay unchanged and never
download them.

## Where things live

| What | Where | Public? |
| --- | --- | --- |
| Lists, sources, assigned accounts, requests | R2 `owner/source-lists.json` (Worker only) | No |
| What to fetch (sources of lists with an active member, no account ids) | R2 `owner/lists/wanted.json` | No |
| Shard health and current hashes | R2 `owner/lists/index.json` | No |
| Posts per list | R2 `lists/shards/<sha256>.json`, served by the Worker to members only | No |

Nothing about lists is written to the repo, Pages, `feeds.json` or logs.
Handles are masked in Actions logs and the sync prints counts only.

## Flow

1. Owner opens **Feeds → Source lists** (`#/feeds/lists`): create a list, paste
   a link or @handle to add a source, type an @username to assign it.
2. Assigning (or approving a request) rewrites `wanted.json` and dispatches
   `sync.yml`. A cron at minute 7 also drops members inactive for 30 days.
3. `scripts/update_feeds.py` calls `source_lists.run_lists` after the main
   feed. Each source is fetched once even when it is in several lists, with the
   same adapters as the main feed, so quoted and reposted items stay embedded in
   their post and the quoted account never becomes a source.
4. Each list becomes a content-addressed shard (canonical JSON, sha256 name).
   Unchanged lists write nothing.
5. `source-lists.js` on a member's device asks `GET /v1/me/source-lists` at
   most every 30 minutes (every 6 hours with no lists; no D1 write), pulls new
   hashes from peers via `ViktorychPool.getBlob` when available, else from
   `GET /v1/me/source-lists/shard/<hash>`, checks the sha256, keeps a local
   copy, and merges the posts into the timeline. Worker copies are offered back
   to the pool with `putBlob`.

Members see their lists under **Feeds → Your extra sources** and can request
an account; the owner approves it into an existing list or a new one for that
person. Anyone can still mute or hide accounts from list posts.

## Limits

40 lists, 60 unique sources, 40 sources per list, 8 posts per source, 240
posts per shard, 90 seconds per sync run. TikTok sources are not accepted.

## Tests

`python3 scripts/source_lists.py --selftest`,
`worker/test/source-lists.test.mjs`, `scripts/source_lists_client_test.mjs`.
