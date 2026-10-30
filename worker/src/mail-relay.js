/* Inbox › Mail: a stateless IMAP relay for a member's own mailbox.
   The device sends its app password with each request. The Worker opens one
   TLS socket to the provider (cloudflare:sockets connect()), reads only the
   one folder the member chose, answers, and forgets everything: no storage,
   no logging, no copies of mail, credentials or addresses.
   Safeguards:
   - Only the providers below (no arbitrary hosts).
   - Only the chosen folder, opened with EXAMINE (read-only). No LIST, no
     SELECT, no STORE/COPY/MOVE/EXPUNGE, no SMTP. INBOX itself is refused
     unless the member turned on "allow INBOX" in the app.
   - Sender allowlist, maximum age and "codes only" are applied on the
     server before headers are downloaded; bodies come only when opened.
   - Off unless the Worker var INBOX_RELAY is "on". */

export const PROVIDERS = {
  yandex: { host: "imap.yandex.com", port: 993 },
  gmail: { host: "imap.gmail.com", port: 993 },
  outlook: { host: "outlook.office365.com", port: 993 },
  mailru: { host: "imap.mail.ru", port: 993 }
};

const MAX_HEADERS = 40;
const MAX_BODY = 262144;
const MAX_TEXT = 20000;
const TIMEOUT_MS = 20000;
const CODE_WORDS = /(code|kod|код|otp|verif|подтвер|one[- ]time|login|sign[- ]?in|вход|войти|parol|пароль|password|pin\b|token|2fa|\b\d{4,8}\b)/i;

export function mailEnabled(env) {
  return String(env && env.INBOX_RELAY || "") === "on";
}

/* ---------- small helpers (exported for tests) ---------- */
export function quote(text) {
  const s = String(text == null ? "" : text);
  if (/[\r\n\0]/.test(s)) throw new Error("bad_input");
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/* RFC 3501 modified UTF-7 for folder names. */
export function utf7(name) {
  let out = "";
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    const bytes = [];
    buf.forEach((c) => { bytes.push(c >> 8, c & 255); });
    let b64 = btoa(String.fromCharCode.apply(null, bytes)).replace(/=+$/, "").replace(/\//g, ",");
    out += "&" + b64 + "-";
    buf = [];
  };
  for (const ch of String(name)) {
    const code = ch.codePointAt(0);
    if (code >= 0x20 && code <= 0x7e) {
      flush();
      out += ch === "&" ? "&-" : ch;
    } else if (code > 0xffff) {
      const v = code - 0x10000;
      buf.push(0xd800 + (v >> 10), 0xdc00 + (v & 1023));
    } else buf.push(code);
  }
  flush();
  return out;
}

export function cleanFolder(folder, allowInbox) {
  const f = String(folder || "").trim();
  if (!f || f.length > 80 || /[\r\n\0%*"\\]/.test(f)) return "";
  if (/^inbox$/i.test(f) && !allowInbox) return "";
  return f;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function imapDate(ms) {
  const d = new Date(ms);
  return d.getUTCDate() + "-" + MONTHS[d.getUTCMonth()] + "-" + d.getUTCFullYear();
}

export function searchQuery(opts) {
  const parts = [];
  const since = Math.max(0, Math.floor(Number(opts.since) || 0));
  parts.push("UID " + (since + 1) + ":*");
  const days = Math.floor(Number(opts.days) || 0);
  if (days > 0 && days <= 3650) parts.push("SINCE " + imapDate((opts.now || Date.now()) - days * 86400000));
  const from = (Array.isArray(opts.from) ? opts.from : []).map((x) => String(x || "").trim()).filter((x) => x && x.length <= 120 && !/[\r\n"\\]/.test(x)).slice(0, 10);
  if (from.length) {
    let q = "FROM " + quote(from[from.length - 1]);
    for (let i = from.length - 2; i >= 0; i--) q = "OR FROM " + quote(from[i]) + " " + q;
    parts.push(from.length > 1 ? "(" + q + ")" : q);
  }
  return parts.join(" ");
}

/* Decode RFC 2047 encoded words. */
export function decodeWords(text) {
  const s = String(text || "").replace(/\?=\s+=\?/g, "?==?");
  return s.replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (all, charset, enc, data) => {
    try {
      let bytes;
      if (enc.toUpperCase() === "B") bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      else bytes = qpBytes(data.replace(/_/g, " "));
      return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes);
    } catch (err) { return all; }
  });
}

function qpBytes(text) {
  const out = [];
  const s = String(text).replace(/=\r?\n/g, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { out.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
    else {
      const code = s.charCodeAt(i);
      if (code < 128) out.push(code);
      else new TextEncoder().encode(c).forEach((b) => out.push(b));
    }
  }
  return new Uint8Array(out);
}

export function parseHeaders(text) {
  const out = {};
  String(text || "").replace(/\r\n[ \t]+/g, " ").replace(/\n[ \t]+/g, " ").split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/);
    if (m && !(m[1].toLowerCase() in out)) out[m[1].toLowerCase()] = m[2];
  });
  return out;
}

export function splitFrom(value) {
  const v = decodeWords(value || "").trim();
  const m = v.match(/^(.*?)\s*<([^>]+)>\s*$/);
  const addr = (m ? m[2] : v).trim();
  let name = m ? m[1].replace(/^"|"$/g, "").trim() : "";
  if (!name) name = addr.split("@")[0] || addr;
  return { name: name.slice(0, 120), address: addr.slice(0, 200) };
}

function charsetOf(ct) {
  const m = String(ct || "").match(/charset="?([^";\s]+)"?/i);
  return m ? m[1].toLowerCase() : "utf-8";
}
function decodeBody(raw, encoding, charset) {
  const enc = String(encoding || "").toLowerCase().trim();
  let bytes;
  try {
    if (enc === "base64") bytes = Uint8Array.from(atob(raw.replace(/[^A-Za-z0-9+/=]/g, "")), (c) => c.charCodeAt(0));
    else if (enc === "quoted-printable") bytes = qpBytes(raw);
    else bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0) & 255);
    return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes);
  } catch (err) {
    return raw;
  }
}
export function htmlToText(html) {
  return String(html || "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|h\d|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (a, n) => { try { return String.fromCodePoint(Number(n)); } catch (err) { return " "; } })
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

/* A raw RFC 822 message (binary string) → the best readable text. */
export function messageText(raw) {
  const parts = [];
  const walk = (chunk, depth) => {
    const cut = chunk.search(/\r?\n\r?\n/);
    const head = parseHeaders(cut >= 0 ? chunk.slice(0, cut) : chunk);
    const body = cut >= 0 ? chunk.slice(cut).replace(/^\r?\n\r?\n/, "") : "";
    const ct = head["content-type"] || "text/plain";
    const b = ct.match(/boundary="?([^";]+)"?/i);
    if (/^multipart\//i.test(ct) && b && depth < 6) {
      const sep = "--" + b[1];
      body.split(sep).slice(1).forEach((p) => { if (!/^--/.test(p)) walk(p.replace(/^\r?\n/, ""), depth + 1); });
      return;
    }
    if (/^text\/(plain|html)/i.test(ct) && !/attachment/i.test(head["content-disposition"] || "")) {
      parts.push({ html: /html/i.test(ct), text: decodeBody(body, head["content-transfer-encoding"], charsetOf(ct)) });
    }
  };
  walk(String(raw || ""), 0);
  const plain = parts.find((p) => !p.html && p.text.trim());
  const html = parts.find((p) => p.html);
  const text = plain ? plain.text : (html ? htmlToText(html.text) : "");
  return text.replace(/\r\n/g, "\n").trim().slice(0, MAX_TEXT);
}

/* ---------- a tiny IMAP client over one socket ---------- */
const enc = new TextEncoder();
function latin1(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return s;
}

export class Imap {
  constructor(socket) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
    this.buf = "";
    this.n = 0;
  }
  async more() {
    const { value, done } = await this.reader.read();
    if (done) throw new Error("closed");
    this.buf += latin1(value);
    if (this.buf.length > MAX_BODY * 4) throw new Error("too_big");
  }
  /* One response line with any {n} literals folded in as { text, literals }. */
  async line() {
    let text = "";
    const literals = [];
    for (;;) {
      let at = this.buf.indexOf("\r\n");
      while (at < 0) { await this.more(); at = this.buf.indexOf("\r\n"); }
      const piece = this.buf.slice(0, at);
      this.buf = this.buf.slice(at + 2);
      const lit = piece.match(/\{(\d+)\}$/);
      text += piece;
      if (!lit) return { text, literals };
      const size = Number(lit[1]);
      if (size > MAX_BODY * 2) throw new Error("too_big");
      while (this.buf.length < size) await this.more();
      literals.push(this.buf.slice(0, size));
      this.buf = this.buf.slice(size);
    }
  }
  async greeting() {
    const g = await this.line();
    if (!/^\* (OK|PREAUTH)/i.test(g.text)) throw new Error("connect");
  }
  async cmd(command) {
    const tag = "v" + (++this.n);
    await this.writer.write(enc.encode(tag + " " + command + "\r\n"));
    const lines = [];
    for (;;) {
      const l = await this.line();
      if (l.text.startsWith(tag + " ")) {
        const ok = /^\S+ OK/i.test(l.text);
        return { ok, status: l.text.slice(tag.length + 1), lines };
      }
      lines.push(l);
    }
  }
  async close() {
    try { await this.cmd("LOGOUT"); } catch (err) { /* already gone */ }
    try { this.socket.close(); } catch (err) { /* closed */ }
  }
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(new Error("timeout")), ms); })]).finally(() => clearTimeout(t));
}

export async function openFolder(imap, creds) {
  await imap.greeting();
  const login = await imap.cmd("LOGIN " + quote(creds.user) + " " + quote(creds.pass));
  if (!login.ok) throw new Error("auth");
  const ex = await imap.cmd("EXAMINE " + quote(utf7(creds.folder)));
  if (!ex.ok) throw new Error("folder");
  let uidvalidity = 0, uidnext = 0, exists = 0;
  ex.lines.forEach((l) => {
    let m = l.text.match(/UIDVALIDITY (\d+)/i); if (m) uidvalidity = Number(m[1]);
    m = l.text.match(/UIDNEXT (\d+)/i); if (m) uidnext = Number(m[1]);
    m = l.text.match(/^\* (\d+) EXISTS/i); if (m) exists = Number(m[1]);
  });
  return { uidvalidity, uidnext, exists };
}

export async function listHeaders(imap, box, opts) {
  const fresh = !opts.uidvalidity || Number(opts.uidvalidity) !== box.uidvalidity;
  const search = await imap.cmd("UID SEARCH " + searchQuery({ since: fresh ? 0 : opts.since, days: opts.days, from: opts.from, now: opts.now }));
  if (!search.ok) throw new Error("search");
  let uids = [];
  search.lines.forEach((l) => {
    const m = l.text.match(/^\* SEARCH ?(.*)$/i);
    if (m) uids = uids.concat(m[1].split(/\s+/).filter(Boolean).map(Number));
  });
  const since = fresh ? 0 : Math.max(0, Number(opts.since) || 0);
  uids = uids.filter((u) => u > since).sort((a, b) => a - b).slice(-MAX_HEADERS);
  const out = [];
  if (uids.length) {
    const res = await imap.cmd("UID FETCH " + uids.join(",") + " (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])");
    if (!res.ok) throw new Error("fetch");
    res.lines.forEach((l) => {
      if (!/^\* \d+ FETCH/i.test(l.text)) return;
      const uid = Number((l.text.match(/UID (\d+)/i) || [])[1] || 0);
      if (!uid) return;
      const head = parseHeaders(l.literals[0] || "");
      const from = splitFrom(head.from || "");
      const subject = decodeWords(head.subject || "").slice(0, 300);
      const internal = (l.text.match(/INTERNALDATE "([^"]+)"/i) || [])[1] || head.date || "";
      const at = Date.parse(internal.replace(/^(\d{1,2})-(\w{3})-(\d{4})/, "$1 $2 $3")) || 0;
      const seen = /\\Seen/i.test((l.text.match(/FLAGS \(([^)]*)\)/i) || [])[1] || "");
      const size = Number((l.text.match(/RFC822\.SIZE (\d+)/i) || [])[1] || 0);
      if (opts.codesOnly && !CODE_WORDS.test(subject)) return;
      out.push({ uid, from: from.name, address: from.address, subject, at, seen, size });
    });
  }
  out.sort((a, b) => b.uid - a.uid);
  return { uidvalidity: box.uidvalidity, uidnext: box.uidnext, last: uids.length ? uids[uids.length - 1] : (fresh ? 0 : since), messages: out };
}

export async function readBody(imap, uid) {
  const res = await imap.cmd("UID FETCH " + uid + " (UID BODY.PEEK[]<0." + MAX_BODY + ">)");
  if (!res.ok) throw new Error("fetch");
  const hit = res.lines.find((l) => /^\* \d+ FETCH/i.test(l.text) && l.literals.length);
  if (!hit) throw new Error("gone");
  return messageText(hit.literals[0]);
}

function cleanRequest(body) {
  const b = body && typeof body === "object" ? body : {};
  const provider = PROVIDERS[String(b.provider || "")] ? String(b.provider) : "";
  const user = String(b.user || "").trim();
  const pass = String(b.pass || "");
  const folder = cleanFolder(b.folder, b.allowInbox === true);
  const op = b.op === "body" ? "body" : (b.op === "check" ? "check" : "list");
  if (!provider || !user || user.length > 200 || !pass || pass.length > 200 || /[\r\n\0]/.test(user + pass)) return { error: "bad_input" };
  if (!folder) return { error: "folder_not_allowed" };
  const f = b.filters && typeof b.filters === "object" ? b.filters : {};
  return {
    provider, user, pass, folder, op,
    uid: Math.max(0, Math.floor(Number(b.uid) || 0)),
    since: Math.max(0, Math.floor(Number(b.since) || 0)),
    uidvalidity: Math.max(0, Math.floor(Number(b.uidvalidity) || 0)),
    from: Array.isArray(f.from) ? f.from : [],
    days: Number(f.days) || 0,
    codesOnly: f.codesOnly === true
  };
}

const ERRORS = { auth: 401, folder: 404, connect: 502, timeout: 504, closed: 502, too_big: 413, gone: 404, search: 502, fetch: 502 };

/* POST /v1/inbox/mail (any signed-in member) and GET /v1/inbox/mail (status). */
export async function handleMail(request, env, deps) {
  const { json, rateHit, limited, sessionAccount, readJson } = deps;
  const headers = { "cache-control": "no-store" };
  if (!mailEnabled(env)) return json(404, { error: "off" }, headers);
  const account = await sessionAccount(env, request);
  if (!account) return json(401, { error: "sign_in" }, headers);
  if (request.method === "GET") return json(200, { enabled: true, providers: Object.keys(PROVIDERS) }, headers);
  if (request.method !== "POST") return json(405, { error: "method" }, headers);
  const hit = await rateHit(env, "mail:" + account.public_id, 120, 10 * 60 * 1000);
  if (!hit.ok) return limited(hit);
  let raw;
  try { raw = await readJson(request, 4096); } catch (err) { raw = null; }
  const q = cleanRequest(raw);
  if (q.error) return json(400, { error: q.error }, headers);
  const connect = deps.connect || (await import("cloudflare:sockets")).connect;
  const p = PROVIDERS[q.provider];
  let imap = null;
  try {
    const socket = connect({ hostname: p.host, port: p.port }, { secureTransport: "on", allowHalfOpen: false });
    imap = new Imap(socket);
    const answer = await withTimeout((async () => {
      const box = await openFolder(imap, q);
      if (q.op === "check") return { ok: true, folder: q.folder, uidvalidity: box.uidvalidity, count: box.exists };
      if (q.op === "body") {
        if (!q.uid) throw new Error("gone");
        return { uid: q.uid, text: await readBody(imap, q.uid) };
      }
      return listHeaders(imap, box, q);
    })(), TIMEOUT_MS);
    return json(200, answer, headers);
  } catch (err) {
    const code = err && ERRORS[err.message] ? err.message : "connect";
    return json(ERRORS[code], { error: code }, headers);
  } finally {
    q.pass = "";
    if (imap) imap.close();
  }
}
