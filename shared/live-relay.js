/* Relay tree for a live WebRTC session. Pure data, no sockets and no media. */

export const DEFAULT_FANOUT = 3;
export const MAX_FANOUT = 8;

export function normalizeFanout(value) {
  const parsed = Number(value);
  const n = Number.isFinite(parsed) ? Math.floor(parsed) : DEFAULT_FANOUT;
  if (n < 1) return 1;
  if (n > MAX_FANOUT) return MAX_FANOUT;
  return n;
}

export function alivePeers(peers) {
  return (Array.isArray(peers) ? peers : []).filter((peer) => peer && peer.id && peer.alive !== false);
}

export function childCount(peers, id) {
  return alivePeers(peers).filter((peer) => peer.parentId === id).length;
}

export function wouldCycle(peers, childId, parentId) {
  const map = {};
  alivePeers(peers).forEach((peer) => { map[peer.id] = peer.parentId || ""; });
  let cursor = parentId;
  const seen = {};
  while (cursor) {
    if (cursor === childId || seen[cursor]) return true;
    seen[cursor] = true;
    cursor = map[cursor] || "";
  }
  return false;
}

export function chooseParent(peers, fanout, childId) {
  const cap = normalizeFanout(fanout);
  const alive = alivePeers(peers).filter((peer) => peer.id !== childId);
  const host = alive.find((peer) => peer.role === "host");
  if (!host) return "";
  const queue = [host.id];
  const seen = {};
  while (queue.length) {
    const id = queue.shift();
    if (seen[id]) continue;
    seen[id] = true;
    const kids = alive.filter((peer) => peer.parentId === id);
    if (kids.length < cap && !wouldCycle(alive, childId, id)) return id;
    kids.forEach((kid) => queue.push(kid.id));
  }
  return "";
}

export function reparent(peers, goneId, fanout) {
  const next = (Array.isArray(peers) ? peers : []).map((peer) => ({
    id: peer.id,
    role: peer.role || "viewer",
    parentId: peer.parentId || "",
    alive: peer.id === goneId ? false : peer.alive !== false
  }));
  const moves = [];
  next.forEach((peer) => {
    if (!peer.alive || peer.parentId !== goneId) return;
    peer.parentId = "";
    const parentId = chooseParent(next, fanout, peer.id);
    peer.parentId = parentId;
    if (parentId) moves.push({ id: peer.id, parentId: parentId });
  });
  return { peers: next, moves: moves };
}

export function treeDepth(peers) {
  const alive = alivePeers(peers);
  const host = alive.find((peer) => peer.role === "host");
  if (!host) return 0;
  let depth = 1;
  let frontier = [host.id];
  const seen = {};
  while (frontier.length) {
    const next = [];
    frontier.forEach((id) => {
      if (seen[id]) return;
      seen[id] = true;
      alive.forEach((peer) => { if (peer.parentId === id) next.push(peer.id); });
    });
    if (!next.length) break;
    depth += 1;
    frontier = next;
    if (depth > alive.length) break;
  }
  return depth;
}
