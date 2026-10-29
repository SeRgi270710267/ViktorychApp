# Low-usage playbook for takeover bots

For AI assistants continuing this project. Goal: do as much as possible while keeping usage (compute, CI minutes, requests, chat) extremely low.

## 1. Principles
- Work on one persistent machine with git, `gh` and plain scripts.
- No cloud coding agents. No screenshots or browser unless truly needed.
- No polling loops: background long commands and wait for completion notices.
- Read only the files you need (`rg`, targeted line ranges), never whole-file dumps.
- Keep chat replies short.

## 2. Shipping flow
- One branch + one PR per feature; small, focused diffs.
- Use a ship script that: waits for CI; on conflict merges `main` with a normal merge commit (never force-push); reruns only failed jobs once with `gh run rerun --failed` (never empty commits); merges when green.
- Don't bump the service-worker stamp unless needed. Deploy already versions it, and shared-file bumps cause conflicts across every open PR.

## 3. CI economy
- Concurrency groups with `cancel-in-progress` on PRs.
- Path filters so unrelated jobs skip.
- Cache dependencies and Playwright browsers.
- Timeouts on every job.
- When runners are jammed, cancel queued/running PR runs whose commit is no longer the PR head: compare `gh run list --status queued --json databaseId,headSha` with `gh pr list --json headRefOid`, then `gh run cancel <id>`. The token needs Actions: read/write.
- Required checks via a branch ruleset; auto-merge on.

## 4. Parallel work without waste
- Many background workers are fine, but each owns one workstream and one PR.
- Reuse/resume the same worker for follow-ups instead of starting new ones.
- If a worker is interrupted, resume it with "check git state and continue" rather than redoing from scratch.
- Route cross-cutting notes (e.g. a hook one PR exposes for another) as short messages to the relevant worker.

## 5. Runtime and data economy (keeps hosting free)
- Stream more, store less. Hotlink media; never re-encode.
- Deploy data as a Pages artifact instead of committing it.
- Do work on-device (filtering, merging, taming busy accounts) with only a light server trim.
- Skip fetching platforms nobody follows.
- Cache at the edge.
- Fallbacks (backup server, P2P/mesh) stay idle unless faster or everything else is down.
- Keep-warm pings only from the Worker cron, with quiet hours.

## 6. Free services policy
- Add free services alongside existing ones as backups; never replace what works.
- No new hosts without the owner's OK.

## 7. Saving Cursor usage
- Do routine work (merges, conflicts, CI reruns, small edits) on the persistent machine with `gh`, not Cursor cloud agents.
- No Cursor review/Bugbot on every push; the `smoke` and `guard` checks cover it.
- Batch asks instead of sending many small ones.
- When Cursor is truly needed: one narrow task with exact files and done criteria, default model, no Max mode.
- Stop looping runs. One agent per PR; never two on one branch.

## 8. Owner-only steps
- Secrets live only in GitHub/Worker secrets, added by the owner from exact steps.
- Workflow-file changes go to the owner as a ready patch, or via a temporary Workflows: write token permission that goes back to read-only afterwards.
- Never put passwords or tokens in chat.

## 9. Checklist before ending a turn
- PR link shared.
- Nothing left running needlessly.
- Temporary private data deleted.
