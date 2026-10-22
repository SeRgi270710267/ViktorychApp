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
import {
  captureFromParts,
  createSha256,
  duplicateHash,
  groupPhotos,
  isMediaFile,
  scrubFromGroups,
  sha256Hex
} from "../shared/drive-photos.js";

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

assert.equal(sha256Hex(new Uint8Array()), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
assert.equal(sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
const hasher = createSha256();
hasher.update(new TextEncoder().encode("ab"));
hasher.update(new TextEncoder().encode("c"));
assert.equal(hasher.hex(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
const sample = crypto.getRandomValues(new Uint8Array(1000));
const subtle = Buffer.from(await crypto.subtle.digest("SHA-256", sample)).toString("hex");
assert.equal(sha256Hex(sample), subtle);

assert.equal(isMediaFile({ type: "image/jpeg", name: "a.jpg" }), true);
assert.equal(isMediaFile({ type: "", name: "roll.HEIC" }), true);
assert.equal(isMediaFile({ type: "video/mp4", name: "clip.mp4" }), true);
assert.equal(isMediaFile({ type: "text/plain", name: "notes.txt" }), false);
assert.equal(duplicateHash([{ deletedAt: 0, meta: { photo: true, hash: "abc" } }], "abc").meta.hash, "abc");
assert.equal(duplicateHash([{ deletedAt: 5, meta: { photo: true, hash: "abc" } }], "abc"), null);
assert.equal(duplicateHash([{ deletedAt: 0, meta: { hash: "abc" } }], "abc"), null);

const photoMeta = await encryptJson(item.key, {
  name: "shore.jpg",
  photo: true,
  hash: sha256Hex(sample),
  captured: Date.UTC(2024, 4, 9, 14, 30, 0),
  width: 1024,
  height: 1536,
  albums: ["album-trips"]
});
const photoWire = JSON.stringify({ meta: photoMeta.ciphertext, metaIv: photoMeta.iv });
assert.equal(photoWire.includes("shore.jpg"), false);
assert.equal(photoWire.includes("album-trips"), false);

function jpegWithExif() {
  const date = [0x32, 0x30, 0x32, 0x34, 0x3a, 0x30, 0x35, 0x3a, 0x30, 0x39, 0x20, 0x31, 0x34, 0x3a, 0x33, 0x30, 0x3a, 0x30, 0x30, 0x00];
  const gps = Array.from("SECRET-GPS").map((ch) => ch.charCodeAt(0)).concat([0]);
  const tiff = [];
  const push = (bytes) => bytes.forEach((b) => tiff.push(b));
  push([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
  push([0x02, 0x00]);
  push([0x03, 0x90, 0x02, 0x00, 0x14, 0x00, 0x00, 0x00, 0x26, 0x00, 0x00, 0x00]);
  push([0x25, 0x88, 0x02, 0x00, gps.length, 0x00, 0x00, 0x00, 0x3a, 0x00, 0x00, 0x00]);
  push([0x00, 0x00, 0x00, 0x00]);
  push(date);
  push(gps);
  const app = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00].concat(tiff);
  const length = app.length + 2;
  const sof = [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x04, 0x00, 0x06, 0x00, 0x01, 0x01, 0x11, 0x00];
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (length >> 8) & 255, length & 255].concat(app, sof, [0xff, 0xd9]));
}

const jpeg = jpegWithExif();
assert.equal(new TextDecoder().decode(jpeg).includes("SECRET-GPS"), true);
const shot = captureFromParts(jpeg, new Uint8Array());
assert.equal(new Date(shot.captured).getFullYear(), 2024);
assert.equal(new Date(shot.captured).getMonth(), 4);
assert.equal(new Date(shot.captured).getDate(), 9);
assert.equal(new Date(shot.captured).getHours(), 14);
assert.equal(new Date(shot.captured).getMinutes(), 30);
assert.equal(shot.width, 1536);
assert.equal(shot.height, 1024);
assert.equal(JSON.stringify(shot).includes("SECRET-GPS"), false);

const epoch = Date.UTC(1904, 0, 1);
const taken = Date.UTC(2020, 0, 2, 3, 4, 5);
const seconds = Math.round((taken - epoch) / 1000);
const mvhd = new Uint8Array(108);
mvhd.set([0, 0, 0, 108, 0x6d, 0x76, 0x68, 0x64, 0, 0, 0, 0], 0);
mvhd[12] = (seconds >>> 24) & 255;
mvhd[13] = (seconds >>> 16) & 255;
mvhd[14] = (seconds >>> 8) & 255;
mvhd[15] = seconds & 255;
const tkhd = new Uint8Array(92);
tkhd.set([0, 0, 0, 92, 0x74, 0x6b, 0x68, 0x64], 0);
const widthFixed = 1920 * 65536;
const heightFixed = 1080 * 65536;
tkhd[84] = (widthFixed >>> 24) & 255;
tkhd[85] = (widthFixed >>> 16) & 255;
tkhd[86] = (widthFixed >>> 8) & 255;
tkhd[87] = widthFixed & 255;
tkhd[88] = (heightFixed >>> 24) & 255;
tkhd[89] = (heightFixed >>> 16) & 255;
tkhd[90] = (heightFixed >>> 8) & 255;
tkhd[91] = heightFixed & 255;
const gpsAtom = new Uint8Array([0, 0, 0, 18, 0x6c, 0x6f, 0x63, 0x69].concat(Array.from("SECRET-GPS").map((ch) => ch.charCodeAt(0))));
const moovBody = new Uint8Array(mvhd.length + tkhd.length + gpsAtom.length);
moovBody.set(mvhd, 0);
moovBody.set(tkhd, mvhd.length);
moovBody.set(gpsAtom, mvhd.length + tkhd.length);
const moov = new Uint8Array(8 + moovBody.length);
const moovSize = moov.length;
moov[0] = (moovSize >>> 24) & 255;
moov[3] = moovSize & 255;
moov[1] = (moovSize >>> 16) & 255;
moov[2] = (moovSize >>> 8) & 255;
moov.set([0x6d, 0x6f, 0x6f, 0x76], 4);
moov.set(moovBody, 8);
const video = captureFromParts(new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70]), moov);
assert.equal(video.captured, taken);
assert.equal(video.width, 1920);
assert.equal(video.height, 1080);
assert.equal(JSON.stringify(video).includes("SECRET-GPS"), false);

const groups = groupPhotos(
  [{ id: "new", at: new Date(2026, 9, 22).getTime() }, { id: "old", at: new Date(2026, 0, 14).getTime() }, { id: "mid", at: new Date(2026, 8, 2).getTime() }],
  (row) => row.at
);
assert.deepEqual(groups.map((group) => group.key), ["2026-10-22", "2026-01-14", "2026-09-02"]);
const marks = scrubFromGroups(groups);
assert.equal(marks[0].kind, "year");
assert.equal(marks[0].year, 2026);
assert.equal(marks[1].kind, "month");
assert.equal(marks[1].month, 10);
console.log("drive crypto ok");
