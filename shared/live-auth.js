/* Who may learn that a live exists, and who may open its signaling socket.
   A refusal looks the same as a missing live so the session is not leaked. */

export const AUDIENCES = ["public", "followers", "mutuals", "self", "list", "invite"];

export function cleanAudience(value) {
  const text = String(value || "");
  return AUDIENCES.indexOf(text) >= 0 ? text : "";
}

export function viewerAllowed(input) {
  const src = input || {};
  const session = src.session;
  if (!session || session.state === "ended") return false;
  const viewerId = String(src.viewerId || "");
  if (!/^\d{12}$/.test(viewerId)) return false;
  if (viewerId === String(session.hostId || "")) return true;
  if (src.blocked) return false;
  const audience = cleanAudience(session.audience);
  if (audience === "self") return false;
  if (audience === "public") return true;
  if (audience === "followers") return src.followsHost === true;
  if (audience === "mutuals") return src.mutual === true;
  if (audience === "list") return src.listMember === true;
  if (audience === "invite") {
    if (src.inviteOk !== true) return false;
    if (session.hasPassword && src.passwordOk !== true) return false;
    return true;
  }
  return false;
}
