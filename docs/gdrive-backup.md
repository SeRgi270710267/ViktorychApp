# Google Drive backup

The backup runs in GitHub Actions. It does not need an assistant. The schedule is 09:17 UTC every day, and **Run workflow** starts it immediately. The job stops after 40 minutes. Each run uploads at most 400 MB and 500 new files. A file that is already on Drive, checked by SHA-256, is skipped. When `GDRIVE_RCLONE_TOKEN` is missing, the job prints a skip line and exits 0.

The folder is `ViktorychApp-backup/` in the Google account that created the token. rclone uses the `drive.file` scope, so it can see only files this token created.

| Folder | What is stored |
| --- | --- |
| `music/` | ViktorychMusic song audio (HLS segments and a playlist) |
| `covers/` | Song covers |
| `radio/` | Radio loop audio |
| `tiktok/` | TikTok videos and posters for handles that are not in `ia_tiktok_allow` |
| `media/` | Video files whose source is not allowed on Internet Archive, largest first |

`index.json` in that folder records the SHA-256, kind, and label. ViktorychApp account data (D1, and R2 user-data objects such as profiles, avatars, banners, uploads, history, lists, and settings) is not uploaded. There is no second secret, because that data is not copied. A service account is not used. A service account has no storage quota on a personal Drive, including a Google AI Pro plan.

The Drive job does not delete files from Internet Archive.

## Create the token

Do this once, on the Windows PC. rclone's login opens a desktop browser. The shared rclone client stops working during 2026, so the token has to belong to your own OAuth client. Use the Google account whose Drive has the 2 TB plan. A service account will not work.

1. Download rclone v1.75.2 for Windows 64-bit and unzip it to `C:\rclone`:

https://downloads.rclone.org/v1.75.2/rclone-v1.75.2-windows-amd64.zip

2. In a browser, open https://console.cloud.google.com/apis/library/drive.googleapis.com and turn on the Google Drive API for a project. The project can be a new one named `rclone`.

3. Open https://console.cloud.google.com/auth/overview and configure the OAuth consent screen if it is not configured yet. Application name: `rclone`. User support email: your email. Audience: External. Add yourself as a test user.

4. Open the consent screen's Data Access page and add only this scope:

```text
https://www.googleapis.com/auth/drive.file
```

5. Open Audience and click Publish app. Publishing keeps the refresh token from expiring after seven days. Google shows an unverified-app warning for a personal app. That is expected. You do not submit the app for verification when only you use it.

6. Open https://console.cloud.google.com/auth/clients and create an OAuth client. Application type: Desktop app. Name: `rclone`. Copy the client id and the client secret. Leave that page open until the secret is saved in GitHub.

7. Open PowerShell and run:

```powershell
cd C:\rclone
$clientId = Read-Host "OAuth client id"
$clientSecret = Read-Host "OAuth client secret"
$json = (@{ scope = "drive.file"; client_id = $clientId; client_secret = $clientSecret } | ConvertTo-Json -Compress)
$blob = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
.\rclone.exe authorize "drive" $blob
```

A browser opens. Sign in to the Drive account. On the unverified-app screen, choose Advanced, then continue to rclone. Approve the request. The request is limited to files this app creates.

PowerShell then prints a block like this:

```text
Paste the following into your remote machine --->
{"access_token":"...","token_type":"Bearer","refresh_token":"...","expiry":"..."}
<---End paste
```

Copy the single JSON line between those two marks. Do not copy the marks.

8. In the same PowerShell window, run:

```powershell
$token = Read-Host "Paste the token JSON line"
$secret = (@{ client_id = $clientId; client_secret = $clientSecret; scope = "drive.file"; token = $token } | ConvertTo-Json -Compress)
Set-Clipboard -Value $secret
Write-Output "Copied the secret to the clipboard. It was not printed."
```

9. Paste it into GitHub. On the same Windows PC, open this page in the browser:

https://github.com/ViktorychGroup/ViktorychApp/settings/secrets/actions/new

Name:

```text
GDRIVE_RCLONE_TOKEN
```

Secret: Ctrl+V

Click Add secret.

The same page works in Chrome on Android if the clipboard value is already on the phone. Create the token on Windows first. Do not send the secret by email, chat, or a screenshot.

10. Close PowerShell. Do not save the JSON in the ViktorychApp folder or commit it.

11. Optional: on GitHub, open Actions, open Google Drive backup, and click Run workflow. The first run creates `ViktorychApp-backup/` in My Drive. You can open that folder in the browser or in the Drive app on Android. Until the secret is saved, the workflow skips and finishes successfully.
