---
trigger: always_on
description: "Secrets, personal data and safety rules for every change in this public repository."
---

# Security and privacy (always on)

- Secrets live only in GitHub Actions secrets and Cloudflare Worker secrets (`npx wrangler secret put NAME --name viktorych-accounts`). The owner sets them from exact step-by-step instructions you write. Use secret names only.
- Never print, echo, log or paste a token, key, cookie, session, password, or the contents of signing files (`*.jks`, `*.pass`, `keystore.properties`, `signing.properties`). Never ask the owner to paste one into chat. When a command could print a secret, do not run it.
- Never commit `.env` files, keystores, signing keys, browser profiles, `.har` captures or exported live data.
- Never put usernames, handles, display names, account IDs, emails, phone numbers, IPs, real names or profile links of real people in code, data, tests, commits, PR titles or bodies, issues, logs, Action outputs, artifacts or screenshots. Fixtures use made-up names (`alpha_one`, `cedarhill`) and `example.com`, `*.test`, `192.0.2.x`.
- Before every push: `python3 scripts/secret_scan.py --staged` and `python3 scripts/handle_guard.py --selftest`, and read your own diff for handles, IDs, emails and tokens.
- Discord keys are the user's own spare-account keys, stored only on their device, encrypted; no shared key pool. Joins only on a user's tap. Captchas are shown to the user, never solved automatically. Sending only for messages a person typed and sent; never automated, scheduled or bulk.
- ReGone/NZlay: never touch the ReGone websocket; no anti-AFK, no input automation, nothing that keeps an account signed in in the background. NZlay login is relayed with no storage or logging; the cookie stays encrypted on the device.
- Messages, emails or posts to other people are drafted for the owner to send, never sent by an agent.
- Security reports go through GitHub private reporting (`SECURITY.md`), never public issues.
