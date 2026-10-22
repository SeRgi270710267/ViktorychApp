# Telegram backup

The backup runs in GitHub Actions. It does not need a bot or an assistant at runtime. `.github/workflows/telegram-backup.yml` runs at 11:17 UTC (`17 11 * * *`) and from **Run workflow**. One run sends at most 300 messages and 4 GB, with about 3 seconds between messages, and it honors Telegram `retry_after` on HTTP 429.

`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHANNEL_ID` are required. If either is missing, the job prints a skip line and exits 0. `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` are used only when a non-video file is too big for one public document. The local `telegram-bot-api` server then starts with `--local` for that run and stops at the end. It is not started when every pending file fits the public API. Nothing in the log is a secret value.

The manifest is `backup/telegram-manifest.json` in the private R2 bucket (prefer `viktorych-data`). The same rows are mirrored to the D1 table `telegram_files`. The manifest is not committed.

## Create the bot, the channel, and the secrets

1. Open Telegram and talk to [@BotFather](https://t.me/BotFather). Send `/newbot`. Follow the prompts. Copy the token. That value is `TELEGRAM_BOT_TOKEN`.
2. Create a private channel. Add the bot as an administrator. Give it permission to post messages.
3. Get the channel id. Forward a post from the channel to [@username_to_id_bot](https://t.me/username_to_id_bot), or open the channel in Telegram Web (`https://web.telegram.org`) and copy the `-100…` id. That value is `TELEGRAM_CHANNEL_ID`.
4. Open <https://my.telegram.org>, then **API development tools**. Create an application if you do not already have one. Copy `api_id` and `api_hash`. Those values are `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`.
5. Add the four GitHub Actions secrets at <https://github.com/ViktorychGroup/ViktorychApp/settings/secrets/actions/new>. Use these names exactly:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHANNEL_ID`
   - `TELEGRAM_API_ID`
   - `TELEGRAM_API_HASH`
6. The backup also reads the existing Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. If either is missing, the job prints a skip line and exits 0.
7. Optional Actions secret `TG_BACKUP_KEY`: a passphrase of at least 16 characters. It encrypts account data with `openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt`. Those copies are not played in the app and are not deleted from R2. Without the key, account data is not uploaded.
8. Optional Actions variables: `TG_MAX_MB` (default `19`, cap `1950`) is the single-document limit. `TG_DELETE_FROM_R2` defaults to on. Set it to `false` to keep every R2 object. `TG_WORKER_URL` overrides the discovered `viktorych-accounts` workers.dev host used to verify a file before deleting it.

The Worker has its own copy of the bot token. It is not the Actions secret. From `worker/`:

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

The same command exists in the Cloudflare dashboard for the `viktorych-accounts` Worker. Until that secret is set, `GET /tg/…` returns 503 and the app uses the next source. The token is never sent to the browser.

Pushing `.github/telegram-probe` to `main` runs a check that prints `true` or `false` for each of the four secret names, calls `getMe` and `getChat`, and uploads one tiny text file. It does not print secret values.

## What each file does

A file of at most 19 MB, and at most `TG_MAX_MB`, is one `sendDocument` on `https://api.telegram.org`. The app can load it at `/tg/<key>` after you sign in. The workflow fetches that URL, checks the sha256, and then deletes the R2 object when deletion is on (the default). A file over 19 MB is not served by `/tg/` even if `TG_MAX_MB` is higher, and it is not deleted.

Video and long audio over that limit, except anything under `loop/`, `radio/`, `music/`, or `covers/`, is remuxed with ffmpeg to HLS. Segments are about 4 to 6 seconds and each one is under 19 MB. Codecs are copied. If a segment is still too big, the workflow re-encodes and logs `transcoded`. Each segment and the init segment is its own public document. The app plays `/tg/<key>/index.m3u8` with the bundled hls.js. The original R2 object is deleted only after every segment matches. This is what makes a long video fit.

The published radio loop stays on R2. When `loop/current.json` names a version, that version's playlist, init segment, and media segments — the FLAC tree and the AAC fallback — are copied as they already are. They are not re-encoded. Each file must be under 19 MB; a larger segment is logged `skipped_too_big` and stays on R2. The manifest records them under `loop/<version>` and `loop/<version>/aac`. The Worker serves `/tg/loop/<version>/index.m3u8` (and `/tg/loop/<version>/aac/index.m3u8`) and rewrites every segment URI to a `/tg/loop/…` route. Those responses are `public, max-age=31536000, immutable`. The loop is never deleted from R2. `loop/current.json`, older loop versions, `radio/`, and `music/` are not uploaded. Publishing a loop starts this mirror when the Publish radio loop workflow succeeds. The daily backup mirrors the current version as well.

While R2 is healthy the player does not call `/tg`. If an R2 playlist or segment fails — a network error, or an HTTP 4xx or 5xx after one retry — the player loads the Telegram playlist for the same version at the same position and returns to R2 on the next version. A fallback listener requests about 6 segments a minute (the loop segments are 10 seconds): 360 Worker requests an hour, 8,640 a day. The Workers free tier of 100,000 requests a day covers about 277 listener-hours of fallback, or about 11 listeners if they stayed on Telegram all day. Playback from R2 does not use this budget. `workers.dev` still runs the Worker on a cache hit, so the estimate counts every segment. `/tg/loop/` allows 800 requests an hour per IP, enough for one listener and a second tab. Other `/tg` routes stay signed in.

A big file that is not video or audio (a zip, a pdf, a large image, and the rest) is uploaded through the local server in parts of at most 1950 MB. Those parts are a backup. The app cannot play them, because `api.telegram.org` `getFile` only returns files of about 20 MB, and the local server is not running while someone is watching. Restore them with `scripts/telegram_restore.py`. If `TELEGRAM_API_ID` or `TELEGRAM_API_HASH` is missing, the job logs `skipped_too_big` and leaves the object on R2.

These prefixes are never uploaded and never deleted: `radio/`, `music/`, `covers/`, `owner/`, `backup/`, and the live Worker JSON (`feeds.json`, stories, people, suggestions, status, `feeds.config.json`, `data/music.json`, `live/`, `archive/`, `comments/`, `fallback/`, and the Discord JSON). `loop/current.json` and every loop version except the one named in that file are also left untouched. The named version is mirrored and is never deleted from R2.

Account prefixes (`media/avatars/`, `media/banners/`, `accounts/`, `profiles/`, `history/`, `lists/`, `settings/`, `sync/`, `users/`, `d1/`, and the same names in the singular) are skipped unless `TG_BACKUP_KEY` is set. The ciphertext is one public document when it is at most 19 MB. It is not served and not deleted. A larger ciphertext is logged `skipped_too_big`.

`scripts/telegram_restore.py --key <r2-key> --out restored` reads the manifest from R2, or from `--manifest`. It downloads each part, checks the sha256, joins archive parts, writes an HLS directory, and decrypts an account copy when `TG_BACKUP_KEY` is set. Parts over 19 MB need the local server already listening on `127.0.0.1:8081`.

## Playback

The page tries the R2 URL first. If that fails and you are signed in, it requests `/tg/<key>` on the accounts Worker with the session token. Images use that response as a blob. Video tries the R2 file, then `/tg/<key>/index.m3u8` through hls.js (the request sends the session only to the Worker host), then `/tg/<key>` as one file, then the original source URL, then the Internet Archive copy. ViktorychMusic songs stay on `r2.dev`. The radio loop plays from R2 and uses `/tg/loop/<version>/index.m3u8` only after R2 fails. That loop route does not require a session, because the same audio is already public on `r2.dev`.

The Worker calls `getFile` with its own `TELEGRAM_BOT_TOKEN` and streams the file. Repeat views use the Cache API. The `file_path` is cached for at most 50 minutes. A signed-out request is 401. The route is rate limited so a normal viewing session stays inside the Workers free 100,000 requests a day.
