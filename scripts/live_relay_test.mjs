/* Relay tree and audience rules. No sockets and no media. */
import assert from "node:assert/strict";
import test from "node:test";
import { chooseParent, normalizeFanout, reparent, treeDepth, wouldCycle } from "../shared/live-relay.js";
import { cleanAudience, viewerAllowed } from "../shared/live-auth.js";

function peer(id, role, parentId) {
  return { id: id, role: role, parentId: parentId || "", alive: true };
}

const host = "100000000001";
const a = "100000000002";
const b = "100000000003";
const c = "100000000004";

test("fan-out stays inside 1..8", () => {
  assert.equal(normalizeFanout(0), 1);
  assert.equal(normalizeFanout(3), 3);
  assert.equal(normalizeFanout(99), 8);
});

test("the host is the first parent and later viewers go one level down", () => {
  const peers = [peer(host, "host", "")];
  assert.equal(chooseParent(peers, 1, a), host);
  peers.push(peer(a, "viewer", host));
  assert.equal(chooseParent(peers, 1, b), a);
  peers.push(peer(b, "viewer", a));
  assert.equal(chooseParent(peers, 1, c), b);
  assert.equal(treeDepth(peers), 3);
});

test("a full node is skipped when another node still has room", () => {
  const peers = [
    peer(host, "host", ""),
    peer(a, "viewer", host),
    peer(b, "viewer", host)
  ];
  assert.equal(chooseParent(peers, 2, c), a);
  peers.push(peer(c, "viewer", a));
  const next = "100000000005";
  assert.equal(chooseParent(peers, 2, next), a);
});

test("an orphan is reparented without forming a cycle", () => {
  const peers = [
    peer(host, "host", ""),
    peer(a, "viewer", host),
    peer(b, "viewer", a)
  ];
  const moved = reparent(peers, a, 1);
  const orphan = moved.peers.find((item) => item.id === b);
  assert.equal(orphan.parentId, host);
  assert.equal(moved.moves.length, 1);
  assert.equal(wouldCycle(moved.peers, b, b), true);
  assert.equal(wouldCycle(moved.peers, b, host), false);
});

test("there is no parent when the host is gone", () => {
  assert.equal(chooseParent([peer(a, "viewer", "")], 3, b), "");
});

test("audience rules hide a live from everyone outside it", () => {
  const base = { hostId: host, state: "live", hasPassword: false };
  assert.equal(cleanAudience("nope"), "");
  assert.equal(viewerAllowed({ session: null, viewerId: a }), false);
  assert.equal(viewerAllowed({ session: { ...base, audience: "public", state: "ended" }, viewerId: a }), false);
  assert.equal(viewerAllowed({ session: { ...base, audience: "public" }, viewerId: "nope" }), false);
  assert.equal(viewerAllowed({ session: { ...base, audience: "self" }, viewerId: a }), false);
  assert.equal(viewerAllowed({ session: { ...base, audience: "self" }, viewerId: host }), true);
  assert.equal(viewerAllowed({ session: { ...base, audience: "public" }, viewerId: a, blocked: true }), false);
  assert.equal(viewerAllowed({ session: { ...base, audience: "followers" }, viewerId: a, followsHost: false }), false);
  assert.equal(viewerAllowed({ session: { ...base, audience: "followers" }, viewerId: a, followsHost: true }), true);
  assert.equal(viewerAllowed({ session: { ...base, audience: "mutuals" }, viewerId: a, followsHost: true, mutual: false }), false);
  assert.equal(viewerAllowed({ session: { ...base, audience: "mutuals" }, viewerId: a, mutual: true }), true);
  assert.equal(viewerAllowed({ session: { ...base, audience: "list" }, viewerId: a, listMember: false }), false);
  assert.equal(viewerAllowed({ session: { ...base, audience: "list" }, viewerId: a, listMember: true }), true);
  assert.equal(viewerAllowed({ session: { ...base, audience: "invite", hasPassword: true }, viewerId: a, inviteOk: true, passwordOk: false }), false);
  assert.equal(viewerAllowed({ session: { ...base, audience: "invite", hasPassword: true }, viewerId: a, inviteOk: true, passwordOk: true }), true);
  assert.equal(viewerAllowed({ session: { ...base, audience: "invite" }, viewerId: a, inviteOk: false }), false);
});
