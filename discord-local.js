/* Settings > Connected keys > Connect your Discord (local). Any user.
   The key of the user's own spare Discord account is kept only on this
   device: IndexedDB, sealed with AES-GCM under a device key that is created
   non-extractable, so not even this page can read the raw key bytes back.
   Reads go straight from this device to discord.com (Discord answers CORS
   for any origin), never through our Worker, Render, D1, R2 or logs, and the
   key is never shared. Reads go one at a time with a pause and jitter, and
   stop on a 429 until Discord's retry_after has passed. A 401 stops
   everything and shows a calm "needs replacing" note. Joins only start from
   a tap, and a captcha is solved by the user in a popup.
   Sending: the person types a message and taps Post (or presses Enter).
   One tap is one send. Nothing here sends on a timer, in bulk, on repeat or
   as an automatic reply. Sends are spaced (1.5 s apart, a soft cap per
   minute), a 429 shows a wait note and is never retried by itself, and a
   captcha opens the same popup. A DM only opens from a tap on a person. */
(function (root) {
  "use strict";
  var API = "https://discord.com/api/v10";
  var DB_NAME = "viktorych-discord-local";
  var STORE = "kv";
  var GAP_MS = 1200;
  var JITTER_MS = 1300;
  var FRESH_MS = 10 * 60 * 1000;
  var JOIN_GAP_MS = 60 * 1000;
  var TEXT_TYPES = { 0: true, 5: true, 15: true };
  var SEND_GAP_MS = 1500;
  var SEND_PER_MIN = 8;
  var DM_GAP_MS = 5000;
  var MAX_LEN = 2000;
  var EMOJI = ["😀", "😂", "🥲", "😍", "😎", "🤔", "😮", "😢", "🙏", "👍", "👎", "👏", "🔥", "🎉", "❤️", "💯"];
  var netFetch = root.fetch ? root.fetch.bind(root) : null;

  var state = {
    loaded: false,
    has: false,
    status: "none",
    me: null,
    guilds: null,
    dms: null,
    savedAt: 0,
    open: false,
    view: "servers",
    guild: null,
    channels: null,
    channel: null,
    messages: null,
    busy: false,
    note: "",
    err: "",
    invite: null,
    inviteBusy: false,
    lastJoinAt: 0,
    captcha: null,
    captchaBusy: false,
    pausedUntil: 0,
    draft: "",
    replyTo: null,
    sending: false,
    lastSendAt: 0,
    sendTimes: [],
    sendWaitUntil: 0,
    sendNote: "",
    emoji: false,
    person: null,
    dmBusy: false,
    lastDmAt: 0
  };

  function tr(key, vars) { return root.t ? root.t(key, vars) : fill(key, vars); }
  function fill(key, vars) {
    return String(key).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; });
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, Math.max(0, ms)); }); }
  function snowflake(v) { v = String(v == null ? "" : v); return /^\d{5,22}$/.test(v) ? v : ""; }

  /* ---------- storage: IndexedDB + WebCrypto ---------- */
  var dbOpen = null;
  function db() {
    if (dbOpen) return dbOpen;
    dbOpen = new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error("idb")); return; }
      var req = root.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () {
        var d = req.result;
        d.onversionchange = function () { try { d.close(); } catch (e) { /* closing */ } dbOpen = null; };
        resolve(d);
      };
      req.onerror = function () { dbOpen = null; reject(req.error || new Error("idb")); };
    });
    return dbOpen;
  }
  function idb(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(STORE, mode);
        var out = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { resolve(out && "result" in out ? out.result : undefined); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error("idb")); };
      });
    });
  }
  function get(key) { return idb("readonly", function (s) { return s.get(key); }); }
  function put(key, value) { return idb("readwrite", function (s) { s.put(value, key); }); }
  function del(key) { return idb("readwrite", function (s) { s.delete(key); }); }

  function subtle() { return root.crypto && root.crypto.subtle ? root.crypto.subtle : null; }
  function deviceKey() {
    return get("device-key").then(function (key) {
      if (key) return key;
      if (!subtle()) throw new Error("crypto");
      return subtle().generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]).then(function (made) {
        return put("device-key", made).then(function () { return made; });
      });
    });
  }
  function seal(text) {
    return deviceKey().then(function (key) {
      var iv = root.crypto.getRandomValues(new Uint8Array(12));
      return subtle().encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(text)).then(function (ct) {
        return { v: 1, iv: iv, ct: ct };
      });
    });
  }
  function unseal() {
    return Promise.all([get("token"), get("device-key")]).then(function (both) {
      var box = both[0];
      var key = both[1];
      if (!box || !key) return "";
      return subtle().decrypt({ name: "AES-GCM", iv: box.iv }, key, box.ct).then(function (plain) {
        return new TextDecoder().decode(plain);
      });
    });
  }

  function cleanKey(raw) {
    var v = String(raw || "").trim().replace(/^["']|["']$/g, "").trim();
    if (/^authorization:\s*/i.test(v)) v = v.replace(/^authorization:\s*/i, "");
    if (/^(bearer|bot)\s+/i.test(v)) return "";
    return /^[A-Za-z0-9_\-.]{50,120}$/.test(v) && v.split(".").length >= 3 ? v : "";
  }

  /* ---------- gentle reads ---------- */
  var line = Promise.resolve();
  var lastAt = 0;
  function gentle(task) {
    var run = line.then(function () {
      var wait = Math.max(lastAt + GAP_MS + Math.random() * JITTER_MS - Date.now(), state.pausedUntil - Date.now());
      return sleep(wait).then(task).then(function (out) { lastAt = Date.now(); return out; }, function (err) { lastAt = Date.now(); throw err; });
    });
    line = run.catch(function () {});
    return run;
  }

  function discord(path, opts) {
    opts = opts || {};
    return gentle(function () { return send(path, opts, 0); });
  }
  function send(path, opts, tries) {
    if (state.status === "replace" && !opts.key && !opts.anon) return Promise.reject(err("replace"));
    var keyed = opts.key ? Promise.resolve(opts.key) : (opts.anon ? Promise.resolve("") : unseal());
    return keyed.then(function (key) {
      if (!key && !opts.anon) throw err("nokey");
      var headers = { accept: "application/json" };
      if (key) headers.authorization = key;
      if (opts.body) headers["content-type"] = "application/json";
      var extra = opts.headers || {};
      Object.keys(extra).forEach(function (h) { if (extra[h]) headers[h] = extra[h]; });
      if (!netFetch) throw err("offline");
      return netFetch(API + path, {
        method: opts.method || "GET",
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        mode: "cors"
      });
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) {
        if (res.status === 429) {
          var secs = Number(body && body.retry_after);
          var ms = (isFinite(secs) && secs > 0 ? secs * 1000 : 5000) + 500 + Math.random() * 1500;
          state.pausedUntil = Date.now() + Math.min(ms, 10 * 60 * 1000);
          if (!opts.once && tries < 2 && ms <= 60 * 1000) return sleep(state.pausedUntil - Date.now()).then(function () { return send(path, opts, tries + 1); });
          throw err("slow", { wait: ms });
        }
        if (res.status === 401 && !opts.anon) {
          if (!opts.key) markReplace();
          throw err("replace");
        }
        if (!res.ok) throw err("http", { status: res.status, body: body });
        return body;
      });
    });
  }
  function err(code, extra) {
    var e = new Error(code);
    e.code = code;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }
  function markReplace() {
    if (state.status === "replace") return;
    state.status = "replace";
    put("status", "replace").catch(function () {});
  }

  /* ---------- data ---------- */
  function trimUser(u) {
    if (!u) return null;
    return { id: snowflake(u.id), name: String(u.global_name || u.username || ""), avatar: u.avatar ? String(u.avatar) : "" };
  }
  function trimGuild(g) {
    return { id: snowflake(g.id), name: String(g.name || ""), icon: g.icon ? String(g.icon) : "" };
  }
  function trimDm(c) {
    var people = (c.recipients || []).map(trimUser).filter(Boolean);
    return { id: snowflake(c.id), name: String(c.name || people.map(function (p) { return p.name; }).join(", ")), last: String(c.last_message_id || "0"), people: people };
  }
  function byLast(a, b) {
    return a.last.length !== b.last.length ? b.last.length - a.last.length : (a.last < b.last ? 1 : a.last > b.last ? -1 : 0);
  }

  function boot() {
    if (state.loaded) return Promise.resolve();
    return Promise.all([get("token"), get("status"), get("cache")]).then(function (got) {
      state.loaded = true;
      state.has = !!got[0];
      state.status = state.has ? (got[1] === "replace" ? "replace" : "ok") : "none";
      var c = got[2] || {};
      state.me = c.me || null;
      state.guilds = c.guilds || null;
      state.dms = c.dms || null;
      state.savedAt = Number(c.at) || 0;
    }).catch(function () { state.loaded = true; });
  }
  function saveCache() {
    return put("cache", { me: state.me, guilds: state.guilds, dms: state.dms, at: state.savedAt }).catch(function () {});
  }

  function refresh(force, haveMe) {
    if (!state.has || state.status === "replace") return Promise.resolve();
    if (!force && state.savedAt && Date.now() - state.savedAt < FRESH_MS) return Promise.resolve();
    if (state.busy) return Promise.resolve();
    state.busy = true;
    state.err = "";
    paint();
    return (haveMe ? Promise.resolve(null) : discord("/users/@me")).then(function (me) {
      if (me) state.me = trimUser(me);
      return discord("/users/@me/guilds?limit=200");
    }).then(function (guilds) {
      state.guilds = (guilds || []).map(trimGuild).filter(function (g) { return g.id; });
      return discord("/users/@me/channels");
    }).then(function (dms) {
      state.dms = (dms || []).filter(function (c) { return c.type === 1 || c.type === 3; }).map(trimDm).sort(byLast).slice(0, 100);
      state.savedAt = Date.now();
      return saveCache();
    }).catch(failNote).then(function () { state.busy = false; paint(); });
  }
  function failNote(e) {
    var code = e && e.code;
    if (code === "replace") state.err = "";
    else if (code === "slow") state.err = tr("Discord asked to slow down. Try again in a few minutes.");
    else state.err = tr("Couldn’t reach Discord from this device.");
  }

  function openGuild(id) {
    var g = (state.guilds || []).filter(function (x) { return x.id === id; })[0];
    if (!g) return;
    state.view = "guild";
    state.guild = g;
    state.channels = null;
    state.err = "";
    paint();
    discord("/guilds/" + id + "/channels").then(function (list) {
      var cats = {};
      (list || []).forEach(function (c) { if (c.type === 4) cats[c.id] = String(c.name || ""); });
      state.channels = (list || []).filter(function (c) { return TEXT_TYPES[c.type]; }).sort(function (a, b) {
        return (Number(a.position) || 0) - (Number(b.position) || 0);
      }).map(function (c) { return { id: snowflake(c.id), name: String(c.name || ""), cat: cats[c.parent_id] || "" }; });
    }).catch(function (e) { state.channels = []; failNote(e); }).then(paint);
  }
  function trimMessage(m) {
    var u = trimUser(m.author) || { id: "", name: "" };
    var ref = m.referenced_message && trimUser(m.referenced_message.author);
    return {
      id: snowflake(m.id), uid: u.id, who: u.name, text: String(m.content || ""), at: String(m.timestamp || ""),
      files: (m.attachments || []).length + (m.embeds || []).length,
      re: ref && ref.name ? ref.name : ""
    };
  }
  function openChannel(id, name, back) {
    if (!snowflake(id)) return;
    state.channel = { id: id, name: name, back: back };
    state.draft = "";
    state.replyTo = null;
    state.sendNote = "";
    state.emoji = false;
    state.person = null;
    state.view = "channel";
    state.messages = null;
    state.err = "";
    paint();
    discord("/channels/" + id + "/messages?limit=25").then(function (list) {
      if (!state.channel || state.channel.id !== id) return;
      state.messages = (list || []).map(trimMessage).reverse();
    }).catch(function (e) {
      state.messages = [];
      if (e && e.code === "http" && (e.status === 403 || e.status === 404)) state.err = tr("This account can’t read that channel.");
      else failNote(e);
    }).then(paint);
  }

  /* ---------- send (one per human tap or Enter) ---------- */
  function makeNonce() {
    /* A snowflake-shaped number so Discord can match the echo to this send. */
    var n = String(Date.now() - 1420070400000) + String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
    return n.slice(0, 19);
  }
  function sendGuard(now) {
    if (state.sendWaitUntil > now) return tr("Discord asked to wait. You can send again in {n} seconds.", { n: Math.ceil((state.sendWaitUntil - now) / 1000) });
    if (now - state.lastSendAt < SEND_GAP_MS) return tr("One message at a time. Try again in a moment.");
    state.sendTimes = state.sendTimes.filter(function (t) { return now - t < 60 * 1000; });
    if (state.sendTimes.length >= SEND_PER_MIN) {
      return tr("That’s a lot of messages this minute. You can send again in {n} seconds.", { n: Math.ceil((state.sendTimes[0] + 60 * 1000 - now) / 1000) });
    }
    return "";
  }
  function findPending(nonce) {
    return (state.messages || []).filter(function (m) { return m.nonce === nonce; })[0] || null;
  }
  /* Called only from the composer's submit (a tap on Post or Enter) and from a
     tap on "Try again" on a message that didn't go out. */
  function sendMessage(text, retryNonce) {
    var ch = state.channel;
    if (!ch || !snowflake(ch.id) || state.sending || state.status !== "ok") return Promise.resolve(false);
    var retry = retryNonce ? findPending(retryNonce) : null;
    if (retryNonce && (!retry || !retry.failed)) return Promise.resolve(false);
    text = retry ? retry.text : String(text || "").replace(/\s+$/, "").replace(/^\s*\n/, "");
    if (!text.trim()) return Promise.resolve(false);
    if (text.length > MAX_LEN) { state.sendNote = tr("Messages can be up to {n} characters.", { n: MAX_LEN }); paint(); return Promise.resolve(false); }
    var now = Date.now();
    var wait = sendGuard(now);
    if (wait) { state.sendNote = wait; paint(); return Promise.resolve(false); }
    state.lastSendAt = now;
    state.sendTimes.push(now);
    state.sendNote = "";
    var msg = retry || {
      id: "", uid: state.me ? state.me.id : "", who: state.me ? state.me.name : "", text: text, at: new Date().toISOString(), files: 0,
      re: state.replyTo ? state.replyTo.who : "", reId: state.replyTo ? state.replyTo.id : "", nonce: makeNonce(), mine: true
    };
    msg.pending = true;
    msg.failed = false;
    if (!retry) {
      state.messages = (state.messages || []).concat([msg]);
      state.draft = "";
      state.replyTo = null;
      state.emoji = false;
    }
    paint();
    scrollEnd();
    return postMessage(ch, msg, null);
  }
  function postMessage(ch, msg, captchaHeaders) {
    var body = { content: msg.text, nonce: msg.nonce, tts: false, flags: 0, allowed_mentions: { parse: ["users"], replied_user: true } };
    if (msg.reId) body.message_reference = { message_id: msg.reId, channel_id: ch.id, fail_if_not_exists: false };
    state.sending = true;
    return send("/channels/" + ch.id + "/messages", { method: "POST", body: body, headers: captchaHeaders, once: true }, 0).then(function (out) {
      var real = out ? trimMessage(out) : null;
      msg.pending = false;
      msg.failed = false;
      if (real && real.id) { msg.id = real.id; msg.at = real.at || msg.at; msg.uid = real.uid || msg.uid; msg.who = real.who || msg.who; }
      if (state.captcha && state.captcha.kind === "send") state.captcha = null;
      return true;
    }).catch(function (e) {
      msg.pending = false;
      msg.failed = true;
      var b = e && e.body;
      if (e && e.code === "http" && b && b.captcha_sitekey) {
        state.captcha = {
          kind: "send", nonce: msg.nonce, channel: ch.id,
          sitekey: String(b.captcha_sitekey),
          rqdata: b.captcha_rqdata ? String(b.captcha_rqdata) : "",
          rqtoken: b.captcha_rqtoken ? String(b.captcha_rqtoken) : "",
          session: b.captcha_session_id ? String(b.captcha_session_id) : "",
          again: !!captchaHeaders
        };
        state.captchaBusy = false;
        state.sendNote = tr("Discord wants a quick check before this message goes out.");
      } else {
        if (state.captcha && state.captcha.kind === "send") state.captcha = null;
        state.sendNote = sendFailText(e);
      }
      return false;
    }).then(function (sent) { state.sending = false; paint(); return sent; });
  }
  function sendFailText(e) {
    var code = e && e.code;
    var dc = e && e.body && Number(e.body.code);
    if (code === "slow") {
      var secs = Math.max(1, Math.ceil((Number(e.wait) || 5000) / 1000));
      state.sendWaitUntil = Date.now() + secs * 1000;
      return tr("Discord asked to wait. You can send again in {n} seconds.", { n: secs });
    }
    if (code === "replace") return "";
    if (code === "http" && dc === 50007) return tr("Discord won’t deliver messages to this person from this account.");
    if (code === "http" && (e.status === 403 || dc === 50013 || dc === 50001)) return tr("This account can’t send messages here.");
    if (code === "http" && dc === 50035) return tr("Discord didn’t accept that message.");
    return tr("Message not sent. Check your connection and tap Try again.");
  }
  function scrollEnd() {
    if (typeof document === "undefined") return;
    var sheet = document.querySelector(".dloc-sheet");
    if (sheet) sheet.scrollTop = sheet.scrollHeight;
  }

  /* ---------- open a DM (only from a tap on a person) ---------- */
  function openDm(person) {
    if (!person || !snowflake(person.id) || state.dmBusy) return;
    if (state.me && person.id === state.me.id) return;
    var known = (state.dms || []).filter(function (c) { return c.people.length === 1 && c.people[0].id === person.id; })[0];
    if (known) { state.person = null; openChannel(known.id, known.name, "dms"); return; }
    var wait = state.lastDmAt + DM_GAP_MS - Date.now();
    if (wait > 0) { state.err = tr("Wait {n} seconds before opening another chat.", { n: Math.ceil(wait / 1000) }); paint(); return; }
    state.lastDmAt = Date.now();
    state.dmBusy = true;
    state.err = "";
    paint();
    discord("/users/@me/channels", { method: "POST", body: { recipients: [person.id] }, once: true }).then(function (c) {
      if (!c || !snowflake(c.id)) throw err("http", { status: 500 });
      var dm = trimDm(c);
      if (!dm.name) dm.name = person.name;
      state.dms = [dm].concat((state.dms || []).filter(function (x) { return x.id !== dm.id; }));
      saveCache();
      state.person = null;
      state.dmBusy = false;
      openChannel(dm.id, dm.name, "dms");
    }).catch(function (e) {
      state.dmBusy = false;
      if (e && e.code === "http") state.err = tr("Discord didn’t open a chat with this person.");
      else failNote(e);
      paint();
    });
  }

  /* ---------- save / remove ---------- */
  function connect(raw) {
    var key = cleanKey(raw);
    if (!key) { state.err = tr("That doesn’t look like a Discord key."); paint(); return Promise.resolve(false); }
    state.busy = true;
    state.err = "";
    state.note = tr("Checking with Discord…");
    paint();
    return discord("/users/@me", { key: key }).then(function (me) {
      return seal(key).then(function (box) {
        key = "";
        return put("token", box);
      }).then(function () { return put("status", "ok"); }).then(function () {
        state.has = true;
        state.status = "ok";
        state.me = trimUser(me);
        state.guilds = null;
        state.dms = null;
        state.savedAt = 0;
        state.note = "";
        state.busy = false;
        return refresh(true, true);
      }).then(function () { return true; });
    }).catch(function (e) {
      key = "";
      state.busy = false;
      state.note = "";
      if (e && e.code === "replace") state.err = tr("Discord didn’t accept that key.");
      else if (e && e.code === "crypto") state.err = tr("This browser can’t keep keys safely.");
      else failNote(e);
      paint();
      return false;
    });
  }
  function remove() {
    state.has = false;
    state.status = "none";
    state.me = state.guilds = state.dms = null;
    state.savedAt = 0;
    state.view = "servers";
    state.invite = null;
    state.captcha = null;
    state.channel = null;
    state.messages = null;
    state.draft = "";
    state.replyTo = null;
    state.person = null;
    state.sendNote = "";
    state.err = "";
    state.note = tr("Key removed from this device.");
    var closing = dbOpen ? dbOpen.then(function (d) { try { d.close(); } catch (e) { /* closed */ } }).catch(function () {}) : Promise.resolve();
    dbOpen = null;
    return closing.then(function () {
      return new Promise(function (resolve) {
        if (!root.indexedDB) { resolve(); return; }
        var req = root.indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = req.onerror = req.onblocked = function () { resolve(); };
      });
    }).then(paint);
  }

  /* ---------- join (tap only) + captcha popup ---------- */
  function inviteCode(raw) {
    var v = String(raw || "").trim();
    var m = v.match(/(?:discord(?:app)?\.com\/invite|discord\.gg)\/([A-Za-z0-9-]{2,32})/i);
    var code = m ? m[1] : v;
    return /^[A-Za-z0-9-]{2,32}$/.test(code) ? code : "";
  }
  function lookUp(raw) {
    var code = inviteCode(raw);
    if (!code) { state.err = tr("Paste a discord.gg invite link."); paint(); return; }
    state.inviteBusy = true;
    state.err = "";
    paint();
    discord("/invites/" + encodeURIComponent(code) + "?with_counts=true", { anon: true }).then(function (inv) {
      var g = inv && inv.guild;
      if (!g) throw err("http", { status: 404 });
      var joined = (state.guilds || []).some(function (x) { return x.id === snowflake(g.id); });
      state.invite = { code: code, id: snowflake(g.id), name: String(g.name || ""), icon: g.icon ? String(g.icon) : "", members: inv.approximate_member_count, joined: joined };
    }).catch(function (e) {
      if (e && e.code === "http") state.err = tr("That invite is expired or invalid.");
      else failNote(e);
    }).then(function () { state.inviteBusy = false; paint(); });
  }
  function join(extraHeaders) {
    var inv = state.invite;
    if (!inv || state.inviteBusy) return;
    var wait = state.lastJoinAt + JOIN_GAP_MS - Date.now();
    if (!extraHeaders && wait > 0) {
      state.err = tr("Wait {n} seconds before joining another server.", { n: Math.ceil(wait / 1000) });
      paint();
      return;
    }
    state.inviteBusy = true;
    state.err = "";
    if (!extraHeaders) state.lastJoinAt = Date.now();
    paint();
    discord("/invites/" + encodeURIComponent(inv.code), { method: "POST", body: {}, headers: extraHeaders }).then(function (body) {
      state.captcha = null;
      state.invite = null;
      state.note = tr("Joined {name}.", { name: inv.name });
      var g = body && body.guild;
      if (g && snowflake(g.id) && !(state.guilds || []).some(function (x) { return x.id === snowflake(g.id); })) {
        state.guilds = (state.guilds || []).concat([trimGuild(g)]);
        saveCache();
      }
    }).catch(function (e) {
      var b = e && e.body;
      if (e && e.code === "http" && b && b.captcha_sitekey) {
        state.captcha = {
          code: inv.code,
          sitekey: String(b.captcha_sitekey),
          rqdata: b.captcha_rqdata ? String(b.captcha_rqdata) : "",
          rqtoken: b.captcha_rqtoken ? String(b.captcha_rqtoken) : "",
          session: b.captcha_session_id ? String(b.captcha_session_id) : "",
          again: !!extraHeaders
        };
        state.captchaBusy = false;
      } else {
        state.captcha = null;
        if (e && e.code === "replace") state.err = "";
        else if (e && e.code === "http") state.err = tr("Discord didn’t let this account join. Open the invite in the Discord app instead.");
        else failNote(e);
      }
    }).then(function () { state.inviteBusy = false; paint(); });
  }
  var hcLoading = null;
  function loadHcaptcha() {
    if (root.hcaptcha && root.hcaptcha.render) return Promise.resolve(root.hcaptcha);
    if (hcLoading) return hcLoading;
    hcLoading = new Promise(function (resolve, reject) {
      var tag = document.createElement("script");
      tag.src = "https://js.hcaptcha.com/1/api.js?render=explicit&recaptchacompat=off";
      tag.async = true;
      tag.onload = function () { root.hcaptcha ? resolve(root.hcaptcha) : reject(new Error("hcaptcha")); };
      tag.onerror = function () { hcLoading = null; reject(new Error("hcaptcha")); };
      document.head.appendChild(tag);
    });
    return hcLoading;
  }
  function captchaFailed() {
    if (!state.captcha) return;
    state.captcha.broken = true;
    paint();
  }
  function mountCaptcha() {
    var host = document.getElementById("dloc-hc");
    var want = state.captcha;
    if (!host || !want || want.broken || host.getAttribute("data-on")) return;
    host.setAttribute("data-on", "1");
    loadHcaptcha().then(function (hc) {
      if (state.captcha !== want || !document.body.contains(host)) return;
      var dark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
      var wid = hc.render(host, {
        sitekey: want.sitekey,
        theme: dark ? "dark" : "light",
        callback: function (answer) {
          /* One join per human answer. */
          if (state.captcha !== want || state.captchaBusy || !answer) return;
          state.captchaBusy = true;
          var headers = { "X-Captcha-Key": String(answer), "X-Captcha-Rqtoken": want.rqtoken, "X-Captcha-Session-Id": want.session };
          if (want.kind === "send") {
            var msg = findPending(want.nonce);
            if (!msg || !state.channel || state.channel.id !== want.channel) { state.captcha = null; paint(); return; }
            msg.failed = false;
            msg.pending = true;
            paint();
            postMessage(state.channel, msg, headers);
          } else join(headers);
        },
        "expired-callback": function () { state.err = tr("The check expired. Solve it again."); paintNote(); },
        "error-callback": captchaFailed
      });
      if (want.rqdata && hc.setData) hc.setData(wid, { rqdata: want.rqdata });
    }).catch(captchaFailed);
  }

  /* ---------- UI ---------- */
  var ICON_DISCORD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.3 5.3A16.6 16.6 0 0 0 15.2 4l-.5 1a15.3 15.3 0 0 0-5.4 0l-.5-1a16.5 16.5 0 0 0-4.1 1.3C2.1 9.2 1.4 13 1.7 16.7a16.7 16.7 0 0 0 5 2.6l1.1-1.7a10.8 10.8 0 0 1-1.7-.8l.4-.3a11.9 11.9 0 0 0 11 0l.4.3c-.5.3-1.1.6-1.7.8l1.1 1.7a16.6 16.6 0 0 0 5-2.6c.4-4.3-.7-8-3-11.4zM8.7 14.4c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></svg>';
  function guildIcon(g) {
    if (g.icon && g.id) return '<img class="dloc-av" alt="" loading="lazy" referrerpolicy="no-referrer" src="https://cdn.discordapp.com/icons/' + esc(g.id) + "/" + esc(g.icon) + '.png?size=64">';
    return '<span class="dloc-av">' + esc((g.name || "?").slice(0, 2)) + "</span>";
  }
  function userIcon(u) {
    if (u && u.avatar && u.id) return '<img class="dloc-av" alt="" loading="lazy" referrerpolicy="no-referrer" src="https://cdn.discordapp.com/avatars/' + esc(u.id) + "/" + esc(u.avatar) + '.png?size=64">';
    return '<span class="dloc-av">' + esc(((u && u.name) || "?").slice(0, 1)) + "</span>";
  }
  function warnText() { return tr("Stays on this device only. Use a spare account. Discord may lock accounts used this way."); }
  function replaceNote() {
    return '<div class="dloc-calm" role="status"><p>' + esc(tr("This key needs replacing. Discord signed it out, so reads are paused. Paste a new key from the spare account.")) + "</p></div>";
  }

  function sectionHtml() {
    boot().then(function () { paintSection(); });
    return '<div class="set-block dloc-section" id="dloc-section">' + sectionInner() + "</div>";
  }
  function sectionInner() {
    var status = !state.loaded ? "" : state.status === "replace"
      ? tr("Key needs replacing")
      : state.has ? (state.me && state.me.name ? tr("Connected as {name}", { name: state.me.name }) : tr("Connected")) : tr("Not connected");
    return '<h2 class="dloc-h">' + ICON_DISCORD + "<span>" + esc(tr("Connect your Discord (local)")) + "</span></h2>" +
      '<p class="phandle">' + esc(warnText()) + "</p>" +
      (status ? '<p class="dloc-status' + (state.status === "replace" ? " is-calm" : "") + '">' + esc(status) + "</p>" : "") +
      (state.status === "replace" ? replaceNote() : "") +
      '<div class="dloc-acts">' +
      (state.has
        ? '<button type="button" class="dloc-btn" data-dloc="open">' + esc(state.status === "replace" ? tr("Replace key") : tr("Open")) + "</button>"
        : '<button type="button" class="dloc-btn" data-dloc="get-key">' + esc(tr("Get your key")) + "</button>" +
          '<button type="button" class="dloc-btn ghost" data-dloc="open">' + esc(tr("I already have a key")) + "</button>") +
      (state.has ? '<button type="button" class="dloc-btn ghost" data-dloc="remove">' + esc(tr("Remove key")) + "</button>" : "") +
      (state.note && !state.open ? '<span class="dloc-note">' + esc(state.note) + "</span>" : "") +
      "</div>";
  }
  function paintSection() {
    var el = typeof document !== "undefined" ? document.getElementById("dloc-section") : null;
    if (el) el.innerHTML = sectionInner();
  }

  function keyForm() {
    return '<div class="dloc-get">' +
      '<button type="button" class="dloc-btn" data-dloc="get-key">' + esc(tr("Get your key")) + "</button>" +
      '<p class="dloc-hint">' + esc(tr("A short guided walkthrough. Or paste a key you already have below.")) + "</p></div>" +
      '<form class="dloc-key" data-dloc-form="key" autocomplete="off">' +
      '<label class="dloc-label" for="dloc-key">' + esc(tr("Spare account key")) + "</label>" +
      '<input id="dloc-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text" placeholder="' + esc(tr("Paste the key")) + '">' +
      '<button type="submit" class="dloc-btn"' + (state.busy ? " disabled" : "") + ">" + esc(state.busy ? tr("Checking…") : tr("Save on this device")) + "</button>" +
      "</form>";
  }
  function tabs() {
    var on = state.view === "dms" ? "dms" : "servers";
    return '<div class="dloc-tabs" role="tablist">' +
      '<button type="button" role="tab" data-dloc="tab" data-v="servers" aria-selected="' + (on === "servers") + '">' + esc(tr("Servers")) + "</button>" +
      '<button type="button" role="tab" data-dloc="tab" data-v="dms" aria-selected="' + (on === "dms") + '">' + esc(tr("Direct messages")) + "</button>" +
      "</div>";
  }
  function listServers() {
    if (!state.guilds) return '<p class="dloc-hint">' + esc(state.busy ? tr("Loading…") : tr("Nothing loaded yet.")) + "</p>";
    if (!state.guilds.length) return '<p class="dloc-hint">' + esc(tr("This account isn’t in any servers yet.")) + "</p>";
    return '<div class="dloc-list">' + state.guilds.map(function (g) {
      return '<button type="button" class="dloc-row" data-dloc="guild" data-id="' + esc(g.id) + '">' + guildIcon(g) + "<b>" + esc(g.name) + "</b></button>";
    }).join("") + "</div>";
  }
  function listDms() {
    if (!state.dms) return '<p class="dloc-hint">' + esc(state.busy ? tr("Loading…") : tr("Nothing loaded yet.")) + "</p>";
    if (!state.dms.length) return '<p class="dloc-hint">' + esc(tr("No direct messages.")) + "</p>";
    return '<div class="dloc-list">' + state.dms.map(function (c) {
      return '<button type="button" class="dloc-row" data-dloc="dm" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '">' + userIcon(c.people[0]) + "<b>" + esc(c.name || tr("Direct messages")) + "</b></button>";
    }).join("") + "</div>";
  }
  function joinBox() {
    var inv = state.invite;
    var body = '<h3>' + esc(tr("Join a server")) + "</h3>" +
      '<form class="dloc-key" data-dloc-form="invite" autocomplete="off"><input id="dloc-inv" type="text" autocomplete="off" spellcheck="false" placeholder="discord.gg/…">' +
      '<button type="submit" class="dloc-btn ghost"' + (state.inviteBusy ? " disabled" : "") + ">" + esc(tr("Look up")) + "</button></form>";
    if (inv) {
      body += '<div class="dloc-invite">' + guildIcon(inv) + "<div><b>" + esc(inv.name) + "</b>" +
        (inv.members != null ? "<span>" + esc(tr("{count} members", { count: inv.members })) + "</span>" : "") + "</div></div>" +
        (inv.joined
          ? '<p class="dloc-hint">' + esc(tr("This account is already in this server.")) + "</p>"
          : '<p class="dloc-hint">' + esc(tr("Joining happens only when you tap. If Discord asks for a captcha, you solve it here.")) + "</p>" +
            '<button type="button" class="dloc-btn" data-dloc="join"' + (state.inviteBusy ? " disabled" : "") + ">" + esc(state.inviteBusy ? tr("Joining…") : tr("Join {name}", { name: inv.name })) + "</button>");
    }
    return body;
  }
  var ICON_REPLY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z"/></svg>';
  var ICON_EMOJI = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 9.5C8 8.119 8.672 7 9.5 7S11 8.119 11 9.5 10.328 12 9.5 12 8 10.881 8 9.5zm6.5 2.5c.828 0 1.5-1.119 1.5-2.5S15.328 7 14.5 7 13 8.119 13 9.5s.672 2.5 1.5 2.5zM12 16c-2.224 0-3.021-2.227-3.051-2.316l-1.897.633c.05.15 1.271 3.684 4.949 3.684s4.898-3.533 4.949-3.684l-1.896-.638c-.033.095-.83 2.322-3.053 2.322zm10.25-4.001c0 5.652-4.598 10.25-10.25 10.25S1.75 17.652 1.75 12 6.348 1.75 12 1.75 22.25 6.348 22.25 12zm-2 0c0-4.549-3.701-8.25-8.25-8.25S3.75 7.451 3.75 12s3.701 8.25 8.25 8.25 8.25-3.701 8.25-8.25z"/></svg>';
  function msgRow(m) {
    var when = "";
    try { when = m.at ? new Date(m.at).toLocaleString(root.SI18n ? root.SI18n.locale() : undefined, { dateStyle: "short", timeStyle: "short" }) : ""; } catch (e) { when = ""; }
    var mine = m.mine || (state.me && m.uid && m.uid === state.me.id);
    var who = !mine && m.uid
      ? '<button type="button" class="dloc-who" data-dloc="person" data-id="' + esc(m.uid) + '" data-name="' + esc(m.who) + '">' + esc(m.who) + "</button>"
      : "<b>" + esc(m.who) + "</b>";
    var status = m.pending ? '<p class="dloc-sending">' + esc(tr("Sending…")) + "</p>"
      : m.failed ? '<p class="dloc-failed">' + esc(tr("Not sent.")) + ' <button type="button" class="dloc-retry" data-dloc="retry" data-nonce="' + esc(m.nonce) + '">' + esc(tr("Try again")) + "</button></p>"
      : "";
    return '<li class="' + (m.pending ? "is-pending" : "") + (m.failed ? " is-failed" : "") + '"' + (m.nonce ? ' data-nonce="' + esc(m.nonce) + '"' : "") + ">" +
      "<p>" + who + " <time>" + esc(when) + "</time></p>" +
      (m.re ? '<p class="dloc-re">' + esc(tr("Replying to")) + " <span>@" + esc(m.re) + "</span></p>" : "") +
      (m.text ? '<p class="dloc-txt">' + esc(m.text) + "</p>" : "") +
      (m.files ? '<p class="dloc-hint">' + esc(tr("Attachments: {n}", { n: m.files })) + "</p>" : "") +
      status +
      (m.id && !m.pending ? '<div class="dloc-acts-row"><button type="button" class="dloc-ic" data-dloc="reply" data-id="' + esc(m.id) + '" data-name="' + esc(m.who) + '" aria-label="' + esc(tr("Reply")) + '">' + ICON_REPLY + "</button></div>" : "") +
      "</li>";
  }
  function composer() {
    var ch = state.channel || {};
    var r = state.replyTo;
    var len = state.draft.length;
    var over = len > MAX_LEN;
    var empty = !state.draft.trim();
    return '<form class="dloc-compose" data-dloc-form="send" autocomplete="off">' +
      (r ? '<p class="dloc-replying">' + esc(tr("Replying to")) + " <span>@" + esc(r.who) + '</span><button type="button" class="dloc-x sm" data-dloc="reply-cancel" aria-label="' + esc(tr("Cancel reply")) + '">×</button></p>' : "") +
      '<div class="dloc-compose-row">' + userIcon(state.me) +
      '<textarea id="dloc-msg" rows="1" maxlength="' + (MAX_LEN + 200) + '" enterkeyhint="send" aria-label="' + esc(tr("Message")) + '" placeholder="' +
      esc(r ? tr("Post your reply") : tr("Message {name}", { name: ch.name || "" })) + '">' + esc(state.draft) + "</textarea></div>" +
      (state.emoji ? '<div class="dloc-emoji-grid" role="listbox" aria-label="' + esc(tr("Emoji")) + '">' + EMOJI.map(function (e) {
        return '<button type="button" data-dloc="emoji-pick" data-e="' + esc(e) + '">' + esc(e) + "</button>";
      }).join("") + "</div>" : "") +
      '<div class="dloc-compose-bar"><button type="button" class="dloc-ic blue" data-dloc="emoji" aria-label="' + esc(tr("Emoji")) + '" aria-expanded="' + !!state.emoji + '">' + ICON_EMOJI + "</button>" +
      '<span class="dloc-count' + (over ? " over" : "") + '">' + (len > MAX_LEN - 200 ? esc(String(MAX_LEN - len)) : "") + "</span>" +
      '<button type="submit" class="dloc-post"' + (empty || over || state.sending ? " disabled" : "") + ">" + esc(r ? tr("Reply") : tr("Post")) + "</button></div>" +
      '<p class="dloc-send-note" role="status" aria-live="polite">' + esc(state.sendNote) + "</p>" +
      "</form>";
  }
  function channelView() {
    var ch = state.channel || {};
    var head = '<button type="button" class="dloc-back" data-dloc="back" aria-label="' + esc(tr("Back")) + '">‹</button><b>' + esc(ch.name || "") + "</b>";
    var rows;
    if (!state.messages) rows = '<p class="dloc-hint">' + esc(tr("Loading…")) + "</p>";
    else if (!state.messages.length) rows = '<p class="dloc-hint">' + esc(tr("No messages to show.")) + "</p>";
    else rows = '<ol class="dloc-msgs">' + state.messages.map(msgRow).join("") + "</ol>";
    return '<div class="dloc-sub">' + head + "</div>" +
      '<p class="dloc-hint">' + esc(tr("Messages you post here go out from the spare account, one tap at a time.")) + "</p>" + rows +
      (state.messages ? composer() : "") + (state.person ? personView() : "");
  }
  function personView() {
    var p = state.person;
    return '<div class="dloc-pop" role="dialog" aria-modal="true" aria-labelledby="dloc-person-h"><div class="dloc-pop-card">' +
      '<header><b id="dloc-person-h">' + esc(p.name) + '</b><button type="button" class="dloc-x" data-dloc="person-close" aria-label="' + esc(tr("Close")) + '">×</button></header>' +
      '<p class="dloc-hint">' + esc(tr("Start a direct message with this person from the spare account.")) + "</p>" +
      '<button type="button" class="dloc-post" data-dloc="dm-open"' + (state.dmBusy ? " disabled" : "") + ">" + esc(state.dmBusy ? tr("Opening…") : tr("Message")) + "</button>" +
      "</div></div>";
  }
  function guildView() {
    var g = state.guild || {};
    var head = '<button type="button" class="dloc-back" data-dloc="back" aria-label="' + esc(tr("Back")) + '">‹</button><b>' + esc(g.name || "") + "</b>";
    var rows;
    if (!state.channels) rows = '<p class="dloc-hint">' + esc(tr("Loading…")) + "</p>";
    else if (!state.channels.length) rows = '<p class="dloc-hint">' + esc(tr("No channels this account can read.")) + "</p>";
    else rows = '<div class="dloc-list">' + state.channels.map(function (c) {
      return '<button type="button" class="dloc-ch" data-dloc="channel" data-id="' + esc(c.id) + '" data-name="' + esc("#" + c.name) + '"><span>#</span><b>' + esc(c.name) + "</b>" + (c.cat ? "<em>" + esc(c.cat) + "</em>" : "") + "</button>";
    }).join("") + "</div>";
    return '<div class="dloc-sub">' + head + "</div>" + rows;
  }
  function captchaView() {
    var c = state.captcha;
    var sending = c.kind === "send";
    var url = sending ? "https://discord.com/channels/@me" : "https://discord.com/invite/" + encodeURIComponent(c.code);
    return '<div class="dloc-pop" role="dialog" aria-modal="true" aria-labelledby="dloc-cap-h"><div class="dloc-pop-card">' +
      '<header><b id="dloc-cap-h">' + esc(tr("Discord wants a quick check")) + '</b><button type="button" class="dloc-x" data-dloc="cap-close" aria-label="' + esc(tr("Close")) + '">×</button></header>' +
      (c.broken
        ? '<p class="dloc-hint">' + esc(sending ? tr("The check couldn’t load here. Send this message in the Discord app instead.") : tr("The check couldn’t load here. Open the invite in the Discord app with the spare account instead.")) + "</p>"
        : '<p class="dloc-hint">' + esc(c.again ? tr("Discord didn’t accept that check. Solve the new one.") : sending ? tr("Solve it yourself to send your message. Nothing solves it for you.") : tr("Solve it yourself to finish joining. Nothing solves it for you.")) + "</p>" +
          '<div id="dloc-hc" class="dloc-hc"></div>' +
          (state.captchaBusy ? '<p class="dloc-hint">' + esc(sending ? tr("Sending…") : tr("Joining…")) + "</p>" : "")) +
      '<a class="dloc-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(tr("Open in Discord")) + "</a>" +
      "</div></div>";
  }
  function sheetHtml() {
    if (!state.open) return "";
    var body;
    if (!state.has || state.status === "replace") {
      body = (state.status === "replace" ? replaceNote() : "") + keyForm() +
        (state.has ? '<button type="button" class="dloc-link" data-dloc="remove">' + esc(tr("Remove key")) + "</button>" : "");
    } else if (state.view === "guild") body = guildView();
    else if (state.view === "channel") body = channelView();
    else {
      body = (state.me ? '<div class="dloc-me">' + userIcon(state.me) + "<div><b>" + esc(state.me.name) + "</b><span>" + esc(tr("Spare account on this device")) + "</span></div>" +
        '<button type="button" class="dloc-btn ghost" data-dloc="refresh"' + (state.busy ? " disabled" : "") + ">" + esc(state.busy ? tr("Loading…") : tr("Refresh")) + "</button></div>" : "") +
        tabs() + (state.view === "dms" ? listDms() : listServers() + joinBox()) +
        '<button type="button" class="dloc-link danger" data-dloc="remove">' + esc(tr("Remove key")) + "</button>";
    }
    return '<div class="dloc-sheet" role="dialog" aria-modal="true" aria-labelledby="dloc-title">' +
      '<header><b id="dloc-title">' + esc(tr("Connect your Discord (local)")) + '</b><button type="button" class="dloc-x" data-dloc="close" aria-label="' + esc(tr("Close")) + '">×</button></header>' +
      '<p class="dloc-warn">' + esc(warnText()) + "</p>" +
      (!state.has || state.status === "replace" || state.view === "servers" || state.view === "dms"
        ? '<div class="dloc-self"><p>' + esc(tr("You can read and send messages here as the spare account. Every message is one you type and send yourself. Discord may flag automated or self-bot use, so keep it to a spare account.")) + "</p></div>"
        : "") +
      '<p class="dloc-hint">' + esc(tr("Requests go straight from this device to Discord. Our servers never see the key.")) + "</p>" +
      '<p class="dloc-err" aria-live="polite">' + esc(state.err) + "</p>" +
      (state.note ? '<p class="dloc-note">' + esc(state.note) + "</p>" : "") +
      body + "</div>" + (state.captcha ? captchaView() : "");
  }
  function paintNote() {
    var el = document.querySelector(".dloc-sheet .dloc-err");
    if (el) el.textContent = state.err; else paint();
  }
  function paint() {
    if (typeof document === "undefined") return;
    paintSection();
    var host = document.getElementById("dloc-host");
    if (!state.open) { if (host) host.remove(); return; }
    if (!host) {
      host = document.createElement("div");
      host.id = "dloc-host";
      document.body.appendChild(host);
    }
    var box = document.getElementById("dloc-msg");
    var typing = box && document.activeElement === box ? { a: box.selectionStart, b: box.selectionEnd } : null;
    var sheetEl = host.querySelector(".dloc-sheet");
    var scrolled = sheetEl ? sheetEl.scrollTop : 0;
    var hc = document.getElementById("dloc-hc");
    var keepHc = hc && state.captcha && hc.getAttribute("data-on") && !state.captcha.broken ? hc : null;
    host.innerHTML = sheetHtml();
    if (keepHc) {
      var slot = document.getElementById("dloc-hc");
      if (slot) slot.parentNode.replaceChild(keepHc, slot);
    }
    var sheetNew = host.querySelector(".dloc-sheet");
    if (sheetNew && scrolled) sheetNew.scrollTop = scrolled;
    var boxNew = document.getElementById("dloc-msg");
    if (boxNew) {
      fitBox(boxNew);
      if (typing) {
        try { boxNew.focus({ preventScroll: true }); boxNew.setSelectionRange(Math.min(typing.a, boxNew.value.length), Math.min(typing.b, boxNew.value.length)); } catch (e) { /* old browser */ }
      }
    }
    mountCaptcha();
  }

  function fitBox(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }
  function syncComposer() {
    var box = document.getElementById("dloc-msg");
    if (!box) return;
    state.draft = box.value;
    fitBox(box);
    var form = box.closest(".dloc-compose");
    var post = form && form.querySelector(".dloc-post");
    var over = state.draft.length > MAX_LEN;
    if (post) post.disabled = !state.draft.trim() || over || state.sending;
    var count = form && form.querySelector(".dloc-count");
    if (count) { count.textContent = state.draft.length > MAX_LEN - 200 ? String(MAX_LEN - state.draft.length) : ""; count.classList.toggle("over", over); }
  }
  function insertEmoji(e) {
    var box = document.getElementById("dloc-msg");
    var v = state.draft;
    var a = box ? box.selectionStart : v.length;
    var b = box ? box.selectionEnd : v.length;
    state.draft = v.slice(0, a) + e + v.slice(b);
    paint();
    var nb = document.getElementById("dloc-msg");
    if (nb) { try { nb.focus({ preventScroll: true }); nb.setSelectionRange(a + e.length, a + e.length); } catch (x) { /* old browser */ } }
  }

  function open() {
    state.open = true;
    state.err = "";
    state.note = "";
    if (state.view !== "dms") state.view = "servers";
    boot().then(function () {
      paint();
      var input = document.getElementById("dloc-key");
      if (input) input.focus();
      refresh(false);
    });
  }
  function close() {
    state.open = false;
    state.captcha = null;
    state.person = null;
    paint();
  }

  function onClick(event) {
    var t = event.target;
    var btn = t && t.closest ? t.closest("[data-dloc]") : null;
    if (!btn) {
      if (state.open && t && t.id === "dloc-host" && !state.captcha) close();
      return;
    }
    event.preventDefault();
    var act = btn.getAttribute("data-dloc");
    if (act === "open") open();
    else if (act === "get-key") {
      if (root.DiscordKeyHelper && root.DiscordKeyHelper.open) root.DiscordKeyHelper.open();
      else open();
    }
    else if (act === "close") close();
    else if (act === "remove") {
      if (!root.confirm || root.confirm(tr("Remove the Discord key from this device?"))) remove();
    } else if (act === "refresh") refresh(true);
    else if (act === "tab") { state.view = btn.getAttribute("data-v") === "dms" ? "dms" : "servers"; paint(); }
    else if (act === "guild") openGuild(btn.getAttribute("data-id"));
    else if (act === "channel") openChannel(btn.getAttribute("data-id"), btn.getAttribute("data-name"), "guild");
    else if (act === "dm") openChannel(btn.getAttribute("data-id"), btn.getAttribute("data-name"), "dms");
    else if (act === "back") {
      state.err = "";
      if (state.view === "channel" && state.channel && state.channel.back === "guild") state.view = "guild";
      else state.view = state.view === "channel" && state.channel && state.channel.back === "dms" ? "dms" : "servers";
      paint();
    } else if (act === "join") join(null);
    else if (act === "cap-close") { state.captcha = null; state.captchaBusy = false; paint(); }
    else if (act === "reply") {
      var rid = snowflake(btn.getAttribute("data-id"));
      if (rid) { state.replyTo = { id: rid, who: btn.getAttribute("data-name") || "" }; paint(); var rb = document.getElementById("dloc-msg"); if (rb) rb.focus(); }
    } else if (act === "reply-cancel") { state.replyTo = null; paint(); }
    else if (act === "emoji") { state.emoji = !state.emoji; paint(); }
    else if (act === "emoji-pick") insertEmoji(btn.getAttribute("data-e") || "");
    else if (act === "retry") sendMessage("", btn.getAttribute("data-nonce"));
    else if (act === "person") {
      var pid = snowflake(btn.getAttribute("data-id"));
      if (pid && !(state.me && pid === state.me.id)) { state.person = { id: pid, name: btn.getAttribute("data-name") || "" }; paint(); }
    } else if (act === "person-close") { state.person = null; paint(); }
    else if (act === "dm-open") openDm(state.person);
  }
  function onSubmit(event) {
    var form = event.target && event.target.closest ? event.target.closest("[data-dloc-form]") : null;
    if (!form) return;
    event.preventDefault();
    var kind = form.getAttribute("data-dloc-form");
    if (kind === "key") {
      var input = document.getElementById("dloc-key");
      var raw = input ? input.value : "";
      if (input) input.value = "";
      connect(raw);
    } else if (kind === "send") {
      var box = document.getElementById("dloc-msg");
      if (box) state.draft = box.value;
      sendMessage(state.draft, null);
    } else if (kind === "invite") {
      var inv = document.getElementById("dloc-inv");
      lookUp(inv ? inv.value : "");
    }
  }
  function onKey(event) {
    if (!state.open) return;
    var t = event.target;
    if (event.key === "Enter" && t && t.id === "dloc-msg" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      /* Enter sends once; holding the key down never sends again. */
      event.preventDefault();
      if (event.repeat) return;
      state.draft = t.value;
      sendMessage(state.draft, null);
      return;
    }
    if (event.key !== "Escape") return;
    if (state.captcha) { state.captcha = null; paint(); }
    else if (state.person) { state.person = null; paint(); }
    else if (state.replyTo) { state.replyTo = null; paint(); }
    else close();
  }
  function onInput(event) {
    if (event.target && event.target.id === "dloc-msg") syncComposer();
  }

  var api = {
    sectionHtml: sectionHtml,
    open: open,
    close: close,
    remove: remove,
    connect: connect,
    status: function () { return boot().then(function () { return state.status; }); },
    _test: { cleanKey: cleanKey, inviteCode: inviteCode, state: state, unseal: unseal, get: get, API: API, SEND_GAP_MS: SEND_GAP_MS, SEND_PER_MIN: SEND_PER_MIN }
  };
  root.DiscordLocal = api;
  if (typeof document !== "undefined") {
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("input", onInput);
    root.addEventListener("viktorych-account-deleted", function () { remove(); });
  }
})(typeof window !== "undefined" ? window : this);
