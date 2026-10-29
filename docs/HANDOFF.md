# ViktorychApp handoff

A takeover guide for the next assistant or coding agent. Written from the state of the project on 2026-10-28. Anything marked "unverified" was not re-checked, so check it before you rely on it.

## 0. Running with nobody

If no assistant is working on the project, read `docs/RUNNING-WITHOUT-BOT.md`. The Worker watchdog (`worker/src/watchdog.js`) keeps workflows on, re-runs a stuck deploy and reports health.

## 1. What the project is

ViktorychApp is an X.com-clone PWA. The front end is static and served from GitHub Pages. The back end is a Cloudflare Worker with D1 (SQL) and R2 (object storage). Coding agents open PRs, and the owner's assistant reviews and merges them.

## 2. Standing rules from the owner

- Spend as little agent and assistant usage as possible. No cloud agent runs unless the owner asks. Do not poll.
- The UI must match X.com closely, including on mobile.
- Free services only.
- Never put handles, usernames or account IDs in the public repo. Never print secrets. Secret names are fine.
- Media keeps its original quality and is never re-encoded.
- Ask the owner before any history rewrite or force-push.
- Every new UI string goes in every locale.
- Bump the service worker cache stamp in `sw.js` (and the copies in `update.js` and the tests) above main's current stamp.
- D1 migration numbers must be unique.
- Tabs and pills are thin. Long text scrolls slowly (marquee). Names have no length limits. Pills never grow.
- iOS must work flawlessly, including iPhone 11 and older Safari.

## 3. Merge procedure

1. Squash-merge only when the PR is `clean` and every check is `success` or `skipped` (handle guard, migration numbers, smoke, nav, selftests; a typical green run is 10 success and 6 skipped).
2. Merge with the exact head sha (`gh pr merge --squash --match-head-commit <sha>`).
3. One PR at a time. Each merge moves main's stamp, so merge main into the next branch with a normal merge commit, bump the stamp, and wait for green.
4. A token without the `workflow` scope cannot push a commit that creates a new version of a file under `.github/workflows/`. It also cannot re-run Actions. Push an empty commit to re-trigger checks.

## 4. State on 2026-10-28

Merged today: #265 (online in the menu), #267 (requests tab), #268 (affiliation badges), #271 (community posts on Home), #272 (Explore on mobile), #273 (public landing page), #266 (merit badges in About me), #275 (this handoff), #276 (community posts and replies on Home as normal post cards).

Still open:
- #269 (composer collapse on scroll): overlaps #264, which already shipped a different composer collapse. It still adds a collapse-on-scroll setting and a "draft stays on this device" note. The owner decides whether to rebuild it on top of #264 or close it.
- #274 (status emoji store): conflicts with the presence privacy rework now on main (seen lists, reciprocal last seen, a different privacy list). It needs a careful rebuild on main.
- #145 (Worker cron backup) is excluded from automated work.

Queued work, in order:
1. (In progress after #276.) The owner's own new post must show at the top of Home (For you and Following) and on their profile, survive a refresh, and the "Your post was sent" toast gets a View link. Cover replies and quotes too.
2. Desktop right rail: `position: sticky`, with `top = viewport height − rail height` when the rail is taller than the viewport, otherwise `top: 0`. No blank space below it.
3. Several usernames per account. Each is unique and reserved. One is primary. All are listed in About me and all resolve to the same profile. A cap, a change rate limit and release rules apply.
4. Replace the floating "new posts" pill with an inline "Show N posts" row with avatars at the top of Home. Clicking it inserts the posts in place and does not scroll.

## 5. Owner setup still needed

- Telegram stories secrets: `TG_API_ID`, `TG_API_HASH`, `TG_STORIES_SESSION` (see `docs/telegram-stories.md`).
- Optional TURN secrets for Go live: `LIVE_TURN_URLS`, `LIVE_TURN_USERNAME`, `LIVE_TURN_CREDENTIAL` (see `docs/live-p2p.md`).
- Real-iPhone testing (see `docs/ios-support.md`).
- Instagram/Threads optional secret names are in `docs/instagram-threads.md` (`IG_SESSION` is for stories only).
- Optional: Turnstile, VAPID keys, uptime monitoring.
- The owner tests the password-manager prompt and Notifications on a phone.
- Cleanup and account deletion only with an explicit owner go-ahead and a full backup.

## 6. Gotchas

- `scripts/handle_guard.py` rejects any token from the private owner catalog, including product and assistant names used as handles. Keep docs neutral.
- The Home button once vanished on mobile because a saved layout hid it. Home is now locked, and a saved bar keeps items added later hidden until the user turns them on.
- Some Playwright checks ride along inside other test scripts (for example `home_reach_test.mjs` runs `explore_nav_test.mjs`, and `compose_page_test.mjs` runs `community_home_test.mjs`), because the workflow files could not be edited.
- An overnight routine named "Overnight ship check" merges green, clean PRs, oldest first. Check what it has merged before you act.
