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
- Lighter start: only preload what a sidebar item needs; the rest loads when opened

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

## TV app name (privacy)

Android takes the home-screen name and icon from the installed APK, so an app cannot rename itself
with free text. There are two ways to change it.

### Presets (no rebuild)

The app ships five launcher entries (activity aliases) and shows only one:
**ViktorychApp** (default), **Media**, **Browser**, **Player** and **Notes**, each with a neutral
icon and TV banner. Pick one in the site's Settings, under **TV app name**, while inside the app.
The site tells the app through the `ViktorychTVApp` bridge (the no-Chrome app) or the link
`intent://name?preset=media&title=…#Intent;scheme=viktorychtv;package=app.viktorych.tv;end`
(Chrome TWA), and the app switches entries with `setComponentEnabledSetting`.

**Name inside the app** is free text (up to 40 characters, no control or direction marks). It sets the
page title and the recent-apps label (`setTaskDescription`). If the custom logo text setting
(`brandLogo` text in `viktorychapp-settings-v1`) is set, it is the default.

### Any name (custom build)

On `/tv/#custom` a signed-in person types any name (up to 24 letters, numbers, spaces, `.`, `_`, `-`)
and picks an icon. The site calls the accounts Worker (`POST /v1/tv/build`), which starts the
`tv-custom.yml` workflow. The workflow builds the same app with the **same package and the same key**
and **the same versionCode as the current app**, and saves the APK in a **draft** release (only repo
writers can see drafts; no tag is made). The page polls every 10 seconds, then offers
**Download my app**. The Worker serves the file through a signed link that works for 15 minutes.
Drafts older than a day are deleted by the next build. The name is never committed.

Limits: 3 builds per person per day and 40 per day for the whole site. A build takes 3 to 5 minutes.

### Updates keep the custom name

- A custom build opens the site with `tvcustom=1&tvlabel=…&tvicon=…`. The site remembers the name and
  icon in `viktorychapp-tv-v1` (the wrapper has them built in).
- When `tv/version.json` has a newer version, a custom install's **Update TV app** button does not
  download the normal APK. It starts a new custom build with the same name and icon (from the current
  code, so the versionCode is the new one), then hands that APK to the installer.
- Same package and key, so Android installs over the old app and keeps all data (sign-in, settings).
- Installing the normal app over a custom one is also allowed, but the name goes back to ViktorychApp.

- Launcher entries that were switched on stay switched on across updates, so a custom build turns its
  own entry back on right after it is installed (and again on every start). The chosen preset is kept
  and comes back if the normal app is installed later.

Checked: base v1, custom v1 "My Den" and custom v2 "My Den" all have package `app.viktorych.tv` and
the same signing certificate; the custom ones are labelled "My Den" and the base one "ViktorychApp".
Android installs an APK with the same package, key and an equal or higher versionCode as an update and
keeps the app's data. The emulator run could not be done on the build box (its KVM fails), so do the
on-device check once: install base, then custom, then the next custom version, and confirm the name
and that you are still signed in.

### Owner setup (once)

The repo's automation cannot add workflow files, so the owner does these steps:

1. Add `.github/workflows/tv-custom.yml` with the file below.
2. Add two repository secrets on the build box (nothing is printed):

   ```sh
   base64 -w0 /workspace/secrets/viktorychtv.jks | gh secret set TV_KEYSTORE_B64 -R ViktorychGroup/ViktorychApp
   gh secret set TV_KEYSTORE_PASS -R ViktorychGroup/ViktorychApp < /workspace/secrets/viktorychtv.pass
   ```

3. Create a fine-grained GitHub token for this repo only, with **Actions: Read and write** and
   **Contents: Read and write**. Add it to the Worker as the secret `TV_BUILD_TOKEN`
   (Cloudflare dashboard › Workers › viktorych-accounts › Settings › Variables and secrets, or
   `cd worker && npx wrangler secret put TV_BUILD_TOKEN`).
4. The Worker change deploys when this PR merges. Until step 3 is done, the form says the builder
   is not switched on yet.

```yaml
name: TV custom build
run-name: TV custom build
on:
  workflow_dispatch:
    inputs:
      build_id:
        description: Build id from the accounts Worker
        required: true
      label:
        description: Home-screen name (kept out of the logs)
        required: true
      icon:
        description: default, media, browser, player or notes
        required: false
        default: default
permissions:
  contents: write
concurrency:
  group: tv-custom
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - name: Read and hide the inputs
        run: |
          set -euo pipefail
          LABEL="$(jq -r '.inputs.label // ""' "$GITHUB_EVENT_PATH")"
          echo "::add-mask::$LABEL"
          ID="$(jq -r '.inputs.build_id // ""' "$GITHUB_EVENT_PATH")"
          ICON="$(jq -r '.inputs.icon // "default"' "$GITHUB_EVENT_PATH")"
          [[ "$ID" =~ ^[0-9a-z]{36}$ ]] || { echo "bad build id"; exit 1; }
          case "$ICON" in default|media|browser|player|notes) ;; *) echo "bad icon"; exit 1 ;; esac
          [ -n "$LABEL" ] || { echo "empty label"; exit 1; }
          {
            echo "BUILD_ID=$ID"
            echo "TV_APP_ICON=$ICON"
            D="EOF_$(openssl rand -hex 8)"
            echo "TV_APP_LABEL<<$D"; echo "$LABEL"; echo "$D"
          } >> "$GITHUB_ENV"
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with:
          ref: main
          persist-credentials: false
      - uses: actions/setup-java@cf277c60eb25467037889841efdb72551f06f6c3 # v4.9.1
        with:
          distribution: temurin
          java-version: "17"
      - uses: android-actions/setup-android@9fc6c4e9069bf8d3d10b2204b1fb8f6ef7065407 # v3.2.2
        with:
          packages: "platforms;android-35 build-tools;35.0.0"
      - uses: gradle/actions/setup-gradle@ed408507eac070d1f99cc633dbcf757c94c7933a # v4.4.3
        with:
          gradle-version: "8.9"
      - name: Build and sign
        env:
          TV_KEYSTORE_B64: ${{ secrets.TV_KEYSTORE_B64 }}
          TV_KEYSTORE_PASS: ${{ secrets.TV_KEYSTORE_PASS }}
        run: |
          set -euo pipefail
          printf '%s' "$TV_KEYSTORE_B64" | base64 -d > "$RUNNER_TEMP/tv.jks"
          export TV_KEYSTORE="$RUNNER_TEMP/tv.jks" TV_KEY_ALIAS=viktorychtv
          cd android-tv
          echo "sdk.dir=$ANDROID_HOME" > local.properties
          gradle --no-daemon -q assembleRelease
          cp app/build/outputs/apk/release/app-release.apk "$RUNNER_TEMP/ViktorychTV.apk"
          rm -f "$RUNNER_TEMP/tv.jks"
      - name: Publish as a private draft
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          cutoff="$(date -u -d '24 hours ago' +%s)"
          gh api --paginate "repos/$GITHUB_REPOSITORY/releases?per_page=100" \
            --jq '.[] | select(.draft and (.tag_name | startswith("tv-custom-"))) | [.id, .created_at] | @tsv' |
          while IFS=$'\t' read -r rid created; do
            if [ "$(date -u -d "$created" +%s)" -lt "$cutoff" ]; then
              gh api -X DELETE "repos/$GITHUB_REPOSITORY/releases/$rid" >/dev/null || true
            fi
          done
          gh release create "tv-custom-$BUILD_ID" "$RUNNER_TEMP/ViktorychTV.apk#ViktorychTV.apk" \
            --draft --title "TV custom build" --notes "Private build. Deleted after a day." --target main
```

### Honest limits

- Only one copy of the app per TV (one package), so one name per TV.
- Switching presets can drop the app from Favourites; add it again.
- The first update from app v1 changes the launcher entry, so the Favourites shortcut may need re-adding once.
- Any app on the TV could open the name link and switch the preset. It only changes which of the five names shows.
- Recent-apps titles are best effort in the Chrome TWA.
- Repo admins can see custom names in draft releases for up to a day. Run logs hide the name.
- Android always asks to allow unknown sources once and to press Install; this cannot be skipped.
- The site's language packs are English, Russian and Spanish. Hindi is in the app's own strings and the `/tv` page.

## Controller play (app 1.2.0)

The app plays ReGone with an Xbox, PlayStation or other controller in its own game screen
(`viktorychtv://game/regone`). See [TV-CONTROLLER.md](TV-CONTROLLER.md).

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
- `cd android-tv && gradle testDebugUnitTest`: the controller mapping (dead zone, look, remap, modes).
- `node scripts/tv_controller_link_test.mjs` (needs Playwright): the Play with controller button and note.
- `cd worker && npm test`: includes `test/tv-build.test.mjs` (sign-in, name rules, owner check, signed download, daily limit).
