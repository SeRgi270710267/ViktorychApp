import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { assertNotPaidX } from "../src/x-guard.js";
import {
  X_API_POSTING_FREE,
  buildIntentUrl,
  choosePostPath,
  classifyMedia,
  composeWeight,
  dispatchPost,
  isIntentUrl,
  nextPollDelay,
  oauthAuthorize,
  oauthExchange,
  parseTweet,
  partialNotesFromReplies,
  pkceChallenge,
  pkceVerifier,
  planPost,
  pollsSupported,
  scheduleSupported,
  sharePlan
} from "../../shared/x-compose.js";

test("weighted length follows twitter-text v3", () => {
  assert.equal(X_API_POSTING_FREE, false);
  assert.equal(parseTweet("hello").weightedLength, 5);
  assert.equal(parseTweet("hello").valid, true);
  assert.equal(parseTweet("a".repeat(280)).valid, true);
  assert.equal(parseTweet("a".repeat(281)).valid, false);
  assert.equal(parseTweet("").valid, false);
  assert.equal(parseTweet("你好").weightedLength, 4);
  assert.equal(parseTweet("😀").weightedLength, 2);
  assert.equal(parseTweet("👨‍👩‍👧‍👦").weightedLength, 2);
  assert.equal(parseTweet("café").weightedLength, 4);
  assert.equal(parseTweet("http://t.co").weightedLength, 23);
  assert.equal(parseTweet("https://example.com/a/very/long/path").weightedLength, 23);
  assert.equal(parseTweet("see https://example.com/a/b now").weightedLength, 31);
  assert.equal(parseTweet("http://a.co http://b.co").weightedLength, 47);
  assert.equal(parseTweet("\uFFFE").valid, false);
  const once = parseTweet("see https://example.com/a now");
  assert.equal(once.urls.length, 1);
  assert.equal(composeWeight({ text: "see https://example.com/a now", url: "https://example.com/a" }), once.weightedLength);
  assert.equal(composeWeight({ text: "hi", hashtags: ["Tag"] }), 7);
  assert.equal(composeWeight({ text: "hi", url: "https://example.com/a", quote: true }), 2);
  assert.equal(composeWeight({ text: "hi", url: "https://example.com/a" }), 25);
});

test("intent url is x.com and never the paid api", () => {
  const url = buildIntentUrl({
    text: "hello world",
    inReplyTo: "900000000000000001",
    url: "https://example.com/a",
    hashtags: ["One", "#Two", "bad tag", "Ok_1"]
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, "https://x.com/intent/post");
  assert.equal(parsed.searchParams.get("text"), "hello world");
  assert.equal(parsed.searchParams.get("in_reply_to"), "900000000000000001");
  assert.equal(parsed.searchParams.get("url"), "https://example.com/a");
  assert.equal(parsed.searchParams.get("hashtags"), "One,Two,Ok_1");
  assert.equal(isIntentUrl(url), true);
  assert.equal(url.includes("api.x.com"), false);
  assert.equal(buildIntentUrl({ text: "hi", inReplyTo: "../" }).includes("in_reply_to"), false);
  assert.equal(buildIntentUrl({ text: "hi", inReplyTo: "abc" }).includes("in_reply_to"), false);
  const inside = buildIntentUrl({ text: "see https://example.com/a", url: "https://example.com/a" });
  assert.equal(new URL(inside).searchParams.get("url"), null);
});

test("posting stays on the intent path", async () => {
  assert.deepEqual(choosePostPath({ apiFree: false, quotaRemaining: 3 }), { mode: "intent", reason: "no-free-api" });
  assert.deepEqual(choosePostPath({ apiFree: true, quotaRemaining: 0 }), { mode: "intent", reason: "quota" });
  assert.deepEqual(choosePostPath({ apiFree: true, quotaRemaining: 3 }), { mode: "api", reason: "ok" });
  const blocked = planPost({ apiFree: true, quotaRemaining: 3, text: "hi" });
  assert.equal(blocked.mode, "intent");
  assert.equal(blocked.reason, "no-free-api");
  assert.equal(blocked.fetched, false);
  assert.equal(isIntentUrl(blocked.url), true);
  const quota = planPost({ apiFree: true, quotaRemaining: 0, text: "hi" });
  assert.equal(quota.mode, "intent");
  assert.equal(quota.reason, "quota");
  let calls = 0;
  const sent = await dispatchPost({
    apiFree: true,
    quotaRemaining: 3,
    text: "hi",
    fetchImpl: () => { calls += 1; throw new Error("must not fetch"); }
  });
  assert.equal(calls, 0);
  assert.equal(sent.fetched, false);
  assert.equal(sent.mode, "intent");
  assert.equal(sent.reason, "no-free-api");
  assert.equal(pollsSupported(), false);
  assert.equal(scheduleSupported(), false);
});

test("oauth pkce math stays disabled", async () => {
  const off = oauthAuthorize({ apiFree: false, clientId: "x", challenge: "c", state: "s" });
  assert.equal(off.enabled, false);
  assert.equal(off.url, "");
  const still = oauthAuthorize({ apiFree: true, clientId: "x", challenge: "c", state: "s" });
  assert.equal(still.enabled, false);
  assert.equal(still.url, "");
  const verifier = pkceVerifier(new Uint8Array(32).fill(7));
  const challenge = await pkceChallenge(verifier);
  const expected = createHash("sha256").update(verifier).digest("base64url");
  assert.equal(challenge, expected);
  let calls = 0;
  const exchanged = await oauthExchange({
    apiFree: true,
    code: "code",
    verifier: verifier,
    fetchImpl: () => { calls += 1; return { json: async () => ({ access_token: "nope", refresh_token: "nope" }) }; }
  });
  assert.equal(calls, 0);
  assert.equal(exchanged.fetched, false);
  assert.equal(exchanged.enabled, false);
  assert.equal(Object.prototype.hasOwnProperty.call(exchanged, "access_token"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(exchanged, "refresh_token"), false);
});

test("partial mention notes use synthetic public replies only", () => {
  const notes = partialNotesFromReplies([
    {
      id: "900000000000000001",
      handle: "beta_reader",
      author: "Beta",
      text: "hello @alpha_reader",
      date: "2026-01-01T00:00:00.000Z",
      avatar: "https://example.com/a.png",
      replyingTo: { handle: "alpha_reader", id: "900000000000000002" }
    },
    {
      id: "900000000000000003",
      handle: "beta_reader",
      author: "Beta",
      text: "nice",
      date: "2026-01-01T00:00:00.000Z",
      replyingTo: { handle: "alpha_reader" }
    },
    {
      id: "900000000000000004",
      handle: "alpha_reader",
      author: "Alpha",
      text: "@alpha_reader self",
      replyingTo: { handle: "alpha_reader" }
    },
    { id: "nope", handle: "beta_reader", text: "@alpha_reader" }
  ], "alpha_reader", "900000000000000002");
  assert.equal(notes.length, 2);
  assert.equal(notes[0].kind, "mention");
  assert.equal(notes[0].mention, true);
  assert.equal(notes[0].partial, true);
  assert.equal(notes[0].id, "xpartial:900000000000000001");
  assert.equal(notes[1].kind, "reply");
  assert.equal(notes[1].partial, true);
  assert.equal(nextPollDelay(0, 429), 30 * 60 * 1000);
  assert.equal(nextPollDelay(30 * 60 * 1000, "backoff"), 60 * 60 * 1000);
  assert.equal(nextPollDelay(6 * 60 * 60 * 1000, 429), 6 * 60 * 60 * 1000);
  assert.equal(nextPollDelay(60 * 60 * 1000, 200), 15 * 60 * 1000);
});

test("media mix and the paid host guard", () => {
  assert.equal(classifyMedia([{ type: "image/png" }, { type: "image/jpeg" }, { type: "image/webp" }, { type: "image/png" }]).ok, true);
  assert.equal(classifyMedia([{ type: "image/png" }, { type: "image/png" }, { type: "image/png" }, { type: "image/png" }, { type: "image/png" }]).ok, false);
  assert.equal(classifyMedia([{ type: "image/gif" }, { type: "image/png" }]).error, "mix");
  assert.equal(classifyMedia([{ type: "video/mp4" }, { type: "image/png" }]).error, "mix");
  assert.deepEqual(sharePlan(2), { intentAttachesFiles: false, needsShareSheet: true, copyText: true });
  assert.equal(sharePlan(0).needsShareSheet, false);
  assert.throws(() => assertNotPaidX("https://api.x.com/2/tweets"), { message: "paid-x-api" });
  assert.throws(() => assertNotPaidX("https://upload.twitter.com/1.1/media/upload.json"), { message: "paid-x-api" });
  assert.doesNotThrow(() => assertNotPaidX("https://api.fxtwitter.com/alpha_reader"));
  assert.doesNotThrow(() => assertNotPaidX("https://x.com/intent/post?text=hi"));
  assert.doesNotThrow(() => assertNotPaidX("not a url"));
});
