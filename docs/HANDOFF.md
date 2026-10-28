# ViktorychApp handoff

A takeover guide for another Cursor agent or redacted_handle Bot. It is written from the state of the project on 2026-10-28. Anything marked "unverified" was not re-checked when this was written, so check it before you rely on it.

## 1. What the project is

ViktorychApp is an X.com-clone PWA. The front end is static and served from GitHub Pages. The back end is a Cloudflare Worker with D1 (SQL) and R2 (object storage). It is built through Cursor cloud agents. The owner's assistant (redacted_handle Bot) reviews and merges their PRs.

## 2. Standing rules from the owner

- Do not waste Cursor usage. Use few, focused agent runs. Reuse an agent by replying to it. Do not poll. Unwatch agents that are finished.
- The UI must match X.com closely, including on mobile.
- Free services only.
- Never put handles, usernames or account IDs in the public repo. Never print secrets. Secret names are fine.
- Media keeps its original quality and is never re-encoded.
- Ask the owner before any history rewrite or force-push.
- Every new UI string goes in every locale.
- Bump the service worker cache stamp in `sw.js` above main's current stamp.
- D1 migration numbers must be unique.
- Tabs and pills are thin. Long text scrolls slowly (marquee). Names have no length limits. Pills never grow.
- iOS must work flawlessly, including iPhone 11 and older Safari.

## 3. Merge procedure

1. Squash-merge only when `mergeable_state` is `clean` and every check run is `success` or `skipped`. The checks are the handle guard, migration numbers, smoke, nav and selftests. A typical green run is 10 success and 6 skipped.
2. Merge with the exact head sha, so a late push cannot slip in.
3. Merge one PR at a time.
4. Every merge moves main's cache stamp, so the other open branches then conflict. After each merge, ask the owning agent to merge main into its branch. Use a normal merge commit, no force-push, and a stamp above main's. The agent reports when it is green and clean. The agent must not merge itself.
5. PRs that change how the app looks get screenshots shown to the owner for approval before merging.

## 4. Agents

Use the full ids when replying.

| Agent id | Scope |
|---|---|
| `bc-a655ebce-4552-5ce1-8aee-aff2acd29026` | UI agent. Branch `cursor/profile-tab-order-9026`. PR #258 (profile tab reorder). Its smoke check was failing at the last check. |
| `bc-87efa295-b474-52a1-99cd-82edcaae65dc` | Composer collapse, install-app prompt, landing page, merit badges in About me, affiliation badges, then the opt-in P2P media and "My devices" layer. |
| `bc-470b834c-3aef-573b-8ed2-c452bcda09ac` | Instagram/Threads ingest fix (PR #270, awaiting green nav and smoke). Then communities unified with the home feed. Then the feed performance audit (`docs/performance.md`). |

`bc-45c3b1b2` and `bc-80742954` are done. Their PRs are merged and they are unwatched.

## 5. Queue per agent, in order

### bc-a655ebce (UI agent)

1. Fix the failing smoke check on #258.
2. Urgent: the Explore label and icon are missing on mobile. Explore is present by default but customizable. Only Home is locked. Add a nav test.
3. The mobile top area (pills, tabs, stories) hides on scroll down. Settings choose what hides: the row, the stories, or all. Stories can also be disabled fully so they stop loading, to save data.
4. Pill text must fit inside the pills without making them bigger, and scroll slowly if long. The Notes bubble sits in front of the story circle, semi-transparent and readable.
5. Sidebar customizer. List all desktop sidebar items. Allow reorder, hide, and folders (name and emoji). Allow moving items into the profile popup as text rows.
6. A "Solicitudes" tab that merges follow requests and friend requests, with sub-tabs.
7. Emoji status badge on the avatar, replacing the status text and presence dots. Status emojis are giftable and buyable in ViktorychStore. The store UI gets a much better redesign. Friends presence: online, away and offline with last seen, privacy controls and an invisible mode. A friends panel in the desktop right rail. On mobile the entry is in the side menu.
8. Per-item privacy for linked profiles.
9. A locked section in the profile Following tab for private or locked follows. It is hidden until the user unlocks it.

### bc-87efa295

Order: composer collapse (less space, audience button on the same row as Post), install-app prompt after sign-up, landing page before sign-up (real screenshots, Sign up and Log in buttons), merit badges inside About me (not next to the name), affiliation badges (owner-only grant, starting with a white Viktorych logo square), then the opt-in P2P media layer with "My devices" mode (pairing by QR or code). P2P is off by default and for public posts only.

### bc-470b834c

Order: PR #270 (Instagram/Threads ingest fix, awaiting green nav and smoke), then communities unified with the home feed, then the feed performance audit and caching fixes (`docs/performance.md`).

## 6. Already merged (from the working journal)

- #242 to #255 and #257.
- #253 iOS audit.
- #259 one desktop sidebar.
- #250 Personal details.
- #251 Gifts.
- #248 stories, Notes, folders, highlights, lists.
- #255 compact stories row.

## 7. Owner setup still needed

- Telegram stories secrets: `TG_API_ID`, `TG_API_HASH`, `TG_STORIES_SESSION` (see `docs/telegram-stories.md`).
- Optional TURN secrets for Go live: `LIVE_TURN_URLS`, `LIVE_TURN_USERNAME`, `LIVE_TURN_CREDENTIAL` (see `docs/live-p2p.md`).
- Real-iPhone testing (see `docs/ios-support.md`).
- Instagram/Threads optional secret names are in `docs/instagram-threads.md` (`IG_SESSION` is for stories only).
- Optional: Turnstile, VAPID keys, uptime monitoring.
- The owner tests the password-manager prompt and Notifications on a phone.
- Old PR #145 (Worker cron backup) is excluded from automated work.
- Cleanup phase 2 only with an explicit owner go-ahead and a full backup.

## 8. The owner's final instruction

These are the owner's last requests. Finish everything, send one summary, and spend nothing more. When all PRs are merged, unwatch or cancel the agents.

## 9. Gotchas

- Check results can arrive as scratch JSON files. Parse them with `json.JSONDecoder().raw_decode(t[t.find('{'):])`.
- An agent `reply` needs the full agent id and `confirm: true`.
- The Home button once vanished on mobile because a saved layout hid it. Home is now locked.
- An overnight routine named "Overnight ship check" merges green, clean PRs, oldest first. Check what it has merged before you act.
