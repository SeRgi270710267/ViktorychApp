import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  admitUpload,
  acceptSwarmMessage,
  canonicalSwarmKey,
  factsFromConnection,
  loaderDecision,
  peerEnabled,
  playlistAnchors,
  sha256Hex,
  swarmIdFor,
  swarmVerdict,
  UPLOAD_DEFAULT,
  verifySegment,
  worthPeer
} from "../shared/peer-media.js";
import { patchDevicePerformance, peerSettings } from "../shared/device-performance.js";
import "../shared/mirror.js";

const require = createRequire(import.meta.url);
const storage = require("../storage.js");
const mirror = globalThis.ViktorychMirror;

const desktop = { desktop: true, unmetered: true, metered: false, saveData: false, batteryLow: false };
const phoneData = { desktop: false, unmetered: false, metered: true, saveData: false, batteryLow: false };

test("a failed peer falls back to origin", () => {
  const decision = loaderDecision({
    enabled: true,
    have: true,
    peerResult: { timeout: true }
  });
  assert.equal(decision.source, "origin");
  assert.equal(decision.peerAttempted, true);
  assert.equal(decision.use, false);
  assert.equal(decision.rejected, false);
  const missed = loaderDecision({ enabled: true, have: true, peerResult: { miss: true } });
  assert.equal(missed.source, "origin");
  assert.equal(missed.peerAttempted, true);
});

test("a hash mismatch is rejected", async () => {
  const bytes = new TextEncoder().encode("segment-bytes");
  const actual = await sha256Hex(bytes);
  const wrong = "ab".repeat(32);
  const verdict = verifySegment(bytes, { sha256: wrong, actualSha: actual, size: bytes.byteLength });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "hash");
  assert.equal(verdict.share, false);
  const decision = loaderDecision({
    enabled: true,
    have: true,
    peerResult: { bytes: bytes },
    verdict: verdict
  });
  assert.equal(decision.source, "origin");
  assert.equal(decision.rejected, true);
  assert.equal(decision.use, false);
  const good = verifySegment(bytes, { sha256: actual, actualSha: actual, size: bytes.byteLength });
  assert.equal(good.ok, true);
  assert.equal(good.share, true);
  const unanchored = verifySegment(bytes, {});
  assert.equal(unanchored.ok, false);
  assert.equal(unanchored.reason, "unanchored");
});

test("turning peer media off makes no peer attempt", () => {
  const gate = peerEnabled({ peerMedia: "off", profile: "max" }, desktop);
  assert.equal(gate.on, false);
  assert.equal(gate.reason, "off");
  const decision = loaderDecision({
    enabled: gate.on,
    have: true,
    peerResult: { bytes: new Uint8Array([1, 2, 3]) },
    verdict: { ok: true }
  });
  assert.equal(decision.source, "origin");
  assert.equal(decision.peerAttempted, false);
  assert.equal(decision.use, false);
});

test("defaults follow the performance profile and the connection", () => {
  assert.equal(peerEnabled({ profile: "max", peerMedia: "auto" }, desktop).on, true);
  assert.equal(peerEnabled({ profile: "max", peerMedia: "auto" }, phoneData).on, false);
  assert.equal(peerEnabled({ profile: "balanced", peerMedia: "auto" }, desktop).on, true);
  assert.equal(peerEnabled({ profile: "balanced", peerMedia: "auto" }, { desktop: false, unmetered: true, metered: false }).on, false);
  assert.equal(peerEnabled({ profile: "max", peerMedia: "auto" }, { desktop: true, unmetered: true, saveData: true, metered: true }).on, false);
  assert.equal(peerEnabled({ profile: "max", peerMedia: "auto" }, { desktop: true, unmetered: true, batteryLow: true }).on, false);
  assert.equal(peerEnabled({ profile: "lite", peerMedia: "auto" }, desktop).on, false);
  assert.equal(peerEnabled({ peerMedia: "on", profile: "lite" }, phoneData).on, true);
  const settings = peerSettings({});
  assert.equal(settings.peerMedia, "auto");
  assert.equal(settings.peerUploadCap, UPLOAD_DEFAULT);
  assert.equal(settings.peerShareWhileWatching, true);
  assert.equal(settings.profile, "balanced");
});

test("upload cap and share-while-watching hold the line", () => {
  const idle = admitUpload({ at: 1000, used: 0 }, 100, 1500, { cap: 65536, watching: false, shareWhileWatching: true, visible: true });
  assert.equal(idle.ok, false);
  assert.equal(idle.reason, "idle");
  const first = admitUpload({ at: 0, used: 0 }, 40000, 5000, { cap: 65536, watching: true, shareWhileWatching: true, visible: true });
  assert.equal(first.ok, true);
  const second = admitUpload(first.bucket, 40000, 5200, { cap: 65536, watching: true, shareWhileWatching: true, visible: true });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "cap");
  const hidden = admitUpload({ at: 1000, used: 0 }, 10, 1100, { watching: true, visible: false });
  assert.equal(hidden.reason, "hidden");
});

test("signaling rejects media bytes and relay candidates", () => {
  assert.equal(swarmVerdict({ op: "data", id: "abcd" }).action, "close");
  assert.equal(swarmVerdict({ op: "hello", bytes: "nope" }).action, "close");
  assert.equal(acceptSwarmMessage({ op: "get", id: "aa" }), null);
  const sha = "cd".repeat(32);
  const have = acceptSwarmMessage({ op: "have", items: [{ id: sha, sha256: sha, size: 1200 }] });
  assert.equal(have.items.length, 1);
  const relay = acceptSwarmMessage({ op: "signal", to: "abcdef01", signal: { type: "ice", candidate: "candidate:1 1 UDP 1 203.0.113.5 9 typ relay" } });
  assert.equal(relay, null);
  const ice = acceptSwarmMessage({
    op: "signal",
    to: "abcdef01",
    signal: { type: "ice", candidate: "candidate:1 1 UDP 1 203.0.113.5 9 typ host", sdpMid: "0", sdpMLineIndex: 0 }
  });
  assert.equal(ice.signal.sdpMLineIndex, 0);
});

test("swarm keys ignore signed queries and skip radio and playlists", async () => {
  const left = canonicalSwarmKey("https://cdn.example/live/a/seg-1.m4s?token=secret");
  const right = canonicalSwarmKey("https://cdn.example/live/a/index.m3u8");
  assert.equal(left, right);
  assert.equal(await swarmIdFor("https://cdn.example/live/a/seg-1.m4s?token=secret"), await swarmIdFor("https://cdn.example/live/a/seg-2.m4s?X-Amz-Signature=abc"));
  assert.equal(worthPeer("https://cdn.example/live/a/seg-1.m4s"), true);
  assert.equal(worthPeer("https://cdn.example/loop/hour.m4s"), false);
  assert.equal(worthPeer("https://cdn.example/live/a/index.m3u8"), false);
  assert.equal(worthPeer("https://cdn.example/clip.mp4", 1000), false);
  assert.equal(worthPeer("https://cdn.example/clip.mp4", 300000), true);
});

test("playlist tags become size or hash anchors", () => {
  const text = [
    "#EXTM3U",
    "#EXT-X-BYTERANGE:400",
    "part.m4s",
    "#EXT-X-VIKTORYCH-SHA256:" + "ab".repeat(32),
    "next.m4s"
  ].join("\n");
  const rows = playlistAnchors(text, "https://cdn.example/live/a/index.m3u8");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].size, 400);
  assert.equal(rows[0].url, "https://cdn.example/live/a/part.m4s");
  assert.equal(rows[1].sha256, "ab".repeat(32));
});

test("settings patch keeps unknown performance keys", () => {
  const next = patchDevicePerformance({ profile: "max", themeHint: "dim", peerMedia: "auto" }, { peerMedia: "off", peerUploadCap: 32768 });
  assert.equal(next.themeHint, "dim");
  assert.equal(next.profile, "max");
  assert.equal(next.peerMedia, "off");
  assert.equal(next.peerUploadCap, 32768);
});

test("same-origin media retry backs off and does not retry a block", () => {
  assert.equal(mirror.failoverStatus(429), true);
  assert.equal(mirror.retryableStatus(429), false);
  assert.equal(mirror.retryableStatus(401), false);
  assert.equal(mirror.retryableStatus(404), false);
  assert.equal(mirror.retryableStatus(451), false);
  assert.equal(mirror.retryableStatus(503), true);
  assert.equal(mirror.retryableStatus(0), true);
  assert.equal(mirror.retryDelay(0, 0), 200);
  assert.equal(mirror.retryDelay(1, 0), 400);
  assert.equal(mirror.retryDelay(2, 0), -1);
  assert.equal(mirror.retryDelay(0, 1), 400);
});

test("a ranged media response can be cached without fetching that key", () => {
  const key = storage.rangeCacheUrl("https://cdn.example/live/a/seg.m4s?token=1", "bytes=0-99");
  assert.match(key, /vkrange=0-99/);
  assert.equal(key.indexOf("token=1") >= 0, true);
  assert.equal(storage.rangeCacheUrl("https://cdn.example/live/a/seg.m4s", "bytes=0-"), "");
  assert.equal(storage.cacheableRange("bytes=0-99", 100), true);
  assert.equal(storage.cacheableRange("bytes=0-", 100), false);
});

test("connection facts treat cellular and save-data as metered", () => {
  const wifi = factsFromConnection({ type: "wifi", effectiveType: "4g" }, { ua: "Mozilla/5.0 (Macintosh)", saveData: false });
  assert.equal(wifi.desktop, true);
  assert.equal(wifi.unmetered, true);
  const cell = factsFromConnection({ type: "cellular", effectiveType: "4g" }, { ua: "Mozilla/5.0 (iPhone)" });
  assert.equal(cell.metered, true);
  assert.equal(cell.desktop, false);
});
