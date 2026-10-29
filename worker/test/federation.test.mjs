import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

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
      PBKDF2_ITERATIONS: "1000",
      FEDERATION_HOST: "accounts.test"
    }
  };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.10");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.body) headers.set("content-type", "application/json");
  if (opts.origin) headers.set("Origin", opts.origin);
  const res = await mf.dispatchFetch("https://accounts.test" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch (err) { body = { raw: text }; }
  return { status: res.status, body, text, headers: res.headers };
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
  await mf.getBindings();
  // Nostr is off until the owner turns it on; these tests run with it on.
  const db = await mf.getD1Database("DB");
  await db.prepare("CREATE TABLE IF NOT EXISTS feature_flags (name TEXT PRIMARY KEY, off INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)").run();
  await db.prepare("INSERT INTO feature_flags (name, off, updated_at) VALUES ('nostr', 0, 0)").run();
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("federation: our profiles are never on the fediverse", async () => {
  const user = await signup("203.0.113.80", "AliceFed", "Alice Fed");

  // Even a request to turn ActivityPub on does nothing.
  const asked = await call("/v1/federation/settings", { method: "POST", token: user.token, body: { enabled_ap: true } });
  assert.equal(asked.status, 200);
  assert.equal(asked.body.enabled_ap, undefined);
  assert.equal(asked.body.ap_handle, undefined);

  // No WebFinger, actor, inbox, outbox or followers.
  for (const path of ["/.well-known/webfinger?resource=acct:AliceFed@accounts.test", "/ap/users/AliceFed", "/ap/users/AliceFed/outbox", "/ap/users/AliceFed/followers"]) {
    const res = await call(path, { headers: { accept: "application/activity+json" } });
    assert.equal(res.status, 404, path);
    assert.ok(!/activitystreams|"type"\s*:\s*"Person"/.test(res.text), path);
  }
  const inbox = await call("/ap/users/AliceFed/inbox", { method: "POST", body: { type: "Follow", actor: "https://remote.example/users/bob" } });
  assert.equal(inbox.status, 404);

  // Nostr NIP-05 stays off by default and leaks nothing.
  const nostr = await call("/.well-known/nostr.json?name=AliceFed");
  assert.equal(nostr.status, 200);
  assert.deepEqual(nostr.body.names, {});
  const nostrEmpty = await call("/.well-known/nostr.json");
  assert.deepEqual(nostrEmpty.body.names, {});
  const settings = await call("/v1/federation/settings", { token: user.token });
  assert.equal(settings.status, 200);
  assert.equal(settings.body.enabled_nostr, false);
});

test("federation: Nostr NIP-05 opt-in and npub decoding", async () => {
  const user = await signup("203.0.113.82", "CarolNostr", "Carol Nostr");

  // Opt in to Nostr with npub
  const optIn = await call("/v1/federation/settings", {
    method: "POST",
    token: user.token,
    body: {
      enabled_nostr: true,
      nostr_pubkey: "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m"
    }
  });
  assert.equal(optIn.status, 200);
  assert.equal(optIn.body.enabled_nostr, true);
  // Converted to 32-byte hex
  assert.equal(optIn.body.nostr_pubkey, "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2");

  // NIP-05 lookup on web client with CORS origin
  const nip05 = await call("/.well-known/nostr.json?name=CarolNostr", {
    origin: "https://snort.social"
  });
  assert.equal(nip05.status, 200);
  assert.equal(nip05.body.names.CarolNostr, "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2");

  // Other accounts do not leak
  const nonOpted = await call("/.well-known/nostr.json?name=DaveUnknown");
  assert.equal(nonOpted.status, 200);
  assert.deepEqual(nonOpted.body.names, {});
});

test("federation: Nostr opt-out closes NIP-05 immediately", async () => {
  const user = await signup("203.0.113.83", "EveFed", "Eve Federated");
  await call("/v1/federation/settings", {
    method: "POST",
    token: user.token,
    body: { enabled_nostr: true, nostr_pubkey: "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2" }
  });
  const nostrBefore = await call("/.well-known/nostr.json?name=EveFed");
  assert.ok(nostrBefore.body.names.EveFed);
  const optOut = await call("/v1/federation/settings", { method: "POST", token: user.token, body: { enabled_nostr: false } });
  assert.equal(optOut.status, 200);
  assert.equal(optOut.body.enabled_nostr, false);
  const nostrAfter = await call("/.well-known/nostr.json?name=EveFed");
  assert.equal(nostrAfter.status, 200);
  assert.deepEqual(nostrAfter.body.names, {});
  assert.equal((await call("/.well-known/webfinger?resource=acct:EveFed@accounts.test")).status, 404);
});

test("Nostr links: only the author links a public post, anyone reads it", async () => {
  const author = await signup("203.0.113.90", "LinkAuthor", "Link Author");
  const other = await signup("203.0.113.91", "LinkOther", "Link Other");
  const made = await call("/v1/posts", { method: "POST", token: author.token, body: { body: "Hello relays" } });
  assert.equal(made.status, 201, made.text);
  const id = made.body.post.id;
  const link = { event_id: "e".repeat(64), pubkey: "f".repeat(64) };
  assert.equal((await call("/v1/nostr/posts/" + id)).status, 404);
  assert.equal((await call("/v1/nostr/posts/" + id, { method: "POST", body: link })).status, 401);
  assert.equal((await call("/v1/nostr/posts/" + id, { method: "POST", token: other.token, body: link })).status, 404, "not someone else's post");
  assert.equal((await call("/v1/nostr/posts/" + id, { method: "POST", token: author.token, body: { event_id: "nope", pubkey: link.pubkey } })).status, 400);
  const saved = await call("/v1/nostr/posts/" + id, { method: "POST", token: author.token, body: link });
  assert.equal(saved.status, 200, saved.text);
  const read = await call("/v1/nostr/posts/" + id);
  assert.deepEqual(read.body, link);

  const quiet = await call("/v1/posts", { method: "POST", token: author.token, body: { body: "Friends only", audience: "friends" } });
  assert.equal(quiet.status, 201, quiet.text);
  assert.equal((await call("/v1/nostr/posts/" + quiet.body.post.id, { method: "POST", token: author.token, body: link })).status, 409, "only public posts go to Nostr");

  assert.equal((await call("/v1/nostr/posts/" + id, { method: "DELETE", token: author.token })).status, 200);
  assert.equal((await call("/v1/nostr/posts/" + id)).status, 404);
});
