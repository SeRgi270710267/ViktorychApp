/* Friend P2P signaling. Two friends' devices exchange a WebRTC offer,
   answer and ICE candidates through each account's channel socket, then
   talk directly. Only friends can signal each other, nothing is stored,
   and payloads are checked and capped. */
import { publishToAccount } from "./channel.js";

const KINDS = ["offer", "answer", "ice", "bye"];
const SDP_MAX = 8000;
const CAND_MAX = 600;

/* Keeps only the fields a WebRTC handshake needs. Returns null when the
   signal is not one. */
export function cleanP2pSignal(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = String(raw.kind || "");
  if (KINDS.indexOf(kind) < 0) return null;
  const sid = String(raw.sid || "");
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(sid)) return null;
  const out = { kind: kind, sid: sid };
  if (kind === "offer" || kind === "answer") {
    const sdp = String(raw.sdp || "");
    if (!sdp || sdp.length > SDP_MAX || !/^v=0\r?\n/.test(sdp)) return null;
    out.sdp = sdp;
  }
  if (kind === "ice") {
    const cand = raw.cand && typeof raw.cand === "object" ? raw.cand : null;
    if (!cand) return null;
    const text = String(cand.candidate || "");
    if (text.length > CAND_MAX) return null;
    out.cand = { candidate: text, sdpMid: cand.sdpMid == null ? null : String(cand.sdpMid).slice(0, 16), sdpMLineIndex: Number.isInteger(cand.sdpMLineIndex) ? cand.sdpMLineIndex : null };
  }
  return out;
}

async function friends(env, a, b) {
  try {
    const row = await env.DB.prepare("SELECT friend_id FROM account_friends WHERE user_id = ? AND friend_id = ?").bind(a, b).first();
    return !!row;
  } catch (err) {
    return false;
  }
}

export async function handleP2p(request, env, path, url, deps) {
  if (path !== "/v1/p2p/signal") return null;
  if (request.method !== "POST") return deps.json(405, { error: "method" });
  const viewer = await deps.sessionAccount(env, request);
  if (!viewer) return deps.json(401, { error: "unauthorized" });
  const paced = await deps.rateHit(env, "p2p:" + viewer.public_id, 300, 10 * 60 * 1000);
  if (!paced.ok) return deps.json(429, { error: "rate_limited" }, { "retry-after": String(paced.retry || 60) });
  const body = await deps.readJson(request, 12000);
  if (!body || body.error) return deps.json(400, { error: (body && body.error) || "bad_json" });
  const to = String(body.to || "");
  if (!/^\d{12}$/.test(to) || to === viewer.public_id) return deps.json(400, { error: "bad_target" });
  const signal = cleanP2pSignal(body.signal);
  if (!signal) return deps.json(400, { error: "bad_signal" });
  if (!(await friends(env, viewer.public_id, to))) return deps.json(403, { error: "not_friends" });
  try { await publishToAccount(env, to, "p2p", { from: viewer.public_id, signal: signal }, viewer.public_id); }
  catch (err) { return deps.json(503, { error: "channel" }); }
  return deps.json(200, { ok: true });
}
