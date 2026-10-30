# NZlay Forums community

The NZlay forum rendered inside the Communities tab as an X-style Community:
banner, name, member count, Top / Latest / category tabs, threads as X posts,
and a thread view with the X thread line and "Replying to". It reads live from
`nzlay.com`, and — when the user signs in on their own device — lets them post
and reply.

## What NZlay is

`nzlay.com` runs SocialEngine (en4), PHP, behind Cloudflare. It sends no CORS
headers and `cache-control: no-store`, so the browser cannot read it directly;
every read and write goes through the Worker. `?format=html` returns the
content-only fragment we parse (`format=json` returns nothing useful). There is
no RSS and no public API. `robots.txt` allows `/forums`.

| Thing | URL |
| --- | --- |
| Forum index | `/forums` |
| Category | `/forums/{id}/{slug}` (1 General, 2 News & Previews, 3 Bugs & Support, 4 Off-Topic, 6 Suggestions & Wishes, 7 Clans) |
| Topic | `/forums/topic/{id}/{slug}` (+ `?page=N`, `/view/post_id/{n}`) |
| Reply | `/forums/topic/{id}/{slug}/post-reply` (+ `?quote_id=N`) |
| New topic | `/forums/{cat}/{slug}/topic-create` |
| Login | form `user_form_login`, POST `/login` (randomized email field name, honeypot `email`, `return_url`) — no OAuth, no captcha on the login page |

ToS note: §6(d) forbids data mining/extraction, §6(g) forbids storing other
users' data, §11 needs consent to frame. The owner accepted this risk for a
read-and-post integration that stores no other users' data (short edge cache
only, no durable copy).

## Reads (Worker)

`worker/src/nzlay-forum.js` parses the HTML fragments into the canonical post
shape and serves cached public reads:

- `GET /v1/nzlay/forum` (+ `?category={id}`) — index / category listing.
- `GET /v1/nzlay/forum/topic/{id}?page=N` — one topic.

Both use `cached(key, ttl, make)` on `caches.default` with a short TTL and the
polite UA. Nothing is written to D1 or R2.

## Login + posting (local keys + relay)

NZlay has no OAuth, so login works like the local Discord keys (#447): the user
signs in on their own device, and the session cookie is **stored encrypted on
the device only** (IndexedDB `viktorych-nzlay-local`, non-extractable AES-GCM-256
device key) and **never sent to or stored on our servers**. `nzlay-keys.js`
(`window.NzlayKeys`) owns this, plus a "Use a session from your browser" paste
fallback for users who prefer to sign in on nzlay.com directly.

Because the browser cannot reach NZlay (CORS), the cookie rides on each request
to a **no-storage, no-logging relay** on the Worker:

- `POST /v1/nzlay/relay/{login|me|logout|reply|topic}`

The relay never logs passwords or cookies, and **every answer is 200 (or 4xx),
never 5xx**, so the accounts pool's failover cannot silently re-send a write and
double-post. Posting/replying happens **only on the user's own tap, one post per
tap**, with a client-side rate guard (min 30s gap, max 10/hour). If NZlay asks
for a captcha we hand the user off to nzlay.com — we never solve it. After a
reply the Worker forgets the affected thread's cache so the new post shows.

A "NZlay" entry appears on the Connected keys page (`#/settings/keys`, #448
style) to manage or disconnect the session.

## ReGone links

Each part sits behind its own switch (`nzlay_forum_regone`):

- A header row in the community: players online + a Play button (→ `#/games/regone`), and Top 100 (→ `#/games`).
- Author badges: ReGone rank or linked-player stats where that person linked themselves (gated by `canSeeGame` stats audience, `regone_leaderboard` + `regone_profile_stats`).
- Room chips in threads link to joining the room.
- The Games page links back to the community (`games.js` `forumLink()`).

## Switches (all default on)

| Flag | Covers |
| --- | --- |
| `nzlay_forum` | reads (`/v1/nzlay/forum`) |
| `nzlay_forum_post` | login + relay (`/v1/nzlay/relay`) |
| `nzlay_forum_regone` | ReGone header row, badges, room chips, Games link-back |

## Files

- Worker: `worker/src/nzlay-forum.js`, routed in `index.js`; flags in `feature-flags.js`; `game-social.js` `forumBadges` at `/v1/games/regone/forum-badges`.
- Client: `nzlay-forum.js` + `nzlay-forum.css` (community + thread + composer), `nzlay-keys.js` (local keys + relay client), wired through `communities.js`, `app.js` (keys page + SERVER_FEATURES), `games.js` (link-back), `index.html`.
- Tests: `worker/test/nzlay-forum.test.mjs` (synthetic fixtures, no real users).

## Not verified live

Posting and replying are built from the known SocialEngine login/reply form
shapes and covered by fake-fixture tests, but were **not exercised against a
real NZlay account**: signing up for or posting to NZlay is an externally
visible action that was not authorized. If the live login form differs, the
relay returns `{ok:false, result:"form_changed"}` and the UI falls back to the
paste-a-session path; the reads work regardless.
