---
name: add-feature-with-switch
description: Adds a new ViktorychApp feature behind its own owner on/off switch, X-style, translated and tested. Use for any new feature or new external service.
---

# Add a feature with its own switch

1. **Design like X.** Find the matching X.com screen and copy its layout, spacing and wording (`.agents/rules/x-design-fidelity.md`). Phones: X mobile web. Desktop: three-column shell.
2. **Server switch.** In `worker/src/feature-flags.js` add an entry to `FEATURES`:
   ```js
   my_feature: { paths: ["/v1/my-feature"] },              // on by default
   my_paid_thing: { paths: ["/v1/pay"], defaultOff: true },  // needs keys or an owner decision
   ```
   An off feature answers its paths fast and empty and its cron work is skipped. Add or extend `worker/test/feature-flags.test.mjs`.
3. **Client switch.** Add the name to the `SERVER_FEATURES` array in `app.js` and a `[tr("Label"), tr("One-line description")]` pair to the labels map next to it (see the `nzlay_forum_post` entry). The client must skip loading the feature when the name is in the server-off list (`serverOffList()` in `app.js`; standalone modules read the same localStorage list, see `serverOff()` in `nzlay-keys.js`).
4. **Keys.** If it needs a key: it is a Worker or GitHub secret the owner sets. Document the exact steps (secret name, where to click, `npx wrangler secret put NAME --name viktorych-accounts`) in a doc under `docs/`. Never commit or print the value. The feature ships `defaultOff: true` until the key exists.
5. **Data.** Stream and hotlink; store the minimum; no re-encoding; no data committed to the repo. Free services only, added on top of what works. No new host without the owner's OK.
6. **Speed.** Local-first cache, no spinner when cached, timeouts with a calm Retry.
7. **i18n.** Every string in `en`, `es`, `ru`, `hi`; `python3 scripts/check_i18n.py`.
8. **Migrations.** New D1 tables go in `worker/migrations/NNNN_name.sql` with the next unused number (`python3 scripts/migration_numbers.py`).
9. **Tests.** Add a focused test (`scripts/<feature>_test.mjs` or `worker/test/<feature>.test.mjs`; add Worker tests to the `test` script in `worker/package.json`). Workflow files cannot be edited, so new browser checks may ride inside an existing test script.
10. **Ship** with `/ship-a-pr` and name the switch in the PR body.
