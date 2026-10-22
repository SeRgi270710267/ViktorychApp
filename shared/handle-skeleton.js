/* Handle skeletons for sign-up.
   Latin and Cyrillic only, plus digits and underscore.
   NFKC, then a TR39-style confusable map, then case folding, so a capital
   and its lowercase share one skeleton. The map folds the Latin/Cyrillic
   pairs that look alike (a/а, e/е, o/о, p/р, c/с, x/х, y/у, H/Н, B/В,
   M/М, T/Т, K/К, and the other single-letter lookalikes in that set).
   The owner handle is the exact code points S е Р g И. */
const OWNER_HANDLE = "S\u0435\u0420g\u0418";

const MAP = {
  "0": "o",
  "1": "l",
  "\u0430": "a", "\u0410": "a",
  "\u0435": "e", "\u0415": "e",
  "\u0451": "e", "\u0401": "e",
  "\u043E": "o", "\u041E": "o",
  "\u0440": "p", "\u0420": "p",
  "\u0441": "c", "\u0421": "c",
  "\u0445": "x", "\u0425": "x",
  "\u0443": "y", "\u0423": "y",
  "\u043D": "h", "\u041D": "h",
  "\u0432": "b", "\u0412": "b",
  "\u043C": "m", "\u041C": "m",
  "\u0442": "t", "\u0422": "t",
  "\u043A": "k", "\u041A": "k",
  "\u0456": "i", "\u0406": "i",
  "\u0458": "j", "\u0408": "j",
  "\u0455": "s", "\u0405": "s",
  "\u04BB": "h",
  "\u0501": "d",
  "\u0433": "r", "\u0413": "r",
  "\u0454": "e", "\u0404": "e",
  "\u0475": "v", "\u0474": "v",
  "\u04CF": "l", "\u04C0": "l",
  "\u0438": "\u1D0E", "\u0418": "\u1D0E",
  "\u044B": "bi", "\u042B": "bi",
  "\u0448": "w", "\u0428": "w",
  "\u0431": "6", "\u0411": "6",
  "\u0437": "3", "\u0417": "3"
};

const BANNED = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\u00AD\u180E\uFE00-\uFE0F\u0300-\u036F\u0483-\u0489\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF]/;
const ALLOWED = /^(?:[A-Za-z0-9_]|[\u0400-\u0482\u048A-\u04FF\u0500-\u052F])+$/;

const RESERVED_EXACT = [
  "admin", "administrator", "support", "official", "help", "security", "root",
  "moderator", "mod", "staff", "system", "team", "abuse", "safety", "verified",
  "owner", "null", "api", "www", "billing", "trust", "legal", "press", "info",
  "contact", "mail", "officialaccount", "viktorych", "viktrych"
];
const RESERVED_PREFIXES = ["viktorych", "viktrych", "\u0432\u0438\u043A\u0442\u043E\u0440\u044B\u0447", "\u0432\u0438\u043A\u0442\u0440\u044B\u0447"];

function skeleton(value) {
  const text = String(value || "").normalize("NFKC");
  let out = "";
  for (const ch of text) out += Object.prototype.hasOwnProperty.call(MAP, ch) ? MAP[ch] : ch.toLowerCase();
  return out;
}

let ownerSkel = "";
function ownerSkeleton() {
  if (!ownerSkel) ownerSkel = skeleton(OWNER_HANDLE);
  return ownerSkel;
}

let exactSkels = null;
let prefixSkels = null;
function reservedTables() {
  if (exactSkels) return;
  exactSkels = RESERVED_EXACT.map((word) => skeleton(word));
  prefixSkels = RESERVED_PREFIXES.map((word) => skeleton(word)).filter((word) => word);
}

function reservedKind(skel) {
  reservedTables();
  if (skel === ownerSkeleton()) return "owner";
  if (exactSkels.indexOf(skel) >= 0) return "reserved";
  for (let i = 0; i < prefixSkels.length; i++) {
    if (skel.indexOf(prefixSkels[i]) === 0) return "reserved";
  }
  return "";
}

function inspectHandle(raw) {
  const handle = String(raw || "").trim();
  if (!handle) return { ok: false, error: "empty" };
  const chars = Array.from(handle);
  if (chars.length > 15) return { ok: false, error: "length" };
  if (handle.normalize("NFKC") !== handle) return { ok: false, error: "chars" };
  if (BANNED.test(handle) || !ALLOWED.test(handle)) return { ok: false, error: "chars" };
  if (!chars.some((ch) => /\p{L}/u.test(ch))) return { ok: false, error: "chars" };
  const skel = skeleton(handle);
  if (!skel) return { ok: false, error: "chars" };
  const kind = reservedKind(skel);
  if (kind === "owner") {
    if (handle === OWNER_HANDLE) return { ok: true, handle: handle, skeleton: skel, owner: true };
    return { ok: false, error: "reserved", skeleton: skel };
  }
  if (kind) return { ok: false, error: "reserved", skeleton: skel };
  return { ok: true, handle: handle, skeleton: skel, owner: false };
}

const api = { OWNER_HANDLE: OWNER_HANDLE, skeleton: skeleton, ownerSkeleton: ownerSkeleton, inspectHandle: inspectHandle, reservedKind: reservedKind };
export { OWNER_HANDLE, skeleton, ownerSkeleton, inspectHandle, reservedKind };
globalThis.HandleSkeleton = api;
