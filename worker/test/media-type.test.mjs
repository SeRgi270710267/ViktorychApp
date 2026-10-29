import assert from "node:assert/strict";
import test from "node:test";
import { passiveMediaType } from "../src/media-type.js";

test("passive media types pass through", () => {
  assert.equal(passiveMediaType("image/jpeg"), "image/jpeg");
  assert.equal(passiveMediaType("video/mp4"), "video/mp4");
  assert.equal(passiveMediaType("audio/mpeg"), "audio/mpeg");
  assert.equal(passiveMediaType("application/vnd.apple.mpegurl"), "application/vnd.apple.mpegurl");
});

test("active types become an opaque download", () => {
  for (const type of ["text/html", "text/html; charset=utf-8", "image/svg+xml", "application/xhtml+xml", "text/xml", "application/javascript", "", "IMAGE/SVG+XML"]) {
    assert.equal(passiveMediaType(type), "application/octet-stream", type);
  }
});
