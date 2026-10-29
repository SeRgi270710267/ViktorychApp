# Contributing

Thanks for helping. This project is public, so a few rules protect everyone who uses it.

## How changes get in

1. Fork the repository and work on a branch in your fork. Outside contributors do not get write access to this repository.
2. Open a pull request against `main`. Keep it to one change.
3. A maintainer reviews every pull request. Changes to `.github/`, `worker/` (including `worker/migrations/`), `backup-server/`, `scripts/`, `sw.js`, sign-in, and payments get extra scrutiny.
4. Checks must pass. Workflows from a first-time contributor wait for a maintainer to approve them.
5. Maintainers squash-merge. Force-pushes to `main` are blocked.

Security problems go through private reporting, not pull requests or issues. See [SECURITY.md](SECURITY.md).

## Never commit personal data or secrets

The pull request will be closed, and the data may have to be purged from history, if it contains any of these:

- Passwords, API keys, tokens, cookies, session strings, private keys, signing keys, keystores, or `.env` files.
- Usernames, handles, display names, account ids, or profile links of real people, including your own and the maintainers'. Tests and fixtures use made-up names such as `alpha_one` or `cedarhill` and reserved addresses such as `example.com`, `*.test`, and `192.0.2.x`.
- Email addresses (other than placeholder domains), phone numbers, IP addresses, real names, locations, followed-account lists, message contents, or screenshots that show any of them.
- Data exported from the live app, a database, a browser profile, or a network capture (`.har`).

Before you commit, install the local check once:

```sh
sh scripts/install_git_hooks.sh
```

It runs `python3 scripts/secret_scan.py --staged` before every commit. CI runs the same scan on the whole tree, plus `scripts/handle_guard.py`. Both print only a file, a line, and a rule name, never the value. A proven false positive can end its line with `secret-scan: allow <reason>`; a reviewer has to agree with it.

Configure Git to use your GitHub noreply address so your personal email is not published in commit metadata:

```sh
git config user.email "<id>+<username>@users.noreply.github.com"
```

and turn on **Settings → Emails → Keep my email addresses private** and **Block command line pushes that expose my email** on GitHub.

## Project conventions

- Every new user-facing string goes in every locale in `i18n/` (en, es, hi, ru).
- If you change files the service worker caches, bump the cache stamp in `sw.js` above `main`'s.
- D1 migration numbers in `worker/migrations/` must be unique.
- The UI follows X.com closely, including on mobile.
- Run the tests for what you touched: `cd worker && npm test` for the Worker, `python3 scripts/selftest.py` for the scripts.

## Workflows

Pull requests from forks run without repository secrets and with a read-only token. Do not add `pull_request_target` or `workflow_run` triggers that check out pull request code, do not print secrets, and pin third-party actions to a full commit SHA. Changes under `.github/workflows/` are reviewed by the owner.
