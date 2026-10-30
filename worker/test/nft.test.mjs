import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { nftConfig } from "../src/nft.js";
import { FEATURES } from "../src/feature-flags.js";
import { LOCAL_ART } from "../../shared/gift-catalog.js";
import { loadNftUi, metadata, nftArt } from "../../scripts/build_nft_meta.mjs";

const ROOT = new URL("../../", import.meta.url);

test("gift NFTs are off by default and the Worker holds no keys", () => {
  assert.equal(FEATURES.nft.defaultOff, true);
  assert.deepEqual(nftConfig({}), { ready: false });
  assert.deepEqual(nftConfig({ NFT_CONTRACT: "0x123" }), { ready: false }, "bad address");
  assert.deepEqual(nftConfig({ NFT_CONTRACT: "0x" + "Ab".repeat(20), NFT_CHAIN_ID: "1" }), { ready: false }, "only Base or Base Sepolia");
  assert.deepEqual(nftConfig({ NFT_CONTRACT: "0x" + "Ab".repeat(20) }), { ready: true, contract: "0x" + "ab".repeat(20), chainId: 8453 });
  assert.equal(nftConfig({ NFT_CONTRACT: "0x" + "ab".repeat(20), NFT_CHAIN_ID: "84532" }).chainId, 84532);
  const src = readFileSync(new URL("worker/src/nft.js", ROOT), "utf8") + readFileSync(new URL("nft-ui.js", ROOT), "utf8");
  assert.doesNotMatch(src, /private.?key|mnemonic|PRIVATE_KEY/i);
});

test("only our own art (SAFE TO SELL) can become an NFT, in a fixed order", () => {
  const art = nftArt();
  assert.equal(new Set(art).size, art.length, "no duplicates");
  const local = new Set(LOCAL_ART);
  for (const id of art) assert.ok(local.has(id), id + " is our own art");
  const files = readdirSync(new URL("nft/", ROOT)).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, art.length, "one metadata file per art; run node scripts/build_nft_meta.mjs");
  art.forEach((id, index) => {
    const saved = JSON.parse(readFileSync(new URL("nft/" + index + ".json", ROOT), "utf8"));
    assert.deepEqual(saved, metadata(index, id), "nft/" + index + ".json is up to date");
    assert.match(saved.description, /not an investment/);
    assert.match(saved.image_ipfs, /^ipfs:\/\/bafkrei[a-z2-7]{52}$/);
  });
});

test("the mint call is mint(bytes32,uint16) with no payment", async () => {
  const ui = loadNftUi();
  const key = await ui.tokenKey("gift-1", "crown");
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(key, await ui.tokenKey("gift-1", "crown"), "stable");
  assert.notEqual(key, await ui.tokenKey("gift-2", "crown"));
  const data = ui.mintData(key, 16);
  assert.equal(data, "0xe9dbe8d5" + key + "0".repeat(62) + "10");
  assert.equal(ui.validConfig({ ready: true, contract: "0x" + "ab".repeat(20), chainId: 8453 }) !== null, true);
  assert.equal(ui.validConfig({ ready: false }), null);
  assert.equal(ui.validConfig({ contract: "0x" + "ab".repeat(20), chainId: 1 }), null);
  assert.equal(ui.buttonHtml({ id: "g1", art: "crown" }), "", "no button while the feature is off");
});
