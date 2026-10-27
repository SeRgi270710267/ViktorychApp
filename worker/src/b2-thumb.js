// Optional Backblaze B2 copy of a stream-copied keyframe.
// Off unless B2_KEY_ID, B2_APP_KEY, and B2_BUCKET are set. Never logs them.
import { b2Configured } from "../../shared/live-preview.js";

export { b2Configured };

let auth = null;

async function authorize(env) {
  if (!b2Configured(env)) return null;
  if (auth && auth.until > Date.now() && auth.key === env.B2_KEY_ID) return auth;
  const token = btoa(String(env.B2_KEY_ID).trim() + ":" + String(env.B2_APP_KEY).trim());
  let res = null;
  try {
    res = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
      headers: { Authorization: "Basic " + token }
    });
  } catch (err) {
    return null;
  }
  if (!res || !res.ok) return null;
  let body = null;
  try { body = await res.json(); } catch (err) { body = null; }
  const bucketId = body && body.allowed && body.allowed.bucketId;
  if (!body || !body.authorizationToken || !body.apiUrl || !body.downloadUrl || !bucketId) return null;
  auth = {
    key: env.B2_KEY_ID,
    until: Date.now() + 20 * 60 * 1000,
    token: body.authorizationToken,
    apiUrl: body.apiUrl,
    downloadUrl: body.downloadUrl,
    bucketId,
    bucket: String(env.B2_BUCKET).trim()
  };
  return auth;
}

export async function b2PutThumb(env, name, bytes) {
  const session = await authorize(env);
  if (!session || !name || !bytes) return false;
  let upload = null;
  try {
    upload = await fetch(session.apiUrl + "/b2api/v2/b2_get_upload_url", {
      method: "POST",
      headers: { Authorization: session.token, "content-type": "application/json" },
      body: JSON.stringify({ bucketId: session.bucketId })
    });
  } catch (err) {
    return false;
  }
  if (!upload || !upload.ok) return false;
  let slot = null;
  try { slot = await upload.json(); } catch (err) { slot = null; }
  if (!slot || !slot.uploadUrl || !slot.authorizationToken) return false;
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  const hex = Array.from(new Uint8Array(digest)).map((part) => part.toString(16).padStart(2, "0")).join("");
  let sent = null;
  try {
    sent = await fetch(slot.uploadUrl, {
      method: "POST",
      headers: {
        Authorization: slot.authorizationToken,
        "X-Bz-File-Name": encodeURIComponent(name).replace(/%2F/g, "/"),
        "Content-Type": "video/mp4",
        "X-Bz-Content-Sha1": hex
      },
      body: bytes
    });
  } catch (err) {
    return false;
  }
  return !!(sent && sent.ok);
}

export async function b2GetThumb(env, name) {
  const session = await authorize(env);
  if (!session || !name) return null;
  const url = session.downloadUrl + "/file/" + encodeURIComponent(session.bucket) + "/" + String(name).split("/").map(encodeURIComponent).join("/");
  let res = null;
  try {
    res = await fetch(url, { headers: { Authorization: session.token } });
  } catch (err) {
    return null;
  }
  if (!res || !res.ok) return null;
  return await res.arrayBuffer();
}
