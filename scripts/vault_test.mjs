import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveMaster,
  setupVault,
  encryptJson,
  decryptJson,
  decryptBytes,
  bytesToB64,
  b64ToBytes
} from "../shared/drive-crypto.js";

// Spotify Embed & Session Helper utilities for Vault
function parseSpotifyEmbed(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  // Check for spotify:track:id or spotify:playlist:id
  const uriMatch = raw.match(/^spotify:(track|playlist|album|artist|episode):([A-Za-z0-9]+)$/);
  if (uriMatch) {
    return `https://open.spotify.com/embed/${uriMatch[1]}/${uriMatch[2]}?utm_source=generator`;
  }
  // Check for https://open.spotify.com/(track|playlist|album|artist)/...
  const urlMatch = raw.match(/open\.spotify\.com\/(track|playlist|album|artist|episode)\/([A-Za-z0-9]+)/);
  if (urlMatch) {
    return `https://open.spotify.com/embed/${urlMatch[1]}/${urlMatch[2]}?utm_source=generator`;
  }
  return "";
}

function maskSecret(secret) {
  const text = String(secret || "");
  if (!text) return "";
  if (text.length <= 4) return "••••";
  return "••••••••••••" + text.slice(-4);
}

test("vault: derives master key and verifies setup verifier", async () => {
  const passphrase = "correct horse battery staple";
  const vault = await setupVault(passphrase, 10000);
  assert.ok(vault.salt);
  assert.ok(vault.verifier);
  assert.ok(vault.verifierIv);

  // Derive master using the saved base64 salt and verify
  const master = await deriveMaster(passphrase, b64ToBytes(vault.salt), 10000);
  const plain = await decryptBytes(master, b64ToBytes(vault.verifierIv), b64ToBytes(vault.verifier));
  const text = new TextDecoder().decode(plain);
  assert.equal(text, "viktorych-drive-v1");
});

test("vault: encrypts and decrypts secret items client-side", async () => {
  const passphrase = "super-secret-vault-password";
  const vault = await setupVault(passphrase, 10000);
  const master = await deriveMaster(passphrase, vault.salt, 10000);

  const sensitiveItem = {
    service: "spotify",
    title: "Family Spotify Account",
    username: "john_doe@example.com",
    secret: "sp_dc_super_long_secret_cookie_token_99999",
    secretType: "cookie",
    loginUrl: "https://open.spotify.com",
    notes: "Remember not to log out on other devices."
  };

  const encrypted = await encryptJson(master, sensitiveItem);
  assert.ok(encrypted.ciphertext);
  assert.ok(encrypted.iv);
  // Ensure the plain secret is NOT visible in the ciphertext
  assert.ok(!encrypted.ciphertext.includes("sp_dc_super_long_secret_cookie_token_99999"));

  const decrypted = await decryptJson(master, encrypted.iv, encrypted.ciphertext);
  assert.deepEqual(decrypted, sensitiveItem);
});

test("vault: share envelope with optional PIN wrapping", async () => {
  // Alice shares an item with Bob protected with PIN "4321"
  const pin = "4321";
  const pinSalt = crypto.getRandomValues(new Uint8Array(16));
  const pinMaster = await deriveMaster(pin, pinSalt, 10000);

  const sharedData = {
    service: "spotify",
    title: "Spotify Shared Access",
    secret: "sp_dc_shared_token_12345",
    loginUrl: "https://open.spotify.com",
    notes: "Shared from Alice"
  };

  const envelope = await encryptJson(pinMaster, sharedData);
  assert.ok(envelope.ciphertext);

  // Bob unlocks with PIN "4321" and pinSalt
  const bobKey = await deriveMaster("4321", pinSalt, 10000);
  const bobDecrypted = await decryptJson(bobKey, envelope.iv, envelope.ciphertext);
  assert.equal(bobDecrypted.secret, "sp_dc_shared_token_12345");

  // Bob trying with wrong PIN fails
  const wrongKey = await deriveMaster("0000", pinSalt, 10000);
  await assert.rejects(async () => {
    await decryptJson(wrongKey, envelope.iv, envelope.ciphertext);
  });
});

test("vault: spotify embed URL parser handles tracks, playlists and albums", () => {
  assert.equal(
    parseSpotifyEmbed("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc"),
    "https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT?utm_source=generator"
  );
  assert.equal(
    parseSpotifyEmbed("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"),
    "https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M?utm_source=generator"
  );
  assert.equal(parseSpotifyEmbed("invalid text"), "");
});

test("vault: maskSecret masks sensitive tokens", () => {
  assert.equal(maskSecret(""), "");
  assert.equal(maskSecret("pass"), "••••");
  assert.equal(maskSecret("long_secret_token_1234"), "••••••••••••1234");
});
