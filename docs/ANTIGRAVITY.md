# Continue ViktorychApp in Google Antigravity

A step-by-step guide for the owner. After these steps, Antigravity's agent knows the project, the rules and the shipping routine from the files in this repository, the same way the previous assistant worked.

## What Antigravity reads by itself

Checked against the Antigravity docs on 2026-10-30:

| File | What it is | Loaded |
| --- | --- | --- |
| `AGENTS.md` (repo root) | The full project guide for any AI agent | Always, automatically ([Rules docs](https://antigravity.google/docs/rules/)) |
| `GEMINI.md` (repo root) | Short pointer plus the top must-not rules | Always, automatically ([Rules docs](https://antigravity.google/docs/rules/)) |
| `.agents/rules/*.md` | Always-on rules: security and privacy, shipping, X.com design, i18n (YAML `trigger: always_on`) | Always, automatically ([Rules docs](https://antigravity.google/docs/rules/)) |
| `.agents/skills/<name>/SKILL.md` | Step-by-step routines you can call with a slash command: `/ship-a-pr`, `/verify-live`, `/resolve-sw-conflict`, `/add-feature-with-switch`, `/triage-failed-actions` | Names and descriptions always; full steps when needed or when you type the command ([Skills docs](https://antigravity.google/docs/skills)) |

Older Antigravity "workflows" (`.agents/workflows/*.md`) stopped working on 2026-10-19, so the routines are skills instead ([migration guide](https://antigravity.google/docs/migration/workflows-to-skills/)). Antigravity still reads the older `.agent/` folder name, but `.agents/` is the current default.

## 1. Install and sign in

1. Download Antigravity from [antigravity.google/download](https://antigravity.google/download) (the desktop App or the standalone IDE) and install it.
2. Open it and sign in with your Google account.

## 2. Get the repository on your computer

1. Install Git and the GitHub CLI (`gh`) if you do not have them: [git-scm.com](https://git-scm.com/downloads) and [cli.github.com](https://cli.github.com/).
2. In a terminal run `gh auth login`, choose GitHub.com, HTTPS, and sign in with the browser. This keeps your GitHub login in your system keychain, not in the repository.
3. Clone: `gh repo clone ViktorychGroup/ViktorychApp` (the TV app is inside it, in `android-tv/`).
4. Inside the folder run once: `sh scripts/install_git_hooks.sh` (blocks commits that contain secrets).
5. Set your commit email to your GitHub noreply address so your email is not published: `git config user.email "<id>+<username>@users.noreply.github.com"` (GitHub → Settings → Emails shows it).

## 3. Open it in Antigravity

1. App: click **New Project** (folder with a plus) → **Add Folder** → pick the `ViktorychApp` folder → **Create**. IDE: **File → Open Folder** and pick it.
2. When asked, confirm that you trust the folder.
3. When you start a task, pick **New worktree mode** if you want several agents working at once without touching each other; otherwise **Local mode**.
4. Check the agent side panel → **…** → **Customizations**: under **Rules** you should see the four workspace rules, and under **Skills** the five skills listed above.
5. In the settings, keep terminal commands on "ask before running" at first, so you see every `git push` and `gh pr merge` before it runs.

## 4. Secrets on your computer (names only)

Set these yourself, outside the repository. Never put them in a file inside the repo, never paste them into the agent chat. `.env` and `.dev.vars` files are git-ignored and blocked by the secret scan, but the safest place is your system keychain or your shell profile.

| Name | Needed for | How |
| --- | --- | --- |
| GitHub login (`gh auth login`, or a `GH_TOKEN` environment variable) | Pushing branches, opening and merging PRs, reading Actions | `gh auth login` is enough. If you prefer a token: a fine-grained token for the ViktorychGroup/ViktorychApp repository with Contents, Pull requests and Actions set to Read and write, Workflows read-only. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Optional: running `npx wrangler` against the live Worker (reading logs, `wrangler secret put`). Normal deploys run in GitHub Actions and need nothing locally. | Cloudflare → My Profile → API Tokens. Set as environment variables in your own terminal only. |
| `RENDER_API_KEY` | Optional: checking the Render backup from the terminal | Render → Account settings → API keys. |

Everything else (Discord, Telegram, VK, payments, SMS, mail) lives only in GitHub Actions secrets or Worker secrets. The agent writes you exact steps when one is needed; you add it yourself. The table of every secret is in `docs/RUNNING-WITHOUT-BOT.md`, section 3.

The TV app's signing key (`*.jks` and its password file) stays on your computer, outside the repo or in the git-ignored `android-tv/keystore.properties`. Never let an agent commit or print it.

## 5. Starter prompts (copy and paste)

**1. Get up to speed**
```
Read AGENTS.md, docs/HANDOFF.md and docs/STATUS.md fully. Then run `gh pr list` and `gh run list --limit 20` and give me a short plain-language summary: what is live, which PRs are open and their state, what is red, and what needs me. Do not change anything yet.
```

**2. Continue the open queue**
```
Continue the open PR queue exactly as AGENTS.md and docs/HANDOFF.md describe. For each open PR, oldest small fixes first: bring it up to date with current main (normal merge, sw.js rule from /resolve-sw-conflict), make CI green, then merge one at a time with /ship-a-pr and confirm with /verify-live before the next. Skip and list for me anything that touches .github/, dependencies, payments, data deletion, or has a colliding migration number. Keep a short log of each merge.
```

**3. Fix a bug from a screenshot**
```
Here is a screenshot of a bug: [attach]. It happens on [phone/desktop], in [language]. Find the cause, fix it on a new branch, add a test that fails before and passes after, keep the UI identical to X.com, translate any new text into en, es, ru and hi, and ship it with /ship-a-pr. Show me before and after screenshots without personal data when it is live.
```

**4. Ship a new X-style feature**
```
Build this feature: [describe]. Copy how X.com does it on mobile web and on the desktop three-column layout. Put it behind its own on/off switch with /add-feature-with-switch, keep it local-first (cached copy instantly, no spinners when cached), free services only, no new hosts without asking me. Translate into en, es, ru and hi, test it, ship with /ship-a-pr and send me screenshots.
```

**5. Something failed**
```
Run /triage-failed-actions. Look at every failed GitHub Actions run and every red PR check from the last 24 hours, find the real cause, fix it, and re-run. If a secret expired, give me the exact renewal steps using only the secret's name. Never edit .github/ yourself; if a workflow needs a change, write me a ready patch in docs/owner-patches/.
```

**6. Is the site healthy?**
```
Run /verify-live: does the live version.json show main's latest commit, does the watchdog return 200, and did the latest Accounts and Sync feeds runs succeed? Explain any problem in plain words and fix it if it is safe to.
```

**7. Pick up the in-progress work**
```
Read docs/STATUS.md, section "In progress". For each item, check whether a branch or PR already exists (`gh pr list`, `git branch -r`), continue it from where it stopped instead of starting over, and ship them one at a time. Start with the sign-up fix.
```

**8. Prepare something for me to send**
```
Draft [the message / email / issue] to [who] about [what]. Do not send or post anything. Show me the final text so I can send it myself.
```

## 6. Good habits

- One task per agent conversation; one PR per task.
- Keep "ask before running" on for commands that push, merge or delete.
- If the agent wants to edit `.github/`, print a token, add a new host or service, or send something to another person, say no unless you planned it.
- After a big session, ask the agent to update `docs/STATUS.md` in a small PR.
