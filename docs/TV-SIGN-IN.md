# TV landing and "Sign in with your phone"

## The short address

Everything people see or share uses **viktorychapp.pages.dev** (one constant, `SHORT_ORIGIN` in `shared/short-link.js`).
The GitHub Pages address keeps working; the short one is added on top.

| Short path | Goes to | How |
| --- | --- | --- |
| `/tv`, `/tv/` | the TV page (and a "Sign in a TV" code box on phones) | real folder `tv/` |
| `/p/CODE` (also `/pair/CODE`, `/tv?c=CODE`) | the phone's "Sign in on your TV?" screen for that code | `_redirects` → `/?pair=CODE` → `#/link-tv?code=CODE` |
| `/join` | sign-up | `_redirects` → `/?join=1` |
| `/go` | home | `_redirects` → `/` |

`_redirects` ships through `scripts/assemble_site.py` (REQUIRED_EXTRAS) and `scripts/cf_pages_prepare.py` (PROTECTED),
and `wrangler pages deploy` applies it. GitHub Pages ignores `_redirects`, so `404.html` maps the same paths there.
Share links (`sitePermalink`, profile share meta) use `ViktorychShort.shareBase()`: the short address on both live hosts, the current folder anywhere else.

## What a viewer sees on a TV

When TV mode is on (a TV browser is detected, or the link has `?tv=1`) and nobody is signed in,
**Sign in with your phone** opens by itself (once per page load). Closing it shows the 10-foot landing:
Sign in with your phone, Try a temporary account, Log in, Sign up, and the language buttons.
The Android TV app (`?src=tvapp`) lands straight on the same screen.

## Sign in with your phone (device-code style)

1. The TV asks the Worker for a code (`POST /v1/tv-pair/start`) and shows:
   - a big QR code for `https://viktorychapp.pages.dev/p/CODE`;
   - "Or go to **viktorychapp.pages.dev/tv** on your phone and enter this code", and the 6-character code (no 0, O, 1, I or L);
   - "Waiting for your phone…" and a countdown.
2. The phone opens `/p/CODE`:
   - **signed in:** "Sign in on your TV?" with the code and the account name, one tap on **Sign in on TV** (`POST /v1/tv-pair/approve`);
   - **signed out:** "Sign in on your TV" with Log in / Create account. After sign-in or sign-up the phone comes back to the code and approves it by itself (no second tap). The code waits in `sessionStorage` for up to ten minutes and is removed once used.
   - signed in at the other address? A link continues there with the same code (only the code crosses; never a session).
   - typing: `viktorychapp.pages.dev/tv` → enter the code, or Settings → Link a TV.
3. The TV checks back every 4 seconds while it is on screen (`POST /v1/tv-pair/poll`), less often while hidden, and backs off on 429.
   When approved it shows "Signed in as NAME", gets **its own new session** from the Worker, and opens the timeline.
4. A code that runs out is replaced by a new one by itself (up to 3 times, about 40 minutes on screen), then the TV shows
   "This code expired" with **Get a new code** focused for the remote.

### Rules

- Codes last 10 minutes and work once. The record (`tv_pairs`, migration 0084) is deleted before the TV's session is created.
- The table stores only a SHA-256 of the TV's check-back secret. No session token is ever stored, put in a link, or logged.
- Rate limits: start 20 per IP, poll 200 per secret, approve 10 per account, each per 10 minutes.
- The phone page warns the user to link only a TV they can see. Removing the TV in My devices signs it out.

## Sign in with an account on another device

For when there is no phone camera handy. The code screen has **Sign in with an account on another device**.

1. The TV shows a username box and an on-screen keyboard made for the remote (arrows and OK; Back, Clear and **Send request**). A real keyboard works too.
2. The TV sends `POST /v1/tv-pair/ask` with its check-back secret and the username. The reply is **always the same**, whether the account exists or not.
   The TV always says "If that account exists, check your other devices" and keeps checking back as before.
3. After the reply, the Worker looks the name up. If the account exists, it gets an **Approve sign-in on TV?** notification (kind `tv_signin`):
   in the in-app list on every signed-in device, plus a push if push is on (the push text never names anyone).
   The notification shows the TV's code, a warning to approve only a TV in front of you, and **Approve** / **Deny**.
4. **Approve** uses the normal `POST /v1/tv-pair/approve`, so the TV finishes signing in as usual.
   **Deny** (`POST /v1/tv-pair/deny`, only the account that was asked) stops the code; the TV shows "Sign-in was denied" and offers a new code.
5. The request lives in `tv_pair_asks` (migration 0085) and ends with the code: it expires at the same time and is deleted when the code is used, denied or expired.
   The buttons in the notification disappear after the code expires or after an answer.

Limits: 3 asks per TV code, 3 per username and 10 per IP, each per 10 minutes. Asking another username replaces the earlier request.
Security note: an approval prompt can be abused by someone who wants a person to approve their TV. That's why the prompt shows the code
and the warning, Deny is one tap, and the limits above apply. The code is stored in the notification so it can be compared.

## Entering the code on a computer

Settings → Link a TV and `viktorychapp.pages.dev/tv` take the code at desktop size: a big box, paste works (spaces and dashes are dropped),
and it is sent by itself as soon as all 6 characters are in.

## Keep it one button away

On TVs that can't take the Android TV app (Samsung, LG, Fire TV and others), the TV home shows a dismissible card after the first open.
It explains how to bookmark the site in that TV's own browser. Android TVs keep the existing "Get the TV app" card.

Code: `shared/short-link.js`, `_redirects`, `404.html`, `tv-pair.js` / `tv-pair.css` (lazy module `tvpair`), `vendor/qrcode-1.4.4.js`
(qrcode-generator, MIT, vendored, no CDN), `worker/src/tv-pair.js`.
Tests: `scripts/tv_pair_test.mjs` (Worker), `scripts/tv_short_pair_test.mjs` (short links, TV ↔ phone in a browser, expiry and renewal, the remote keyboard ask flow, desktop paste; run by `selftest.py`),
`scripts/signup_flow_test.mjs` (real Worker: ask, Approve/Deny from the notification, desktop Link a TV and `/tv` paste).
