import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  backoffMs,
  checkVerifier,
  decryptJson,
  encryptJson,
  keyFromPin,
  keyFromPrf,
  makeVerifier,
  sensitiveDoc,
  sensitiveStorageKey
} from "../shared/app-lock-crypto.js";

const require = createRequire(import.meta.url);
const privacy = require("../privacy-screen.js");

test("PRF and PIN both encrypt, and the wrong secret does not open it", async () => {
  const prf = crypto.getRandomValues(new Uint8Array(32));
  const key = await keyFromPrf(prf);
  const packed = await encryptJson(key, { draft: "synthetic draft" });
  assert.equal(JSON.stringify(packed).includes("synthetic draft"), false);
  const opened = await decryptJson(key, packed);
  assert.equal(opened.draft, "synthetic draft");
  const other = await keyFromPrf(crypto.getRandomValues(new Uint8Array(32)));
  await assert.rejects(() => decryptJson(other, packed));

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pinKey = await keyFromPin("2468", salt, 1000);
  const verifier = await makeVerifier(pinKey);
  assert.equal(await checkVerifier(pinKey, verifier), true);
  const wrong = await keyFromPin("0000", salt, 1000);
  assert.equal(await checkVerifier(wrong, verifier), false);
  await assert.rejects(() => keyFromPrf(new Uint8Array(16)));
});

test("lockout steps and which local keys are sealed", () => {
  assert.equal(backoffMs(0), 0);
  assert.equal(backoffMs(3), 0);
  assert.equal(backoffMs(4), 5000);
  assert.equal(backoffMs(10), 900000);
  assert.equal(sensitiveStorageKey("viktorychapp-lock-prefs"), false);
  assert.equal(sensitiveStorageKey("viktorychapp-privacy-mode"), false);
  assert.equal(sensitiveStorageKey("superintelapp-lang"), false);
  assert.equal(sensitiveStorageKey("viktorychapp-drafts"), true);
  assert.equal(sensitiveStorageKey("viktorychapp-account-v1"), true);
  assert.equal(sensitiveStorageKey("viktorychapp-accounts-session-v1"), true);
  assert.equal(sensitiveStorageKey("theme"), false);
  assert.equal(sensitiveDoc("note", { category: "messages" }), true);
  assert.equal(sensitiveDoc("note", { category: "media" }), false);
});

test("privacy cover decisions", () => {
  assert.equal(privacy.splitView({ screenWidth: 1000, screenHeight: 2000, windowWidth: 400, windowHeight: 1900 }), true);
  assert.equal(privacy.splitView({ screenWidth: 2000, screenHeight: 1000, windowWidth: 1900, windowHeight: 400 }), true);
  assert.equal(privacy.splitView({ screenWidth: 1920, screenHeight: 1080, windowWidth: 960, windowHeight: 1000 }), true);
  assert.equal(privacy.splitView({ screenWidth: 1920, screenHeight: 1080, windowWidth: 800, windowHeight: 600 }), false);
  assert.equal(privacy.splitView({ screenWidth: 1920, screenHeight: 1080, windowWidth: 1440, windowHeight: 900 }), false);
  assert.equal(privacy.splitView({ screenWidth: 1920, screenHeight: 1080, windowWidth: 1920, windowHeight: 900 }), false);
  assert.equal(privacy.splitView({ screenWidth: 412, screenHeight: 915, windowWidth: 390, windowHeight: 700 }), false);
  assert.equal(privacy.splitView({ screenWidth: 360, screenHeight: 800, windowWidth: 360, windowHeight: 640 }), false);
  assert.equal(privacy.splitView({ screenWidth: 100, screenHeight: 100, windowWidth: 40, windowHeight: 40 }), false);
  assert.equal(privacy.splitView({ screenWidth: 390, screenHeight: 844, windowWidth: 390, windowHeight: 80 }), false);
  assert.equal(privacy.splitView({ screenWidth: 1080, screenHeight: 2400, windowWidth: 1080, windowHeight: 120 }), false);

  assert.deepEqual(privacy.decide({ mode: "off", hidden: true, locked: true }), { cover: false, scope: "off", reason: "" });
  assert.deepEqual(privacy.decide({ mode: "dms", hidden: true, messages: false }), { cover: false, scope: "dms", reason: "" });
  assert.deepEqual(privacy.decide({ mode: "dms", hidden: true, messages: true }), { cover: true, scope: "overlay", reason: "hidden" });
  assert.deepEqual(privacy.decide({ mode: "dms", locked: true, messages: false }), { cover: true, scope: "overlay", reason: "lock" });
  assert.deepEqual(privacy.decide({ mode: "app", blurred: true, focused: false }), { cover: true, scope: "overlay", reason: "blur" });
  assert.deepEqual(privacy.decide({ mode: "app", blurred: true, focused: true }), { cover: false, scope: "app", reason: "" });
  assert.deepEqual(privacy.decide({ mode: "app", printing: true }), { cover: false, scope: "app", reason: "" });
  assert.deepEqual(privacy.decide({ mode: "app", pip: true }), { cover: false, scope: "app", reason: "" });
  assert.deepEqual(privacy.decide({ mode: "app", frozen: true }), { cover: true, scope: "overlay", reason: "freeze" });
  assert.deepEqual(privacy.decide({ mode: "app", split: true }), { cover: false, scope: "app", reason: "" });
  assert.deepEqual(privacy.decide({ mode: "app" }), { cover: false, scope: "app", reason: "" });
  assert.deepEqual(privacy.decide({ mode: "dms", blurred: true, focused: false, messages: true }), { cover: true, scope: "overlay", reason: "blur" });
  assert.deepEqual(privacy.decide({ mode: "dms", blurred: true, focused: false, messages: true, coarse: true }), { cover: false, scope: "dms", reason: "" });
  assert.deepEqual(privacy.decide({ mode: "dms", hidden: true, messages: true, coarse: true }), { cover: true, scope: "overlay", reason: "hidden" });
  assert.deepEqual(privacy.decide({ mode: "app", blurred: true, focused: false, coarse: true }), { cover: false, scope: "app", reason: "" });
});
