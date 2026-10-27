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
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("federation: default is out (strictly opted out by default)", async () => {
  const user = await signup("203.0.113.80", "AliceFed", "Alice Fed");

  // 1. WebFinger should return 404
  const wf = await call("/.well-known/webfinger?resource=acct:AliceFed@accounts.test");
  assert.equal(wf.status, 404);
  assert.equal(wf.body.error, "user_not_found");

  // 2. ActivityPub actor should return 404
  const actor = await call("/ap/users/AliceFed");
  assert.equal(actor.status, 404);

  // 3. ActivityPub inbox should return 404
  const inbox = await call("/ap/users/AliceFed/inbox", {
    method: "POST",
    body: { type: "Follow", actor: "https://remote.social/users/bob" }
  });
  assert.equal(inbox.status, 404);

  // 4. ActivityPub outbox should return 404
  const outbox = await call("/ap/users/AliceFed/outbox");
  assert.equal(outbox.status, 404);

  // 5. Nostr NIP-05 should return empty names object (no leak)
  const nostr = await call("/.well-known/nostr.json?name=AliceFed");
  assert.equal(nostr.status, 200);
  assert.deepEqual(nostr.body.names, {});

  // 6. Non-existent users or empty queries return 404 / empty
  const ghost = await call("/.well-known/webfinger?resource=acct:ghost@accounts.test");
  assert.equal(ghost.status, 404);

  const nostrEmpty = await call("/.well-known/nostr.json");
  assert.equal(nostrEmpty.status, 200);
  assert.deepEqual(nostrEmpty.body.names, {});

  // 7. Check authenticated settings view shows opted out
  const settings = await call("/v1/federation/settings", { token: user.token });
  assert.equal(settings.status, 200);
  assert.equal(settings.body.enabled_ap, false);
  assert.equal(settings.body.enabled_nostr, false);
  assert.equal(settings.body.has_ap_keys, false);
});

test("federation: opt-in to ActivityPub and follow lifecycle", async () => {
  const user = await signup("203.0.113.81", "BobAP", "Bob ActivityPub");

  // Opt in to ActivityPub
  const optIn = await call("/v1/federation/settings", {
    method: "POST",
    token: user.token,
    body: { enabled_ap: true }
  });
  assert.equal(optIn.status, 200);
  assert.equal(optIn.body.enabled_ap, true);
  assert.equal(optIn.body.has_ap_keys, true);

  // WebFinger now succeeds with JRD
  const wf = await call("/.well-known/webfinger?resource=acct:BobAP@accounts.test", {
    origin: "https://elk.zone"
  });
  assert.equal(wf.status, 200);
  assert.equal(wf.body.subject, "acct:BobAP@accounts.test");
  assert.ok(wf.body.links.some((l) => l.rel === "self" && l.href === "https://accounts.test/ap/users/BobAP"));

  // ActivityPub Actor endpoint returns Person JSON-LD with public key
  const actor = await call("/ap/users/BobAP", { origin: "https://mastodon.social" });
  assert.equal(actor.status, 200);
  assert.equal(actor.body.type, "Person");
  assert.equal(actor.body.preferredUsername, "BobAP");
  assert.ok(actor.body.publicKey);
  assert.ok(actor.body.publicKey.publicKeyPem.includes("BEGIN PUBLIC KEY"));

  // Remote Mastodon instance follows BobAP
  const follow = await call("/ap/users/BobAP/inbox", {
    method: "POST",
    body: {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Follow",
      actor: "https://mastodon.social/users/remote_viewer",
      object: "https://accounts.test/ap/users/BobAP"
    }
  });
  assert.equal(follow.status, 202);

  // Check followers collection count
  const followers = await call("/ap/users/BobAP/followers");
  assert.equal(followers.status, 200);
  assert.equal(followers.body.totalItems, 1);

  // Remote Mastodon instance sends Undo (unfollow)
  const undo = await call("/ap/users/BobAP/inbox", {
    method: "POST",
    body: {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Undo",
      actor: "https://mastodon.social/users/remote_viewer",
      object: {
        type: "Follow",
        actor: "https://mastodon.social/users/remote_viewer",
        object: "https://accounts.test/ap/users/BobAP"
      }
    }
  });
  assert.equal(undo.status, 202);

  const followersAfter = await call("/ap/users/BobAP/followers");
  assert.equal(followersAfter.status, 200);
  assert.equal(followersAfter.body.totalItems, 0);
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

test("federation: opt-out closes all doors immediately", async () => {
  const user = await signup("203.0.113.83", "EveFed", "Eve Federated");

  // Opt in to both
  await call("/v1/federation/settings", {
    method: "POST",
    token: user.token,
    body: {
      enabled_ap: true,
      enabled_nostr: true,
      nostr_pubkey: "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2"
    }
  });

  // Verify reachable
  const wfBefore = await call("/.well-known/webfinger?resource=acct:EveFed@accounts.test");
  assert.equal(wfBefore.status, 200);
  const nostrBefore = await call("/.well-known/nostr.json?name=EveFed");
  assert.ok(nostrBefore.body.names.EveFed);

  // Now opt out!
  const optOut = await call("/v1/federation/settings", {
    method: "POST",
    token: user.token,
    body: {
      enabled_ap: false,
      enabled_nostr: false
    }
  });
  assert.equal(optOut.status, 200);
  assert.equal(optOut.body.enabled_ap, false);
  assert.equal(optOut.body.enabled_nostr, false);

  // All doors immediately shut:
  const wfAfter = await call("/.well-known/webfinger?resource=acct:EveFed@accounts.test");
  assert.equal(wfAfter.status, 404);

  const actorAfter = await call("/ap/users/EveFed");
  assert.equal(actorAfter.status, 404);

  const inboxAfter = await call("/ap/users/EveFed/inbox", {
    method: "POST",
    body: { type: "Follow", actor: "https://remote.social/users/bob" }
  });
  assert.equal(inboxAfter.status, 404);

  const nostrAfter = await call("/.well-known/nostr.json?name=EveFed");
  assert.equal(nostrAfter.status, 200);
  assert.deepEqual(nostrAfter.body.names, {});
});
