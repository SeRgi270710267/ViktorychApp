# Send to my TV

`#/send-to-tv` (Settings > Additional resources, and Settings > Display > TV mode on phones and computers)
gets the site open in a TV browser for the first time without typing the long address. It is free and
runs only on the phone: no server calls, no Cast registration, no new host.

## What the page does

- Shows the short TV address (`viktorychapp.pages.dev`, switchable with `VIKTORYCH_ACCOUNTS.tvHost`).
- **Share TV link** uses the Web Share API (or the installed app's share bridge). **Copy TV link** puts
  `https://<tv host>/?tv=1` on the clipboard so it can be pasted on the TV. `?tv=1` forces TV mode.
- Per-brand steps with a link to the TV maker's free phone app (Play Store on Android, App Store on iPhone,
  both elsewhere). The picked brand is remembered under `viktorychapp-sendtv-v1`.

## What really works (checked October 2026)

| TV | Free phone app | How the link gets in |
| --- | --- | --- |
| Samsung (Tizen) | SmartThings | Open the TV remote in SmartThings, open Internet on the TV and select the address bar. The phone gets a keyboard; paste. Works in Samsung's Internet browser because it uses the Samsung TV keyboard (IME). |
| LG (webOS) | LG ThinQ | Paste the link in the search bar of the TV screen in ThinQ and choose Web, or open the Web Browser and paste with ThinQ's keyboard. Phone and TV on the same Wi-Fi (2.4 GHz on some models). Menus vary by webOS version. |
| Google TV / Android TV | Google TV app, or the TV Remote tile in Android Quick Settings | Select the browser's address bar on the TV; the phone keyboard opens; long-press, Paste. Many Google TVs have no browser; then use the TV app (`/tv/`). |
| Fire TV | Amazon Fire TV app | Open Silk, select the address bar so the TV keyboard is open, then the keyboard button in the phone app, paste, Enter. |
| Any TV | none | Type the short address once (or say it with the remote mic) and bookmark it. |

## What does not work, and why we don't fake it

- **DIAL / UPnP / SSDP**: a web page cannot discover or command devices on the local network (no UDP,
  and browsers block local network access). DIAL also only starts registered apps (YouTube, Netflix),
  not the TV browser with a URL.
- **SmartThings cloud API** can launch the Samsung browser but cannot set its URL (Samsung confirmed on
  their community forum), and it needs a personal access token, so it is not used.
- **Screen mirroring** (Smart View, AirPlay, Miracast) only mirrors the phone; the TV browser stays closed.
- **Chromecast / Presentation API** needs a Google Cast registration (one-time fee). The owner chose not to.

## Short address (owner step)

A free org Pages site gives `https://viktorychgroup.github.io/`. See HANDOFF "Short TV address".
After it is live, change `DEFAULT_HOST` in `send-tv.js` to `viktorychgroup.github.io` if it should
replace `viktorychapp.pages.dev` on the Send to my TV page.
