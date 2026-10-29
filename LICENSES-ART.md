# Third-party art

## Gift art (Gifts page, `shared/gift-catalog.js`)

Most gifts use original illustrations made for this project in
`icons/gifts/<gift id>.webp` (256 px WebP, listed in `LOCAL_ART` in
`shared/gift-catalog.js`). They were generated with an image model, have no
third-party license or attribution requirement, and copy no VK artwork, logos
or trademarks.

Gifts without an illustration yet draw from Google's Noto Emoji. Those images
are hotlinked, not copied into this repository, and are shown unmodified.
Nothing on the Gifts page reuses VK's gift artwork.

| Use | Source | License |
|-----|--------|---------|
| Shelf, grid, history and post tiles (static PNG, 512 px) | Noto Emoji v2.047, `png/512/` via jsDelivr: `https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2.047/png/512/emoji_u<codepoint>.png` | Apache License 2.0. Copyright 2013 Google LLC. https://github.com/googlefonts/noto-emoji (README, "License": image resources are Apache 2.0) |
| Send sheet preview (animated WebP, 512 px), where the emoji is animated | Noto Animated Emoji from Google Fonts: `https://fonts.gstatic.com/s/e/notoemoji/latest/<codepoint>/512.webp` | Creative Commons Attribution 4.0 International (CC BY 4.0), Google LLC. https://googlefonts.github.io/noto-emoji-files/ and https://creativecommons.org/licenses/by/4.0/ |

If an image fails to load, the page falls back from the illustration or the
animated emoji to the static Noto PNG, then
to the device's own emoji character.

The page footer carries a short attribution line, and this file holds the full
notice.
