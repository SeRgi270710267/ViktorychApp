# Passkeys, app lock, and the privacy screen

This note describes how sign-in and the on-device lock work, and what a browser cannot do. It does not name any account.

## Passkeys

Sign-up can create a passkey. No password is required. The 16-digit account number is still issued once and remains an optional backup. Sign-in can use either the passkey or that number.

The account Worker verifies WebAuthn itself with Web Crypto (ES256 and RS256). D1 stores the credential id, the COSE public key, the signature counter, and a one-time challenge. Private keys are never sent and are not stored. Challenges last five minutes, are deleted when they are used (including a failed check), and must match the Origin and relying party id of the request. Requests with no Origin are rejected.

Registration asks for attestation `none`. A `packed` attestation object is accepted only so a real phone or Windows Hello key can be stored. The attestation statement is not treated as a certificate chain. That is the same trust as `none`: the account is new, and later sign-in must produce a signature from the stored public key.

Discoverable credentials are required. Login does not send an allow-list, so the browser can offer a passkey without asking for an account number first. `hints` includes `hybrid`, and account passkeys do not force `platform`, so Chrome, Edge, and Brave can offer a QR code for a phone or tablet. The app lock is separate and does ask for the platform authenticator.

Settings → Security lists passkeys for the current site, and can add or remove them (up to ten per site).

### Relying party id cannot be shared

`github.io` and `pages.dev` are public suffixes. The relying party id has to be the full host:

| Origin | rpId |
| --- | --- |
| `https://viktorychgroup.github.io` | `viktorychgroup.github.io` |
| `https://viktorychapp.pages.dev` | `viktorychapp.pages.dev` |
| `https://<preview>.viktorychapp.pages.dev` | that full preview host |
| `http://127.0.0.1` or `http://localhost` | `127.0.0.1` or `localhost` (the port is not part of the rpId) |

Chrome still rejects an IP address as a relying party id (`This is an invalid domain`), including `127.0.0.1`. Local WebAuthn has to use `http://localhost`. The Worker accepts both hosts. The production hosts above are normal domains, so this limit is only for local testing.

A passkey created on one of those hosts is not offered on another. The Worker also stores `rp_id` and will not accept an assertion whose origin or rpId hash does not match the challenge. `http://` is rejected for every host except `localhost` and `127.0.0.1`.

## App lock

App lock is optional and stays on this device. It is not registered on the account. Unlock does not call the network.

Where the authenticator supports the WebAuthn PRF extension (`hmac-secret`), setup evaluates a 32-byte salt. Those 32 bytes are run through HKDF-SHA-256 (`viktorych-app-lock-v1`) to an AES-GCM-256 key. The key is kept in memory only. Locking encrypts a snapshot of drafts, the message cache, notification rows, and the on-device session, writes it to IndexedDB and to the private OPFS directory, then deletes the plaintext. Unlock needs a user-verified assertion that returns the same PRF output. That is real encryption, including while the device is offline.

"Lock when the app opens" seals as soon as the page is hidden, sent to the background, or frozen, so the next open has to unlock. If that switch is off, the idle timer (never, 1, 5, 15, or 60 minutes) seals only while the page is still alive. If the operating system kills the process before that timer fires, and the page never got a hide event, the plaintext from that session can still be on disk. Sealing during `pagehide` is asynchronous; the browser can discard the page before IndexedDB finishes. The earlier `visibilitychange` hidden event is what we rely on.

### When PRF is missing

Firefox, Safari, and older authenticators often have no PRF result. Setup then asks for a device PIN. The AES key is PBKDF2-SHA-256 of that PIN (210,000 iterations; the local test origin uses fewer). Each unlock still requires a user-verified WebAuthn assertion checked on the device, then the PIN. The assertion cannot be mixed into the AES key, because the signature is different every time. A person who has the PIN and a copy of the encrypted storage can decrypt it without the sensor. The settings text says this.

Failed attempts back off (no wait for the first three, then 5 seconds up to 15 minutes). On the local test origin the wait is 1.5 seconds after three failures. "Forgot" asks for confirmation, signs out, and deletes the on-device databases, the private OPFS directory, and the site's local storage.

### Where PRF and offline encryption work

Checked against current Chromium platform-authenticator behavior:

| Browser | PRF (real offline encryption tied to the sensor) | Fallback |
| --- | --- | --- |
| Chrome on Windows with Windows Hello | Yes, when Windows Hello exposes `hmac-secret` (current Chrome) | PIN if the authenticator returns no PRF output |
| Edge on Windows with Windows Hello | Same Chromium stack as Chrome | PIN |
| Brave on Windows | Same, when the platform authenticator supports PRF | PIN |
| Chrome and Brave on Android | Often yes on Android 14 and newer, through Credential Manager. Many older devices return no PRF output | PIN |
| Desktop Chrome, Edge, and Brave with a security key that supports `hmac-secret` | Yes | PIN |
| Firefox | No reliable PRF extension | PIN plus a local user-verified assertion |
| Safari | PRF is not consistent on iCloud Keychain or Touch ID | PIN |

Chrome 156's DevTools virtual authenticator (`ctap2`, internal transport, `hasPrf`) returned `prf.results.first`. The browser test seals the on-device drafts with that output and unlocks them while the network is off. Key derivation from a PRF output is also tested in Node.

## Privacy screen

The cover is created in the document head, before the app paints. It turns on synchronously when the window blurs, the page becomes hidden, the page is frozen, picture-in-picture starts, printing starts, or the window looks like a split (one side still fills the screen and the other is clearly reduced). A normal unmaximized desktop window, smaller in both directions, is not treated as a split.

The setting is off, messages only, or the whole app. Messages only covers direct messages, the chat drawer, notifications, and profile privacy settings. Print rules hide those regions, or the whole page except the cover. Text selection and dragging in those regions can be switched off.

Browsers cannot block an operating-system screenshot or screen recording. There is no web API that sets Android `FLAG_SECURE`. While this window is focused and visible, a screenshot can still capture it. The cover is there so the app-switcher snapshot, a blur, split screen, picture-in-picture, and print preview are not left on the sensitive view.

### What a future Android wrapper would take

This repository does not contain a store package. A Trusted Web Activity (Bubblewrap or PWABuilder) could:

1. Publish `/.well-known/assetlinks.json` for the signing certificate (Digital Asset Links).
2. In the launcher activity, before the page is shown, call `getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)`.
3. Ship that wrapper through a Play listing. `FLAG_SECURE` makes screenshots, the app-switcher thumbnail, and screen recording black on that Android activity.

`FLAG_SECURE` does not exist for a normal browser tab, and it does not apply to Windows. Windows Hello is used for the passkey and the app lock, not for blocking screenshots.
