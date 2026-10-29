import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { beatCredit, nextStreak } from "../src/games.js";

let mf;

function workerOptions() {
  return {
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/index.js", import.meta.url)),
    modulesRoot: fileURLToPath(new URL("../..", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: {
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      OWNER_HANDLE: "mirathorn",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000"
    }
  };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.10");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.body) headers.set("content-type", "application/json");
  const res = await mf.dispatchFetch("https://accounts.test" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch (err) { body = { raw: text }; }
  return { status: res.status, body, text };
}

async function signup(ip, handle, name) {
  const created = await call("/v1/signup", {
    method: "POST",
    ip,
    body: { displayName: name, handle }
  });
  assert.equal(created.status, 201, created.text);
  return created.body;
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("beat credit never beats the clock", () => {
  assert.equal(beatCredit(60000, 0, 1000), 60000);
  assert.equal(beatCredit(999999, 0, 1000), 60000);
  assert.equal(beatCredit(60000, 100000, 110000), 12000);
  assert.equal(beatCredit(-5, 0, 1), 0);
});

test("streaks count days in a row", () => {
  assert.deepEqual(nextStreak(null, "2026-10-29"), { streak: 1, changed: true });
  assert.deepEqual(nextStreak({ streak: 3, streak_day: "2026-10-28" }, "2026-10-29"), { streak: 4, changed: true });
  assert.deepEqual(nextStreak({ streak: 3, streak_day: "2026-10-29" }, "2026-10-29"), { streak: 3, changed: false });
  assert.deepEqual(nextStreak({ streak: 9, streak_day: "2026-10-20" }, "2026-10-29"), { streak: 1, changed: true });
});

test("play beats, friend board, playing presence and invites", async () => {
  const ana = await signup("203.0.113.141", "game_ana", "Ana Game");
  const bo = await signup("203.0.113.142", "game_bo", "Bo Game");
  const cy = await signup("203.0.113.143", "game_cy", "Cy Game");
  const anaId = "app:" + ana.account.publicId;
  const boId = "app:" + bo.account.publicId;

  const anon = await call("/v1/games/play", { method: "POST", body: { gameId: "regone", ms: 1000 } });
  assert.equal(anon.status, 401);
  const unknown = await call("/v1/games/play", { method: "POST", token: ana.token, ip: "203.0.113.141", body: { gameId: "nope", ms: 1000 } });
  assert.equal(unknown.status, 400);

  const first = await call("/v1/games/play", { method: "POST", token: ana.token, ip: "203.0.113.141", body: { gameId: "regone", ms: 600000 } });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.body.credited, 60000, "one beat is a minute at most");
  const second = await call("/v1/games/play", { method: "POST", token: ana.token, ip: "203.0.113.141", body: { gameId: "regone", ms: 60000 } });
  assert.ok(second.body.credited <= 5000, "a fast second beat only gets the real time");
  assert.equal(second.body.totalMs, first.body.credited + second.body.credited);

  // Not friends yet: invites are refused and the board is just you.
  const early = await call("/v1/games/invite", { method: "POST", token: ana.token, ip: "203.0.113.141", body: { gameId: "regone", to: bo.account.publicId } });
  assert.equal(early.status, 403);
  let board = await call("/v1/games/board?game=regone", { token: ana.token, ip: "203.0.113.141" });
  assert.equal(board.status, 200, board.text);
  assert.deepEqual(board.body.people.map((p) => p.handle), ["game_ana"]);

  await call("/v1/friends/request", { method: "POST", token: ana.token, ip: "203.0.113.141", body: { targetId: boId } });
  const ok = await call("/v1/friends/accept", { method: "POST", token: bo.token, ip: "203.0.113.142", body: { targetId: anaId } });
  assert.equal(ok.body.status, "friends");

  board = await call("/v1/games/board?game=regone", { token: bo.token, ip: "203.0.113.142" });
  const top = board.body.people[0];
  assert.equal(top.handle, "game_ana", "the friend with more play time is first");
  assert.equal(top.playing, true);
  assert.equal(top.weekMs, second.body.totalMs);
  assert.ok(board.body.people.some((p) => p.me && p.handle === "game_bo"));
  assert.ok(!board.body.people.some((p) => p.handle === "game_cy"), "strangers are not on the board");

  const presence = await call("/v1/friends/presence", { token: bo.token, ip: "203.0.113.142" });
  assert.equal(presence.status, 200, presence.text);
  const seen = presence.body.friends.find((f) => f.handle === "game_ana");
  assert.ok(seen);
  if (seen.state !== "offline") assert.equal(seen.playing, "ReGone");
  else assert.equal(seen.playing, "", "hidden presence hides the game too");

  const sent = await call("/v1/games/invite", { method: "POST", token: ana.token, ip: "203.0.113.141", body: { gameId: "regone", to: bo.account.publicId } });
  assert.equal(sent.status, 200, sent.text);
  assert.equal(sent.body.sent, true);
  const dup = await call("/v1/games/invite", { method: "POST", token: ana.token, ip: "203.0.113.141", body: { gameId: "regone", to: bo.account.publicId } });
  assert.equal(dup.body.sent, false, "one invite per hour");
  const bell = await call("/v1/notifications", { token: bo.token, ip: "203.0.113.142" });
  const inv = (bell.body.items || []).filter((item) => item.kind === "game_invite");
  assert.equal(inv.length, 1);
  assert.equal(inv[0].hash, "#/games/regone");
  const stranger = await call("/v1/games/invite", { method: "POST", token: cy.token, ip: "203.0.113.143", body: { gameId: "regone", to: bo.account.publicId } });
  assert.equal(stranger.status, 403);
});
