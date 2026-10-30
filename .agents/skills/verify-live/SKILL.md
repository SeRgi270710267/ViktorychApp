---
name: verify-live
description: Checks that the latest main commit is deployed and healthy (version.json matches main, watchdog 200, deploy runs green). Use after every merge and before the next one.
---

# Verify live

1. Main's commit: `git fetch -q origin main && git rev-parse origin/main`.
2. Deploy runs for that commit: `gh run list --branch main --limit 10 --json name,headSha,status,conclusion`. The **Accounts** and **Sync feeds** runs for that sha must be `completed/success`. Wait for them; do not merge anything meanwhile. Queued deploy runs for older main commits may be cancelled, never the newest.
3. Live version: `curl -s https://viktorychgroup.github.io/ViktorychApp/version.json` must show `"sha"` equal to main's commit. The Cloudflare Pages mirror (`https://viktorychapp.pages.dev/version.json`) should match too.
4. Worker health: `curl -s -o /dev/null -w '%{http_code}' https://viktorych-accounts.viktorych-accounts.workers.dev/v1/watchdog` must print `200`. The body lists problems only, never secrets; read it if `"ok"` is not true.
5. If the Sync feeds `verify-live` job failed: read its log (`gh run view <id> --log-failed`). A one-off flake may be re-run once (`gh run rerun <id> --failed`). A real breakage: fix forward with a tiny PR, or revert the merged PR from its page and ship the revert.
6. For UI changes, open the live site on a phone width and a desktop width and take before/after screenshots without personal data.
7. If a merge log file is in use (for example `merge-log-<date>.md` outside the repo), append the PR, the merge sha, the time with its zone, and the result of steps 2 to 4.
