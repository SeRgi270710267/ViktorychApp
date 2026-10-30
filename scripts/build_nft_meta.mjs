// Writes nft/<index>.json, the token metadata for gift NFTs, from the
// append-only art list in nft-ui.js. Run after adding art:
//   node scripts/build_nft_meta.mjs
// Images are served from our own Pages site and are content-addressed: each
// file also gets its IPFS CID (CIDv1, raw, sha256), the same CID that
// `ipfs add --cid-version=1 --raw-leaves` gives, so anyone can pin it for free.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { GIFTS } from "../shared/gift-catalog.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const PAGES = "https://viktorychgroup.github.io/ViktorychApp";

export function loadNftUi(extra) {
  const ctx = vm.createContext(Object.assign({ TextEncoder, crypto: globalThis.crypto }, extra || {}));
  vm.runInContext(readFileSync(ROOT + "nft-ui.js", "utf8"), ctx);
  return ctx.GiftNFT;
}

export function nftArt() {
  return loadNftUi().NFT_ART.slice();
}

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
function base32(bytes) {
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function rawCid(bytes) {
  const digest = createHash("sha256").update(bytes).digest();
  return "b" + base32(Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest]));
}

function title(id) {
  const gift = GIFTS.find((item) => item.id === id);
  if (gift && gift.name) return gift.name;
  return id.split("_").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

export function metadata(index, id) {
  const bytes = readFileSync(ROOT + "icons/gifts/" + id + ".webp");
  const cid = rawCid(bytes);
  return {
    name: "Viktorych gift: " + title(id),
    description: "A collectible copy of a gift from ViktorychApp, made by the person who received it. Original art made for ViktorychApp. A collectible only: not an investment, with no cash value, buy-back or payout from ViktorychApp.",
    image: PAGES + "/icons/gifts/" + id + ".webp",
    external_url: PAGES + "/",
    attributes: [{ trait_type: "Art", value: id }, { trait_type: "Index", value: index }],
    image_ipfs: "ipfs://" + cid,
    image_sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const art = nftArt();
  mkdirSync(ROOT + "nft", { recursive: true });
  art.forEach((id, index) => {
    writeFileSync(ROOT + "nft/" + index + ".json", JSON.stringify(metadata(index, id), null, 2) + "\n");
  });
  console.log("nft metadata: " + art.length + " files");
}
