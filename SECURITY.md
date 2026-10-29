# Security policy

## Reporting a vulnerability

Please report security problems privately. Do not open a public issue, pull request, or discussion for them.

Use GitHub's private reporting: open the **Security** tab of this repository and choose **Report a vulnerability**. Only the maintainers can see the report.

Include what you found, where (file, route, or page), how to reproduce it, and what an attacker could do with it. Never include real passwords, tokens, account numbers, or other people's personal data. Use made-up values.

We aim to acknowledge a report within 7 days and to tell you what we plan to do within 30 days. Please give us a reasonable time to fix the problem before you talk about it publicly. We will credit you in the fix if you want.

## Scope

In scope:

- The web app served from this repository (GitHub Pages and the Cloudflare Pages mirror) and its service worker.
- The accounts Worker in `worker/` and the backup server in `backup-server/`.
- The scripts and GitHub Actions workflows in this repository.

Out of scope: denial of service and load testing, social engineering, spam, attacks on third-party services we read from, and findings that need a rooted or already compromised device.

## Rules for testing

- Only test against your own account. Do not access, change, or delete anyone else's data.
- Do not run automated scanners against the live services. Run the Worker locally with the tests in `worker/test/` instead.
- Stop and report as soon as you see data that is not yours.

## Secrets

No secret, key, token, password, cookie, or session belongs in this repository. They live only in GitHub Actions secrets and Cloudflare Worker secrets, which only the owner can set. If you think a secret was committed, report it privately as above; do not copy the value anywhere.
