# TV landing and "Sign in with your phone"

## What a viewer sees on a TV

When TV mode is on (a TV browser is detected, or the link has `?tv=1`) and nobody is signed in,
the landing becomes one 10-foot screen in the X black theme:

- **Sign in with your phone** (focused first)
- Try a temporary account
- Log in
- Sign up
- The language buttons

The remote's arrows move between the buttons, OK presses one, and Back closes a dialog.
On the landing itself, Back is left to the TV, so it can leave the browser. Nothing depends on hover.

## Sign in with your phone

1. On the TV, choose **Sign in with your phone**.
   The TV asks the Worker for a code (`POST /v1/tv-pair/start`) and shows two things:
   - a QR code for `<site>#/link-tv?code=XXXXXX`;
   - the 6-character code. It uses no 0, O, 1, I or L.
2. On a phone that is already signed in, do one of these:
   - scan the QR code with the camera;
   - open **Settings → Link a TV** (also under My devices) and type the code.

   Then tap **Sign in the TV** (`POST /v1/tv-pair/approve` with the phone's session).
3. The TV checks back every 5 seconds while it is on screen (`POST /v1/tv-pair/poll`) and pauses while the page is hidden.
   When the code is approved, the TV gets **its own new session**, signs in, and shows up in My devices.

### Rules

- Codes last 5 minutes and work once.
  The record (`tv_pairs`, migration 0084) is deleted before the TV's session is created.
- The table stores only a SHA-256 of the TV's check-back secret. No session token is ever stored.
- Nothing logs a code or a secret.
- Rate limits:
  - start: 20 per IP per 10 minutes;
  - poll: 120 per secret per 10 minutes;
  - approve: 10 per account per 10 minutes.
- The phone page warns the user to link only a TV they can see. Removing the TV in My devices signs it out.

## Keep it one button away

On TVs that can't take the Android TV app (Samsung, LG, Fire TV and others), the TV home shows a dismissible card after the first open.
It explains how to bookmark the site in that TV's own browser. Android TVs keep the existing "Get the TV app" card.

Code: `tv-pair.js` / `tv-pair.css` (lazy module `tvpair`), `vendor/qrcode-1.4.4.js` (qrcode-generator, MIT, vendored, no CDN), `worker/src/tv-pair.js`, `scripts/tv_pair_test.mjs`.
