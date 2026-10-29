# Third-party art

## Gift art (Gifts page, `shared/gift-catalog.js`)

The Gifts page draws every gift from Google's Noto Emoji. The images are
hotlinked, not copied into this repository, and are shown unmodified.
Nothing on the Gifts page reuses VK's gift artwork.

| Use | Source | License |
|-----|--------|---------|
| Shelf, grid, history and post tiles (static PNG, 512 px) | Noto Emoji v2.047, `png/512/` via jsDelivr: `https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2.047/png/512/emoji_u<codepoint>.png` | Apache License 2.0. Copyright 2013 Google LLC. https://github.com/googlefonts/noto-emoji (README, "License": image resources are Apache 2.0) |
| Send sheet preview (animated WebP, 512 px), where the emoji is animated | Noto Animated Emoji from Google Fonts: `https://fonts.gstatic.com/s/e/notoemoji/latest/<codepoint>/512.webp` | Creative Commons Attribution 4.0 International (CC BY 4.0), Google LLC. https://googlefonts.github.io/noto-emoji-files/ and https://creativecommons.org/licenses/by/4.0/ |

If an image fails to load, the page falls back from animated to static, then
to the device's own emoji character.

The page footer carries a short attribution line, and this file holds the full
notice.

## Emoji picker data

`data/emoji.json` lists emoji and their English names from the Unicode emoji test data (emoji-test.txt, Unicode 15.1 and earlier), used under the Unicode License (https://www.unicode.org/license.txt). The emoji are drawn by the device font; no image assets are shipped.
