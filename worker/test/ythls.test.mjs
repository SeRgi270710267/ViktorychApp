import test from "node:test";
import assert from "node:assert/strict";

import { targetHostOk, rewritePlaylist } from "../src/ythls.js";

test("the relay allowlists googlevideo and the manifest path only", () => {
  assert.equal(targetHostOk("rr5---sn-x.googlevideo.com", "/videoplayback/x"), true);
  assert.equal(targetHostOk("www.youtube.com", "/api/manifest/hls_playlist/index.m3u8"), true);
  assert.equal(targetHostOk("www.youtube.com", "/api/timeline.json"), false);
  assert.equal(targetHostOk("xyz.example.com", "/api/manifest/hls_playlist/index.m3u8"), false);
  assert.equal(targetHostOk("yt.chocolatemoo53.com", "/latest_version?id=abc"), true);
});

test("the manifest rewrite routes every nested url through the worker", () => {
  const base = "https://yt.chocolatemoo53.com/api/manifest/hls_variant/x/file/index.m3u8";
  const origin = "https://viktorych-accounts.example.workers.dev";
  const body = [
    "#EXTM3U",
    '#EXT-X-MEDIA:URI="https://www.youtube.com/api/manifest/hls_playlist/itag/140/index.m3u8",TYPE=AUDIO,NAME="Default"',
    "https://www.youtube.com/api/manifest/hls_playlist/itag/229/index.m3u8",
    "https://bad.host.example/videoplayback/naughty.m3u8",
  ].join("\n");
  const out = rewritePlaylist(body, base, origin);
  const lines = out.split("\n");
  assert.match(lines[1], /URI="https:\/\/viktorych-accounts\.example\.workers\.dev\/v1\/yt\/media\?url=/);
  assert.match(lines[2], /^https:\/\/viktorych-accounts\.example\.workers\.dev\/v1\/yt\/media\?url=/);
  assert.equal(lines[3], "https://bad.host.example/videoplayback/naughty.m3u8"); // foreign host passes through untouched
  assert.ok(!lines[3].startsWith("https://worker") || !lines[3].includes("bad.host"));
});

test("googlevideo chunk lines are proxied too", () => {
  const body = ["#EXTM3U", "#EXTINF:5.24,", "https://rr4---sn-x.googlevideo.com/videoplayback/id/x/seg.ts"].join("\n");
  const out = rewritePlaylist(body, "https://yt.chocolatemoo53.com/x.m3u8", "https://worker.example");
  assert.match(out.split("\n")[2], /^https:\/\/worker\.example\/v1\/yt\/media\?url=/);
});
