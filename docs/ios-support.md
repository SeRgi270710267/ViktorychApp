# iOS support

ViktorychApp is aimed at iPhone and iPad in Safari and as an installed Home Screen app. The layout is checked in Playwright’s WebKit with the iPhone 11 and iPad viewports. A real device is still the owner’s check for the keyboard, the notch, and Add to Home Screen.

## Versions

| Device | System | What works |
| --- | --- | --- |
| iPhone 11 and later, iPad | iOS 15.4 and newer | The app, including the visible viewport (`dvh`), `:has()`, and `AbortSignal.timeout` (that timeout is polyfilled below 16). |
| iPhone 11 | iOS 15.0–15.3 | The app still loads. `dvh` and `:has()` are ignored, so full-height screens use `100vh` and an empty avatar may stay visible. |
| Any iPhone or iPad | Installed app (Add to Home Screen) | Safe areas, splash images, and storage that Safari does not wipe on the 7-day timer. |
| iPhone or iPad | iOS 16.4 or newer, installed app only | Web Push. Safari in a tab cannot subscribe. |

iPad uses the same WebKit. Fields on iPhone and iPad are 16px so a tap does not zoom the page.

## What the app does for WebKit

- Viewport fit covers the notch. Safe-area padding is on the top bar, the bottom bar, and sheets. `100vh` stays as the fallback and `100dvh` is added where the browser chrome should not cover the page.
- Fields use a 16px font on touch so focusing one does not zoom the page.
- The software keyboard sets `--keyboard`. The bottom bar and the post button move out of the way.
- Overscroll on the page is contained. A downward drag at the top of the window does not refresh the page when nothing else is scrolling.
- Older WebKit gets small stand-ins for `AbortSignal.timeout`, `requestIdleCallback`, `crypto.randomUUID`, `structuredClone`, `Object.hasOwn`, `Array.at`, and `String.replaceAll`.
- Blur on the bars is prefixed with `-webkit-`. On iPhone and iPad the heavy blur is turned off so an A13 stays responsive.
- Home draws a shorter page of posts, and For You ranks a shorter recent slice, on iOS.
- Pictures and video already use lazy loading and async decode. `content-visibility` is a hint where WebKit understands it.
- Media recording asks for MP4 before WebM. iOS records MP4 and does not record WebM.
- HEIC and HEIF stay the original file. The app does not draw them through a canvas.
- File pickers that accept images also accept `.heic` and `.heif`.
- Copy already falls back to a text field if the clipboard API refuses.
- Share uses the system sheet when the browser offers it.
- Vibration is skipped when the device has none. iOS never vibrates from the page.
- Passkeys drop the newer `hints` field and try again when WebKit rejects it.
- The cache for saved media is 48 MB on iPhone and iPad, and 150 MB elsewhere.
- An installed app asks the browser to persist storage. A tab shows one note about the 7-day wipe.

## Known limits

- Safari in a tab can delete localStorage, IndexedDB, and the cache after about 7 days without a visit. Add to Home Screen avoids that. The app cannot turn the timer off.
- Web Push exists only in the installed app on iOS 16.4 or newer. There is no push in a Safari tab, and no vibration.
- Picture in picture and the fullscreen API depend on a user tap and on the video allowing them. A cross-origin player may refuse.
- Autoplay of sound is blocked. Video starts muted and inline.
- `requestIdleCallback` is missing on older Safari. Work runs on a short timer instead, so it is not as idle as on Chrome.
- The structured-clone stand-in copies plain data, dates, and arrays. It does not copy functions or class instances.
- Date and time fields use the system control. It is tall and does not match the text field.
- Live Spaces and some embeds need a newer WebKit media stack. iOS 15 may only show the poster.
- The WebKit tests use a current engine at iPhone 11 and iPad sizes. They do not boot iOS 15 itself.

## What to try on a real iPhone

1. Open the site in Safari. Confirm the bottom bar sits above the home indicator and a focused field does not zoom the page.
2. Type in Search and in the composer with the keyboard open. The bottom bar should leave the field visible.
3. Pull down at the top of Home. The browser should not reload the page.
4. Add to Home Screen from the Share sheet. The splash should match the phone, and the status bar should sit over the black page.
5. Leave the installed app for a day and confirm drafts and the signed-in session are still there.
6. In the installed app on iOS 16.4 or newer, turn on notifications for an account. In a Safari tab, the same control should explain that the installed app is required.
7. Add a HEIC photo from the library and record a short clip. The photo should stay HEIC and the clip should play.
8. Scroll a long Home timeline and open Stories, a profile, Settings, and the side menu. It should stay responsive on an iPhone 11.
