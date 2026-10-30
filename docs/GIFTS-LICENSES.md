# Gift and sticker asset licenses (audit)

Audit of every asset used by gifts, stickers, limited editions and the store, done on 2026-10-29. Each row says where the asset came from and whether we may sell it for money. Where we could not verify something, this file says so.

Verdicts:

- **SAFE TO SELL**: our own work, or a license that allows commercial use with nothing more to do.
- **NEEDS ATTRIBUTION**: commercial use is allowed, but only with the credit line shown.
- **NOT SAFE**: copies or close imitations of another company's gifts, trademarks or characters.

## Summary

| Group | Count | Origin | License | Verdict |
|---|---|---|---|---|
| Illustrated gift and sticker art, `icons/gifts/*.webp` | 75 | AI-generated with an image model for this project (#346); the model and its terms were not recorded | No third-party license; see the caveats below | SAFE TO SELL, with caveats |
| Gifts without own art: static Noto Emoji PNG, hotlinked from jsDelivr | 69 | Google Noto Emoji v2.047 | Apache 2.0 | Commercial use allowed. **Not sold for money** (Viktorychs only) until they get original art |
| Animated previews in the send sheet, hotlinked from Google Fonts | 126 gifts (only where a gift has no own art, or as a fallback) | Noto Animated Emoji | CC BY 4.0 | NEEDS ATTRIBUTION (credit is in the page footer and LICENSES-ART.md) |
| UI icons in `gifts-ui.js` (search, close, back, category icons, wrapped-gift cake, premium gem) | 15 | Single-path 24×24 SVGs written in code for this project (#331); the commit history shows no source set | Ours | SAFE (these are UI, not sold) |
| Fallback emoji character | n/a | The device's own emoji font (Apple, Google, Samsung and so on), drawn by the OS | Not shipped by us | Shown only as a fallback. Never sold |
| Fonts | n/a | No font is bundled for gifts. The stack names TwitterChirp first, but no Chirp file is shipped or loaded, so devices fall back to system fonts. Inter (OFL 1.1) is bundled only for the wordmark | n/a | SAFE |
| Lottie or JSON animations, sounds | 0 | None exist | n/a | n/a |

No asset is copied from Telegram, X, VK or any other platform's gifts, and no trademark or licensed character is used. Several gift *concepts* are common objects that Telegram's standard gifts also use, such as a teddy bear, gift box, rose, cake, bouquet, rocket, trophy, ring and diamond. A shared everyday object is not a copy. Our pictures are drawn in a different (glossy 3D sticker) style and no Telegram artwork was used as a reference, so we rate them SAFE. The owner should still give them a visual check before launch.

## Caveats on the AI-generated art

- The image model and prompts were not recorded when the art was added in #346, so we cannot cite the generator's terms. Most commercial image models assign output rights to the user, but that should be confirmed for the model actually used.
- In many places, including under current US Copyright Office guidance, purely AI-generated images cannot be registered for copyright. We may sell them, but we probably cannot stop others from copying them. Human editing on top makes our claim stronger.
- AI models can reproduce well-known designs by accident. All 75 images were reviewed by eye on 2026-10-29, and none shows a logo, trademark, a known character, or a recognisable copy of another platform's gift. `heart_eyes` and `blow_kiss` are yellow smiley faces, a generic emoji concept, drawn in our own 3D style. `monkey` uses the generic "see no evil" pose. `skull` is a generic sugar skull. These are generic ideas, not copies, so the risk is low.
- If the owner wants zero doubt, redraw or commission the premium and limited items (crown, Founders' crown, golden unicorn, gem, ring and so on) with a written license from the artist.

## Every illustrated asset (`icons/gifts/<id>.webp`, 256 px WebP)

All rows: origin AI-generated for this project (#346), no third-party license, no look-alike found. Verdict SAFE TO SELL (with the caveats above). Money purchases are allowed.

| id | Also used in |
|---|---|
| alien_monster | gift, sticker pack spooky |
| balloon | gift, sticker pack party |
| bat | gift, sticker pack spooky |
| bear | gift |
| beating_heart | gift, sticker pack love |
| black_cat | gift, sticker pack spooky |
| blow_kiss | gift, sticker pack love |
| bouquet | gift |
| cake | gift, sticker pack party |
| candle | gift, sticker pack party |
| candy | gift |
| cat_love | gift, sticker pack love |
| cat_smile | gift, sticker pack starter |
| chestnut | gift |
| chipmunk | gift, sticker pack critters |
| comet | gift, sticker pack royal |
| crown | gift, sticker pack royal, limited crown_founders |
| crystal_ball | gift, sticker pack royal |
| cupid | gift, sticker pack love |
| dog | gift |
| doughnut | gift, sticker pack party |
| fox | gift, sticker pack critters |
| frog | gift, sticker pack critters |
| gem | gift, sticker pack royal |
| ghost | gift, sticker pack spooky |
| gift_heart | gift, sticker pack love |
| hamster | gift, sticker pack critters |
| heart | gift, sticker pack love |
| heart_eyes | gift, sticker pack starter |
| hedgehog | gift, sticker pack critters |
| hot_drink | gift, sticker pack party |
| hug | gift, sticker pack starter |
| imp | gift, sticker pack spooky |
| kiss | gift, sticker pack love |
| koala | gift, sticker pack critters |
| leaf | gift |
| lion | gift, sticker pack royal |
| lollipop | gift, sticker pack party |
| love_letter | gift, sticker pack love |
| magic_wand | gift, sticker pack royal |
| maple | gift |
| monkey | gift |
| mushroom | gift |
| octopus | gift |
| otter | gift, sticker pack critters |
| panda | gift, sticker pack critters |
| party_popper | gift, sticker pack starter, sticker pack party |
| penguin | gift, sticker pack critters |
| pie | gift |
| poodle | gift |
| present | gift, sticker pack party |
| pumpkin | gift, sticker pack spooky, limited pumpkin_2026 |
| ring | gift, sticker pack royal |
| rocket | gift, sticker pack royal |
| rose | gift, sticker pack love |
| seal | gift, sticker pack critters |
| skull | gift, sticker pack spooky |
| sloth | gift, sticker pack critters |
| snowman | gift |
| spark | gift, sticker pack party |
| sparkling_heart | gift, sticker pack love |
| spider | gift, sticker pack spooky |
| star | gift, sticker pack party |
| sunflower | gift |
| thanks | gift, sticker pack starter |
| trophy | gift, sticker pack royal |
| turtle | gift, sticker pack critters |
| two_hearts | gift, sticker pack starter |
| umbrella | gift |
| unicorn | gift, sticker pack royal, limited unicorn_gold |
| vampire | gift, sticker pack spooky |
| web | gift, sticker pack spooky |
| witch_broom | gift, sticker pack spooky |
| xmas_tree | gift |
| zombie | gift, sticker pack spooky |

## Every gift that still uses Noto Emoji

Static image: `https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2.047/png/512/emoji_u<codepoint>.png`, Apache 2.0, Copyright 2013 Google LLC. Animated image (rows marked *anim*): Noto Animated Emoji, CC BY 4.0, Google LLC. Both licenses allow commercial use. To keep the rule "only our own art is sold", these gifts **cannot be bought with money**. `storeItem()` prices them at 0 cents, and `worker/test/store.test.mjs` checks this. They can still be sent with Viktorychs. Verdict: SAFE (Apache 2.0) / NEEDS ATTRIBUTION (animated, CC BY 4.0). Not sold.

| id | codepoint | anim |
|---|---|---|
| santa | U+1F385 |  |
| snowflake | U+2744 U+FE0F | yes |
| deer | U+1F98C |  |
| bell | U+1F514 | yes |
| mitten_socks | U+1F9E6 | yes |
| fireworks | U+1F386 | yes |
| sparkler | U+1F387 |  |
| champagne | U+1F37E | yes |
| cheers | U+1F942 | yes |
| alarm_clock | U+23F0 | yes |
| mirror_ball | U+1FAA9 | yes |
| tulip | U+1F337 | yes |
| hyacinth | U+1FABB | yes |
| hatching_chick | U+1F423 | yes |
| egg | U+1F95A |  |
| rabbit | U+1F407 | yes |
| baby_chick | U+1F424 | yes |
| butterfly | U+1F98B | yes |
| ladybug | U+1F41E | yes |
| bee | U+1F41D | yes |
| sprout | U+1F331 | yes |
| rainbow | U+1F308 | yes |
| blossom | U+1F33C | yes |
| strawberry | U+1F353 | yes |
| sun | U+1F31E | yes |
| watermelon | U+1F349 | yes |
| ice_cream | U+1F366 | yes |
| tropical_drink | U+1F379 | yes |
| wave_sea | U+1F30A | yes |
| dolphin | U+1F42C | yes |
| sailboat | U+26F5 | yes |
| heart_face | U+1F970 | yes |
| revolving_hearts | U+1F49E | yes |
| fire_heart | U+2764 U+FE0F U+200D U+1F525 | yes |
| heart_hands | U+1FAF6 | yes |
| love_you | U+1F91F | yes |
| pink_heart | U+1FA77 | yes |
| cherry_blossom | U+1F338 | yes |
| lotus | U+1FAB7 | yes |
| hibiscus | U+1F33A |  |
| clover | U+1F340 | yes |
| hugging | U+1FAC2 | yes |
| clap | U+1F44F | yes |
| thumbs_up | U+1F44D | yes |
| raising_hands | U+1F64C | yes |
| salute | U+1FAE1 | yes |
| blush | U+1F60A | yes |
| touched | U+1F979 | yes |
| handshake | U+1F91D | yes |
| hundred | U+1F4AF | yes |
| wave | U+1F44B | yes |
| confetti | U+1F38A | yes |
| partying_face | U+1F973 | yes |
| star_struck | U+1F929 | yes |
| gold_medal | U+1F947 | yes |
| pinata | U+1FA85 | yes |
| cookie | U+1F36A | yes |
| ice_cream_bowl | U+1F368 | yes |
| pizza | U+1F355 | yes |
| bubble_tea | U+1F9CB | yes |
| popcorn | U+1F37F | yes |
| tea | U+1FAD6 | yes |
| cherries | U+1F352 | yes |
| dragon | U+1F409 | yes |
| planet | U+1FA90 | yes |
| galaxy | U+1F30C | yes |
| coin | U+1FA99 | yes |
| peacock | U+1F99A | yes |
| glowing_star | U+1F31F | yes |

## Proposed replacements

Nothing is NOT SAFE, so nothing has to be pulled. To move a Noto gift into the paid store, add an original illustration at `icons/gifts/<id>.webp` and list it in `ART_HUE` in `shared/gift-catalog.js`. Money pricing then turns on by itself. Record the tool and prompt (or the artist and their license) in this file when you do.
