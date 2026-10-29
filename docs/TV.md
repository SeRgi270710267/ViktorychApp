# ViktorychApp on TV

The site is the desktop X layout scaled for a TV and driven by a normal remote.
TV mode turns on by itself on Android TV, Google TV, Fire TV, Tizen (Samsung),
webOS (LG), BRAVIA, Chromecast and other smart-TV browsers. You can also turn it on or off by hand:
Settings > Display > TV mode (Auto / On / Off), or `?tv=1` / `?tv=0` in the URL.

## Remote

| Key | Does |
| --- | --- |
| Arrows (D-pad) | Move the focus. It goes to the nearest item on screen and never gets stuck. At the end of a list the page scrolls on. |
| OK / Enter | Open or press the focused item |
| Back (Escape, Backspace, Android 4, Samsung 10009, LG 461) | Close the open dialog or player, or go back |
| Play/Pause, Stop, FF, RW | Control the open video |

The focused item has a big white and blue ring and is kept in the middle of the screen.
The layout leaves 5% clear on every side (overscan). Text fields open the TV's own keyboard.

## Light defaults

TVs are slow, so TV mode starts with lighter settings. Each one can be changed in
Settings > Display > TV performance, and Reset puts them back:

- Reduce motion: no animations or smooth scrolling
- No blur: solid bars instead of the glass effect
- Lighter images: the smaller image size
- Video autoplay: Off (or Muted / On)
- Fewer posts per page (12 instead of 25)
- Lighter start: skip background preloading

On the first TV start the device performance level is also set to Light, unless it was already set.
Settings are stored under `viktorychapp-tv-v1` in the browser.

## Install the TV app (icon on the Google TV home screen)

The TV app is a thin wrapper (a Trusted Web Activity, package `app.viktorych.tv`).
It opens https://viktorychapp.pages.dev in full screen. All the content comes from the site,
so new site versions reach the app without reinstalling.

### From the TV browser (the easiest way)

1. Open **viktorychapp.pages.dev/tv** in the TV's browser, or open the site, which shows a big
   **Install TV app** card on Home and in Settings > Display.
2. Press OK on **Install TV app**. The file `ViktorychTV.apk` downloads.
3. The first time only, Android asks to allow installing apps from this browser:
   choose **Settings**, turn on **Allow from this source** for the browser, then press Back.
4. Press **Install**, then **Open**. The app now has its own banner in Apps and can be added to the home row.

### With Downloader (if your TV browser cannot download files)

1. Install **Downloader** by AFTVnews from the Play Store / Amazon Appstore.
2. Allow Downloader to install unknown apps (Settings > Apps > Security & restrictions > Unknown sources).
3. In Downloader, type `viktorychapp.pages.dev/tv` (or scan the QR code on that page with a phone
   to open it there). Choose **Install TV app** and then **Install**.

Direct file links:
- https://viktorychapp.pages.dev/tv/ViktorychTV.apk
- https://github.com/ViktorychGroup/ViktorychApp/releases/latest/download/ViktorychTV.apk

The install card is hidden inside the app. In Chrome it is also hidden when the app is already installed
(`getInstalledRelatedApps`).

### What Android does not let us skip

- The one-time "allow unknown apps" switch for the browser or Downloader.
- Pressing **Install** (and **Update**) on the system prompt. An app or a web page cannot install silently.
- Detecting an installed app from a web page works only in Chrome. Most TV browsers do not have it,
  so the card stays until you press **Not now** (hidden for 30 days) or open the site from the app.
- Most Google TVs have no Chrome. The app then runs in its built-in WebView fallback. It still works full screen.
  The domain check (`/.well-known/assetlinks.json`) only matters when Chrome is present.
- No sideloading at all: only the Play Store route below.

### Play Store (optional)

A Google Play developer account costs a one-time $25. Then upload the same signed build
(as an App Bundle: `gradle bundleRelease`) to a new app `app.viktorych.tv`, pick the TV form factor,
add the 1280x720 TV banner and TV screenshots, and pass the TV review. If Play App Signing re-signs the app,
add Play's SHA-256 to `.well-known/assetlinks.json` next to the current one.

## Updates

- **Site changes**: nothing to do. The app loads the site, and the service worker updates it as usual.
- **App changes** (icon, banner, package settings): build a new APK. The app opens the site with
  `?tvapp=<versionCode>`. When `tv/version.json` has a bigger `versionCode`, the app shows an
  **Update available** card with an **Update TV app** button that downloads the new APK in one press.
  Android then asks to confirm the update.

To ship a new app version:

1. In `android-tv/app/build.gradle`, raise `appVersion` (the versionCode) by 1 and set `appVersionName`.
2. Run `android-tv/build.sh`. It signs with the same key and writes `tv/ViktorychTV.apk`.
3. Set the same `versionCode` and `versionName` in `tv/version.json`.
4. Commit, then create a GitHub release (tag `tv-v<versionName>`) with `tv/ViktorychTV.apk` as the asset `ViktorychTV.apk`,
   marked as latest, so the `releases/latest/download` link points at it.

Keep the package name `app.viktorych.tv` and the same signing key. Otherwise Android refuses to install
over the old app and people would have to uninstall first.

## Signing key

The key is never in the repo (`android-tv/.gitignore` blocks `*.jks`, `*.keystore` and `*.pass`).
It lives on the build box at `/workspace/secrets/viktorychtv.jks`, with its password in
`/workspace/secrets/viktorychtv.pass` (alias `viktorychtv`). Keep a private backup: losing it means
the next app cannot update the old one. Its SHA-256 fingerprint is public and is in
`.well-known/assetlinks.json`.

## Why viktorychapp.pages.dev

Android checks `assetlinks.json` at the root of the domain. The GitHub Pages site lives under
`/ViktorychApp/`, so its root cannot hold the file. The Cloudflare Pages copy is at the root of
`viktorychapp.pages.dev`, which is why the app, the short link and the domain check use it.

## Build setup

JDK 17 and the Android SDK (platform 35, build-tools 35), Gradle 8.9, Android Gradle Plugin 8.7.3,
androidbrowserhelper 2.5.0. Set `sdk.dir` in `android-tv/local.properties` (not committed).

## Tests

- `node scripts/tv_boot_test.js`: TV detection, defaults, switches, in-app detection and the published files (in selftest).
- `node scripts/tv_mode_test.mjs` (needs Playwright): a keyboard-only run on a Google TV user agent,
  covering the install card, D-pad focus, Enter, Back, the settings switches and the update banner.
