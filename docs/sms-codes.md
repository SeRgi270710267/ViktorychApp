# Inbox › SMS codes (owner only)

Inbox (formerly Messages) has an **SMS codes** chip that only the owner sees. It
shows the verification codes that reach the owner's SMSPool numbers: one-time
verification orders and rented numbers.

## How it works

- The browser calls `GET /v1/owner/sms` on the accounts Worker with the owner
  session. Anyone else gets 403/404.
- The Worker reads SMSPool with the secret `SMSPOOL_API_KEY` (bearer header):
  `/request/active` (active orders), `/rental/retrieve` (active rentals),
  `/rental/retrieve_messages` (up to 4 rentals, 10 latest messages each) and,
  only when "Show earlier codes" is tapped, `/request/history` (30 rows).
  Nothing is bought, cancelled or refunded.
- The key never reaches the browser, the repo or logs. Numbers and codes are
  not logged. Answers are `Cache-Control: no-store`; the Worker keeps an 8 s
  in-memory copy to absorb double taps and rate-limits the owner to 90 reads
  per 10 minutes.
- The device polls only while the SMS codes section is open and the tab is
  visible: every 15 s while a code is awaited, otherwise every 2 minutes.
- The last answer is cached on the device encrypted (AES-GCM, non-extractable
  key) in IndexedDB `viktorych-messages-sms`, kept for 24 hours, and dropped
  when a non-owner opens the section. "Delete all data on this device" removes
  it with every other IndexedDB database.
- Without the secret the section shows "SMSPool isn't connected".

## Owner setup (one time)

1. On smspool.net, open **Settings** (`/my/settings`) and copy your **API key**.
2. Open the Cloudflare dashboard → **Workers & Pages** → **viktorych-accounts**
   → **Settings** → **Variables and Secrets** → **Add**.
3. Type: **Secret**. Variable name: `SMSPOOL_API_KEY`. Value: paste the key.
   Click **Deploy** (or **Save and deploy**).
4. Open the app → **Inbox** → **SMS codes**. Codes appear within seconds.

To disconnect, delete the `SMSPOOL_API_KEY` secret the same way. If SMSPool
ever shows the key was leaked, reset it on SMSPool and replace the secret.
