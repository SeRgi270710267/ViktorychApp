---
name: resolve-sw-conflict
description: Resolves a merge conflict in sw.js (and the i18n packs) the ViktorychApp way. Use when a PR is DIRTY because of sw.js, the cache-bust stamp, or i18n files.
---

# Resolve an sw.js conflict

Rule: take main's copy, re-apply only this PR's own lines, bump the stamp above main's.

1. Note the branch head first: `git rev-parse HEAD` (needed if a lease push is ever required).
2. Save what this PR itself changed in `sw.js`, before merging:
   ```sh
   git fetch origin main
   git diff "$(git merge-base HEAD origin/main)" HEAD -- sw.js > /tmp/pr-sw.diff
   ```
3. `git merge origin/main` (normal merge commit; never merge an old main). For the conflicted `sw.js`, start from main's file with `git checkout origin/main -- sw.js`, then re-apply only the PR's own non-stamp lines from `/tmp/pr-sw.diff` (for example a new file in the precache list).
4. Set line 7 to exactly one stamp: `// cache-bust: <current UTC ISO time>-<pr label>`. It must sort above `git show origin/main:sw.js | sed -n 7p`. If `update.js` or a test holds a copy of the stamp, update it to match.
5. For `i18n/*.js` and `scripts/i18n_allow.txt`: keep both sides, main's entries first then the PR's, and fix the comma between them. No duplicate keys.
6. Run `python3 scripts/check_i18n.py`, `python3 scripts/assemble_site.py --selftest`, `python3 scripts/handle_guard.py --selftest`, and `node scripts/sw_update_test.mjs` if Playwright is set up.
7. `git commit` (the merge commit) and `git push`. If the push is rejected, someone pushed: fetch, merge again, retry. Never force-push without asking; `--force-with-lease=refs/heads/<branch>:<noted sha>` only on your own branch.
