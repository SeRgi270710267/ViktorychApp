# Inbox › Mail, SMS codes and email aliases

Inbox can show one-time codes from three member-owned sources. Each one is
read-only and kept on the member's own device. Nobody else can read it, the
owner included.

| Section | Where the data comes from | What is stored, and where |
| --- | --- | --- |
| Mail | One folder of the member's own IMAP mailbox | Headers and opened bodies, encrypted on the device |
| SMS codes | The member's own SMSPool account, or the owner's Worker secret | Recent codes, encrypted on the device |
| Aliases | The member's own SimpleLogin account | The SimpleLogin API key, encrypted on the device |

## Device vault

`inbox.js` keeps an AES-GCM key in IndexedDB (`viktorych-messages-vault`). The
key is created as non-extractable, so page script can use it but cannot read
it. App passwords, the SMSPool key, the SimpleLogin key and the mail cache are
all stored as ciphertext. The `vk-inbox-linked` localStorage entry only
records which sections are linked, so the chips can render before the vault
opens. "Disconnect" removes the secret and wipes the cached mail.

## Mail relay (`worker/src/mail-relay.js`)

Browsers cannot open IMAP sockets, so the device sends each request to
`POST /v1/inbox/mail` with the app password included. The Worker then:

* connects with `connect()` over TLS on port 993, to a fixed host per provider
  (Yandex, Gmail, Outlook, Mail.ru). Members cannot supply their own host.
* opens only the picked folder, with `EXAMINE` (read-only). `SELECT`, `LIST`,
  `STORE`, `COPY`, `MOVE`, `EXPUNGE` and `APPEND` are never sent. `INBOX` is
  refused unless the member turned on "Allow reading INBOX".
* lists headers first, for new UIDs only (`UID n+1:*`), at most 40 per check.
  It fetches with `BODY.PEEK`, so messages are not marked read. The body is
  fetched only when the member opens the message.
* applies the member's filters on the server before anything is downloaded:
  sender allowlist, codes only, and maximum age.
* stores nothing, logs nothing, and returns `cache-control: no-store`. Requests
  are rate-limited per account, and each one times out after 20 s.

The device enforces the folder too: it only sends the folder saved in the
vault.

The device starts every sync itself: every 2 minutes, only while
Inbox › Mail is open and visible. Server-side push would need the server to
keep the password, so it is deliberately not offered.

## Folder and filter (member setup)

The wizard (Inbox › Add › Mail) runs in this order: consent, provider, guide,
form. The guide has copy-ready rules that move SimpleLogin forwards and code
mail into a `ViktorychApp` folder (a label, in Gmail), plus direct links to
the provider's IMAP, app-password and filter settings. Those three steps only
exist on the provider's own site, so the app links to them and does not embed
them. Some Outlook.com accounts no longer accept app passwords over IMAP, and
the guide says so.

## SimpleLogin aliases

The app's own screens handle sign-up, activation, sign-in, 2FA (TOTP) and the
alias list. Each screen calls SimpleLogin's documented API straight from the
device (`/api/auth/register`, `/activate`, `/login`, `/mfa`, `/api/v5/alias/options`,
`/api/v3/alias/custom/new`, `/api/alias/random/new`, `/api/v2/aliases`). The
password goes only to SimpleLogin and is never stored. Accounts that use a
FIDO security key sign in by pasting an API key instead.

Free SimpleLogin accounts cannot add extra mailboxes. Aliases therefore
forward to the member's sign-up address, which is the same mailbox that Mail
reads, and the filter moves those messages into `ViktorychApp`.

## SMS codes

The owner's key is the `SMSPOOL_API_KEY` Worker secret. Any other member can
paste their own key in Inbox › Add › SMSPool; it is kept in the vault and sent
to `POST /v1/inbox/sms`, which relays to SMSPool and keeps nothing. The SMS
codes section stays hidden until a key is connected.

## Turning it on

The relay ships switched off. To enable Mail and member SMS, set
`INBOX_RELAY = "on"` in `worker/wrangler.toml`; merging to main redeploys the
Worker. Set it back to `"off"` to close both routes (they return 404). No
secrets are involved.

## Later: our own receiving domain

The receiving domain is a separate step. A free domain (for example EU.org)
plus Cloudflare Email Routing to an Email Worker could encrypt incoming mail
end-to-end to member device keys. None of that is set up, and Email Routing
must not be created until the owner decides.
