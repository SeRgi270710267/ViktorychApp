---
name: ship-a-pr
description: Takes a change from a topic branch to a merged, live PR on ViktorychApp. Use when the owner says ship, merge, continue the queue, or after finishing a fix or feature.
---

# Ship a PR

Follow `AGENTS.md` sections 3 to 5. Never print `GH_TOKEN` or any secret.

1. **Branch.** `git fetch origin main` then `git worktree add ../wt-<topic> -b <topic> origin/main` (or `git switch -c <topic> origin/main`). Never `git stash`; use WIP commits.
2. **Change.** Keep the PR to one feature or fix. New strings in `en`, `es`, `ru`, `hi`. New feature behind its own switch (`/add-feature-with-switch`). Do not edit `.github/`.
3. **Stamp.** Only if cached front-end files changed: set `sw.js` line 7 to `// cache-bust: <current UTC ISO time>-<label>`, later than main's (`git show origin/main:sw.js | sed -n 7p`).
4. **Check locally.**
   ```sh
   python3 scripts/check_i18n.py
   python3 scripts/assemble_site.py --selftest
   python3 scripts/handle_guard.py --selftest
   python3 scripts/secret_scan.py --staged
   python3 scripts/migration_numbers.py
   ```
   Plus the tests you touched (`python3 scripts/selftest.py`, `cd worker && npm test`, `scripts/*_test.mjs`).
5. **Scan the diff** (`git diff origin/main...`) for handles, usernames, account IDs, emails, phone numbers and tokens. Remove any you find.
6. **Push and open.** `git push -u origin <topic>`, then `gh pr create --base main --title "<user-facing summary>" --body "<what changed, how tested, switch name>"`. No PR comments.
7. **Wait for CI** without tight polling: `gh pr checks <n> --watch --interval 120`. On a failure run `/triage-failed-actions`. If the PR turns DIRTY, merge current `origin/main` into the branch (normal merge commit), resolve (`/resolve-sw-conflict` for `sw.js`, keep both sides in `i18n/*.js`), re-run the quick checks, push.
8. **Merge** only when nothing else is mid-merge, the state is `CLEAN`, and every check is success or skipped:
   ```sh
   sha=$(gh pr view <n> --json headRefOid -q .headRefOid)
   gh pr merge <n> --squash --match-head-commit "$sha"
   ```
9. **Verify live** with `/verify-live` before merging anything else.
10. **Report** to the owner in two or three plain sentences: what is live, the PR link, screenshots for UI changes (no personal data).
