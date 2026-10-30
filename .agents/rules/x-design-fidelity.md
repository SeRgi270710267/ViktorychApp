---
trigger: always_on
description: "X.com 1:1 design, speed and onboarding rules for any UI change."
---

# X.com design fidelity and speed

- Match X.com 1:1: timeline, post cards, profiles (tabs such as Posts, Replies, Media, Games), compose, notifications, messages, communities, settings. When in doubt, do what X does.
- Settings subpages: X's back-arrow header and divided rows; native X-style sliders and toggles.
- Phones: X mobile web layout (bottom nav, top tabs). Desktop: X's three-column shell with a sticky right rail and no blank space below it. Black theme.
- Tabs and pills are thin and never grow; long text marquees slowly; names have no length limit.
- Onboarding: one title, at most one line, one button per screen, no pyramid text; stepped setup like iPhone or Windows 11.
- Speed first: local-first, the cached copy shows instantly, no spinner when a cache exists, background refresh, every network call has a timeout, and the UI never locks up. Calm errors with Retry.
- Media is hotlinked or streamed in original quality; never re-encode.
- Every new feature sits behind its own switch (`worker/src/feature-flags.js` + `SERVER_FEATURES` in `app.js`).
- iOS (older iPhones, older Safari) must work. Check mobile and desktop widths.
- UI changes ship with before/after screenshots for the owner that contain no personal data.
