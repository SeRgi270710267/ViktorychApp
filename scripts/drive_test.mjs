import assert from "node:assert/strict";
import {
  DRIVE_CHUNK,
  DRIVE_ITERATIONS,
  DRIVE_MAX_FILE,
  decryptFile,
  decryptJson,
  encryptFile,
  encryptJson,
  fileTooBig,
  newItemKey,
  openItemKey,
  setupVault,
  unlockVault,
  verifyMaster
} from "../shared/drive-crypto.js";

const pass = "correct horse battery";
const vault = await setupVault(pass, 1000);
assert.equal(vault.key.extractable, false);
assert.equal(vault.kdf, "pbkdf2-sha256");
assert.equal(await verifyMaster(vault.key, vault.verifier, vault.verifierIv), true);
const opened = await unlockVault(pass, vault.salt, vault.iterations, vault.verifier, vault.verifierIv);
assert.ok(opened);
assert.equal(await unlockVault("wrong passphrase", vault.salt, vault.iterations, vault.verifier, vault.verifierIv), null);

const item = await newItemKey(opened);
const meta = { name: "secret-notes.txt", mime: "text/plain", size: 40, created: 1 };
const packed = await encryptJson(item.key, meta);
const exported = JSON.stringify({
  wrappedKey: item.wrappedKey,
  wrapIv: item.wrapIv,
  meta: packed.ciphertext,
  metaIv: packed.iv
});
assert.equal(exported.includes("secret-notes"), false);
assert.equal(exported.includes("text/plain"), false);
const back = await decryptJson(await openItemKey(opened, item.wrappedKey, item.wrapIv), packed.iv, packed.ciphertext);
assert.deepEqual(back, meta);

const plain = new Uint8Array(40);
for (let i = 0; i < plain.length; i++) plain[i] = i + 1;
const chunks = await encryptFile(item.key, plain, 16);
assert.equal(chunks.length, 3);
chunks.forEach((part) => {
  assert.equal(part.ciphertext.byteLength, (part.index < 2 ? 16 : 8) + 16);
  assert.ok(part.ciphertext.byteLength < 19 * 1024 * 1024);
});
const round = await decryptFile(item.key, chunks.slice().reverse());
assert.deepEqual(round, plain);

const empty = await encryptFile(item.key, new Uint8Array(0), 16);
assert.equal(empty.length, 1);
assert.equal(empty[0].ciphertext.byteLength, 16);
assert.equal((await decryptFile(item.key, empty)).length, 0);

assert.equal(DRIVE_CHUNK, 18 * 1024 * 1024);
assert.equal(DRIVE_CHUNK + 16 < 19 * 1024 * 1024, true);
assert.equal(DRIVE_ITERATIONS >= 600000, true);
assert.equal(fileTooBig(DRIVE_MAX_FILE), false);
assert.equal(fileTooBig(DRIVE_MAX_FILE + 1), true);
console.log("drive crypto ok");
