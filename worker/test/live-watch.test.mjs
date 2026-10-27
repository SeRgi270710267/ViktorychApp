import assert from "node:assert/strict";
import test from "node:test";
import { fresh, needsUpload, uploaderStale, watchDecision, watchHandles } from "../src/live-watch.js";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const ISO = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

test("the watcher rotates a large directory instead of skipping names", () => {
  const doc = { live: { c_name: {}, a_name: {}, b_name: {}, d_name: {}, e_name: {} } };
  assert.deepEqual(watchHandles(doc, 2, 0), ["a_name", "b_name"]);
  assert.deepEqual(watchHandles(doc, 2, 1), ["c_name", "d_name"]);
  assert.deepEqual(watchHandles(doc, 2, 2), ["e_name", "a_name"]);
  assert.deepEqual(watchHandles({ live: { one: {} } }, 6, 4), ["one"]);
});

test("a fresh dispatch marker stops a second recorder", () => {
  const marker = { roomId: "7699647509498710801", at: ISO(NOW - 60 * 1000) };
  assert.equal(watchDecision({}, marker, "7699647509498710801", NOW).action, "skip");
  const old = { roomId: "7699647509498710801", at: ISO(NOW - 11 * 60 * 1000) };
  assert.equal(watchDecision({}, old, "7699647509498710801", NOW).action, "record");
});

test("a saved room is not recorded again", () => {
  const job = { saved: [{ roomId: "7699647509498710801", key: "tiktok/name/7699647509498710801/live" }] };
  assert.equal(watchDecision(job, {}, "7699647509498710801", NOW).why, "saved");
});

test("a live capture with a fresh heartbeat is left alone", () => {
  const job = { active: { state: "recording", roomId: "7699647509498710801", part: 1, capturing: true, heartbeat: ISO(NOW - 60 * 1000) } };
  assert.equal(watchDecision(job, {}, "7699647509498710801", NOW).action, "skip");
});

test("a dead capture is restarted at the current part", () => {
  const job = { active: { state: "recording", roomId: "7699647509498710801", part: 3, capturing: true, heartbeat: ISO(NOW - 30 * 60 * 1000) } };
  const choice = watchDecision(job, {}, "7699647509498710801", NOW);
  assert.equal(choice.action, "record");
  assert.equal(choice.part, 3);
});

test("a finished part asks for the next part once", () => {
  const job = { active: { state: "recording", roomId: "7699647509498710801", part: 2, needsPart: true, capturing: false, dispatchedAt: ISO(NOW - 60 * 1000) } };
  assert.equal(watchDecision(job, {}, "7699647509498710801", NOW).action, "skip");
  job.active.dispatchedAt = ISO(NOW - 10 * 60 * 1000);
  const choice = watchDecision(job, {}, "7699647509498710801", NOW);
  assert.equal(choice.action, "part");
  assert.equal(choice.part, 2);
});

test("a finished capture waits for the uploader instead of recording again", () => {
  const job = { active: { state: "recording", roomId: "7699647509498710801", part: 1, capturing: false, captureDone: true, segments: 40 } };
  assert.equal(watchDecision(job, {}, "7699647509498710801", NOW).why, "captureDone");
});

test("a different room does not replace a live capture", () => {
  const job = { active: { state: "recording", roomId: "111111111111111111", capturing: true, heartbeat: ISO(NOW - 60 * 1000) } };
  assert.equal(watchDecision(job, {}, "7699647509498710801", NOW).action, "skip");
  job.active.heartbeat = ISO(NOW - 60 * 60 * 1000);
  assert.equal(watchDecision(job, {}, "7699647509498710801", NOW).action, "record");
});

test("a dispatch that never opened its capture waits, then retries", () => {
  const job = { active: { state: "recording", roomId: "7699647509498710801", part: 1, capturing: false, captureDone: false, dispatchedAt: ISO(NOW - 30 * 1000) } };
  assert.equal(watchDecision(job, {}, "7699647509498710801", NOW).why, "waiting");
  job.active.dispatchedAt = ISO(NOW - 11 * 60 * 1000);
  const choice = watchDecision(job, {}, "7699647509498710801", NOW);
  assert.equal(choice.action, "record");
  assert.equal(choice.part, 1);
});

test("a blocked empty capture retries after backoff, and a partial save can resume", () => {
  const stuck = { active: { state: "blocked", roomId: "7699647509498710801", captureDone: true, segments: 0, capturing: false } };
  assert.equal(watchDecision(stuck, {}, "7699647509498710801", NOW).why, "unblocked");
  const waiting = { backoffUntil: ISO(NOW + 60 * 1000), active: { state: "blocked", roomId: "7699647509498710801", captureDone: false, segments: 0 } };
  assert.equal(watchDecision(waiting, {}, "7699647509498710801", NOW).why, "backoff");
  const partial = { saved: [{ roomId: "7699647509498710801", partial: true, parts: 2 }] };
  assert.equal(watchDecision(partial, {}, "7699647509498710801", NOW).why, "partial");
  assert.equal(watchDecision(partial, {}, "7699647509498710801", NOW).part, 3);
  const done = { saved: [{ roomId: "7699647509498710801", parts: 2 }] };
  assert.equal(watchDecision(done, {}, "7699647509498710801", NOW).why, "saved");
});

test("a blocked pick that left the row unlabeled still retries", () => {
  const job = { active: { state: "recording", roomId: "7699647509498710801", capturing: false, captureDone: false } };
  const choice = watchDecision(job, {}, "7699647509498710801", NOW);
  assert.equal(choice.action, "record");
  assert.equal(choice.why, "retry");
});

test("fresh rejects old and future stamps", () => {
  assert.equal(fresh(ISO(NOW - 1000), NOW, 5000), true);
  assert.equal(fresh(ISO(NOW - 6000), NOW, 5000), false);
  assert.equal(fresh(ISO(NOW + 6000), NOW, 5000), false);
  assert.equal(fresh("", NOW, 5000), false);
});

test("an uploader runs for buffered segments or a live capture, not a bare live flag", () => {
  assert.equal(needsUpload(null, NOW), false);
  assert.equal(needsUpload({ captureDone: true, segments: 0 }, NOW), false);
  assert.equal(needsUpload({ state: "recording", segments: 0, capturing: false }, NOW), false);
  assert.equal(needsUpload({ segments: 4, captureDone: true, capturing: false }, NOW), true);
  assert.equal(needsUpload({ state: "recording", segments: 4, captureDone: false, capturing: false, needsPart: false }, NOW), false);
  assert.equal(needsUpload({ state: "blocked", segments: 4, captureDone: true, capturing: false }, NOW), false);
  assert.equal(needsUpload({ capturing: true, segments: 0, heartbeat: ISO(NOW - 60 * 1000) }, NOW), true);
  assert.equal(needsUpload({ capturing: true, segments: 0, heartbeat: ISO(NOW - 30 * 60 * 1000) }, NOW), false);
});

test("the uploader heartbeat is stale after five quiet minutes", () => {
  assert.equal(uploaderStale({ at: ISO(NOW - 60 * 1000) }, NOW), false);
  assert.equal(uploaderStale({ at: ISO(NOW - 10 * 60 * 1000) }, NOW), true);
  assert.equal(uploaderStale(null, NOW), true);
});
