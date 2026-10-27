/* One SQLite-backed Durable Object per account.
   A generic topic channel, not a second copy of the notification tables.

   Topics
   - notifications: new items, the read cursor, and the badge. Published
     by the Worker after it has written D1.
   - presence: reserved for presence and Do not disturb. Same subscribe
     and server-publish protocol. Add that topic; do not add a second
     class or binding.

   Hibernation
   Sockets are accepted with ctx.acceptWebSocket. Subscriptions live on
   the socket attachment, so the object can sleep between messages.
   There is no alarm and no server ping. Pages connect only while they
   are visible and close the socket when they are hidden. A hidden page
   does not spend a request. D1 stays the source of truth. This object
   only fans out and keeps a short replay log.

   Clients may subscribe and unsubscribe. They cannot publish. The
   Worker publishes with hubPublish after it has checked the session. */

const TOPIC_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_TOPICS = 8;
const MAX_LOG = 40;
const MAX_BODY = 8000;

export function validTopic(topic) {
  return TOPIC_RE.test(String(topic || ""));
}

export class AccountHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)"
    );
    ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS events_topic ON events(topic, id)");
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/publish" || url.pathname.endsWith("/publish")) {
      if (request.headers.get("x-hub-from") !== "worker") return new Response("forbidden", { status: 403 });
      let body = null;
      try { body = await request.json(); }
      catch (err) { return new Response("bad_json", { status: 400 }); }
      const topic = String(body && body.topic || "");
      if (!validTopic(topic)) return new Response("bad_topic", { status: 400 });
      const data = body && body.data && typeof body.data === "object" ? body.data : {};
      let text = "";
      try { text = JSON.stringify(data); }
      catch (err) { return new Response("bad_json", { status: 400 }); }
      if (text.length > MAX_BODY) return new Response("too_large", { status: 413 });
      const cursor = this.record(topic, text);
      this.fanout(topic, JSON.stringify({ op: "event", topic, cursor, data }));
      return new Response(JSON.stringify({ ok: true, cursor }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (String(request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ topics: [] });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  record(topic, text) {
    this.ctx.storage.sql.exec(
      "INSERT INTO events (topic, body, created_at) VALUES (?, ?, ?)",
      topic,
      text,
      Date.now()
    );
    const row = this.ctx.storage.sql.exec("SELECT last_insert_rowid() AS id").one();
    const id = Number(row && row.id) || 0;
    const ids = this.ctx.storage.sql.exec(
      "SELECT id FROM events WHERE topic = ? ORDER BY id DESC",
      topic
    ).toArray();
    if (ids.length > MAX_LOG) {
      const cut = Number(ids[MAX_LOG] && ids[MAX_LOG].id) || 0;
      if (cut) this.ctx.storage.sql.exec("DELETE FROM events WHERE topic = ? AND id <= ?", topic, cut);
    }
    return id;
  }

  fanout(topic, message) {
    const sockets = this.ctx.getWebSockets();
    for (let i = 0; i < sockets.length; i++) {
      const ws = sockets[i];
      const att = ws.deserializeAttachment() || {};
      const topics = Array.isArray(att.topics) ? att.topics : [];
      if (topics.indexOf(topic) < 0) continue;
      try { ws.send(message); }
      catch (err) { /* a socket that already closed is dropped on its close event */ }
    }
  }

  replay(ws, topic, since) {
    const cursor = Number(since) || 0;
    if (cursor > 0) {
      const oldest = this.ctx.storage.sql.exec("SELECT MIN(id) AS id FROM events WHERE topic = ?", topic).one();
      const min = Number(oldest && oldest.id) || 0;
      if (!min || min > cursor + 1) {
        try { ws.send(JSON.stringify({ op: "reset", topic })); }
        catch (err) { /* the client falls back to a fetch */ }
        return;
      }
    }
    const rows = this.ctx.storage.sql.exec(
      "SELECT id, body FROM events WHERE topic = ? AND id > ? ORDER BY id ASC",
      topic,
      cursor
    ).toArray();
    for (let i = 0; i < rows.length; i++) {
      let data = {};
      try { data = JSON.parse(rows[i].body); }
      catch (err) { data = {}; }
      try { ws.send(JSON.stringify({ op: "event", topic, cursor: Number(rows[i].id) || 0, data })); }
      catch (err) { break; }
    }
  }

  async webSocketMessage(ws, message) {
    let text = "";
    if (typeof message === "string") text = message;
    else text = new TextDecoder().decode(message);
    if (!text || text.length > 2000) return;
    let body = null;
    try { body = JSON.parse(text); }
    catch (err) { return; }
    if (!body || typeof body !== "object") return;
    const op = String(body.op || "");
    if (op !== "subscribe" && op !== "unsubscribe") return;
    const att = ws.deserializeAttachment() || {};
    let topics = Array.isArray(att.topics) ? att.topics.filter((topic) => validTopic(topic)) : [];
    const incoming = Array.isArray(body.topics) ? body.topics : [];
    const clean = [];
    for (let i = 0; i < incoming.length && clean.length < MAX_TOPICS; i++) {
      const topic = String(incoming[i] || "");
      if (validTopic(topic) && clean.indexOf(topic) < 0) clean.push(topic);
    }
    if (op === "subscribe") {
      clean.forEach((topic) => {
        if (topics.indexOf(topic) < 0 && topics.length < MAX_TOPICS) topics.push(topic);
      });
    } else {
      topics = topics.filter((topic) => clean.indexOf(topic) < 0);
    }
    ws.serializeAttachment({ topics });
    try { ws.send(JSON.stringify({ op: "ready", topics })); }
    catch (err) { return; }
    if (op !== "subscribe") return;
    const since = body.since && typeof body.since === "object" ? body.since : {};
    clean.forEach((topic) => this.replay(ws, topic, since[topic]));
  }

  async webSocketClose() {}

  async webSocketError() {}
}

export async function hubPublish(env, publicId, topic, data) {
  if (!env || !env.ACCOUNT_HUB || !/^\d{12}$/.test(String(publicId || ""))) return null;
  if (!validTopic(topic)) return null;
  try {
    const id = env.ACCOUNT_HUB.idFromName(String(publicId));
    const stub = env.ACCOUNT_HUB.get(id);
    const res = await stub.fetch("https://hub.internal/publish", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-from": "worker" },
      body: JSON.stringify({ topic, data })
    });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

export async function hubUpgrade(env, publicId, request) {
  if (!env || !env.ACCOUNT_HUB || !/^\d{12}$/.test(String(publicId || ""))) {
    return new Response(JSON.stringify({ error: "not_configured" }), {
      status: 503,
      headers: { "content-type": "application/json" }
    });
  }
  const id = env.ACCOUNT_HUB.idFromName(String(publicId));
  const stub = env.ACCOUNT_HUB.get(id);
  return stub.fetch(request);
}
