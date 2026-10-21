# VK spare account for stories

The sync signs in to the spare VK account by itself and reads the stories that account can already see. It is read-only. Leave the secrets unset and VK stories stay off.

VK's long-lived `login.vk.com` cookies often stay valid for about a year. `remixsid` is reset when the IP changes, which happens on GitHub-hosted runners. The sync follows VK's own restore redirects so a fresh `remixsid` is issued, and it keeps the latest cookie jar encrypted in the Actions cache. The next run reuses that jar and signs in again only when the session is dead. GitHub Actions cannot update secrets without a personal access token, so the refreshed cookies are not written back into `VK_SESSION`. They stay in the cache, ciphertext only, and they are not committed.

The cache key is `VK_SESSION_KEY` when that secret is set. Otherwise it is derived from `VK_PASSWORD`. The file is `.vk-session/cookies.enc` in the Actions cache named `vk-web-session-`.

## Owner steps

1. On the spare account, turn on 2FA with an authenticator app and copy the setup key. This is recommended so VK does not fall back to SMS. In VK: Settings → Security → Confirmation in two steps → Authenticator app. The setup key is the base32 secret shown next to the QR code.

2. Add these repository secrets in GitHub Settings → Secrets and variables → Actions → New repository secret:
   - `VK_LOGIN` — the spare account's phone or email
   - `VK_PASSWORD` — its password
   - `VK_TOTP_SECRET` — the authenticator setup key from step 1

Optional: `VK_SESSION_KEY`, a long random string. If you skip it, the cache is encrypted with a key derived from the password.

The sync then signs in through the normal vk.com / id.vk.com page in headless Chromium, the same way a desktop browser does. Later runs reuse the cached cookies. It requests the feed once and keeps accounts that spare account follows. It skips the spare account's own story. If that page is only the site shell, the same run opens the feed in Chromium once and reads the stories payload the page loads. It does not repeat that open in the same run. It aborts `act=web_token`, mark-seen, writes, and pings. It does not send an official VK app client id.

## When the issue appears

The sync stops immediately, with no retry and no captcha solving, if VK shows a captcha, asks for an SMS or a phone call, shows a suspicious-login check, blocks the account, or returns 401 or 403.

It opens or updates the existing **Sync problem** issue with:

`VK spare account needs attention: sign in once by hand at vk.com`

The issue has no password, code, or cookie. Sign in once by hand at [vk.com](https://vk.com/) on that spare account, complete whatever VK asked, and the next sync tries again.

## Cookie export fallback

Use this only if you do not want the sync to type the password. `VK_LOGIN` wins when both are set.

1. Log into the spare account at vk.com in Chrome or Brave on a desktop.
2. Install the Cookie-Editor extension.
3. Export the cookies for `vk.com` and `login.vk.com` as JSON. Include the long-lived login cookies (`l`, `p`, `remixttpid`, and the rest of that jar) as well as `remixsid`.
4. Paste the export into a secret named `VK_SESSION`. A raw `Cookie` header also works. Add `VK_SESSION_KEY` as well so a refreshed jar can be stored in the cache.

If that session dies, the issue says: `VK session needs attention: re-export cookies from the spare account`. Export the cookies again and update `VK_SESSION`. Nothing from the export is printed or committed.

## API token alternative

`VK_USER_TOKEN` still works when the login secrets and `VK_SESSION` are unset. It calls `stories.get` and `stories.getById` only. Steps: [vk-stories-token.md](vk-stories-token.md).
