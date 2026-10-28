# Telegram stories for the owner

Telegram does not offer a free public stories API for bots. The sync reads stories with the owner's own MTProto login. It is read-only. It only asks for stories of contacts and channels that account already follows, waits when Telegram asks it to slow down, and does not post, mark stories read, or send reactions.

Leave the secrets unset and Telegram stories stay off. The signed-in owner sees a **Connect Telegram** row. Everyone else sees nothing for Telegram. No empty ring is shown.

The session string is a secret. Put it only in GitHub Actions. Do not paste it into the repo, a pull request, an issue, a log, or a chat.

## Secrets

In the repository: Settings → Secrets and variables → Actions → New repository secret.

| Name | What it is |
| --- | --- |
| `TG_API_ID` | The numeric app id from [my.telegram.org](https://my.telegram.org) |
| `TG_API_HASH` | The app hash from the same page |
| `TG_STORIES_SESSION` | The StringSession from the command below |

All three are required. If any one is missing, the fetcher does not call Telegram.

## Create the session on your own computer

1. Open [my.telegram.org](https://my.telegram.org), sign in with the Telegram account that already follows the chats whose stories you want, and create an application under API development tools. Copy the app id and the app hash into the secrets above. Do not commit them.

2. On that computer, install Telethon and run this. It will ask for your phone number, the login code Telegram sends, and your 2FA password if you have one. Those answers stay on that computer.

```bash
python3 -m pip install telethon
python3 - <<'PY'
from telethon.sync import TelegramClient
from telethon.sessions import StringSession
api_id = int(input("api_id: "))
api_hash = input("api_hash: ")
with TelegramClient(StringSession(), api_id, api_hash) as client:
    print(client.session.save())
PY
```

3. Copy the printed line into the `TG_STORIES_SESSION` secret. Then clear the terminal scrollback. Do not save the line in a file in this repo.

4. The next scheduled **Sync feeds** run installs Telethon only when all three secrets are set, fetches stories, and stores the original media in R2. Video is not re-encoded and is not cached by the Cloudflare CDN. Stories leave the bar after 24 hours, and the cleanup cron deletes the R2 objects.

A bad or expired session does not print the secret. Sign in again with the command above and replace `TG_STORIES_SESSION`.
