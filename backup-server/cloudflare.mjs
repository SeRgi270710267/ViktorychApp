/* Cloudflare-backed bindings for the backup server.
   The backup must read and write the SAME D1 database and R2 bucket as the
   primary Worker, otherwise an account created on Cloudflare cannot sign in
   on the backup (and a session minted by one side is unknown to the other).
   The D1/R2 REST APIs use their own quotas, so they keep working when the
   Worker itself is out of free daily requests (HTTP 429 / Error 1027). */

const API_BASE = "https://api.cloudflare.com/client/v4";

export class CloudflareError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = "CloudflareError";
    this.status = status || 0;
    this.details = details || null;
  }
}

function encodeKey(key) {
  return String(key)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function describeErrors(body) {
  const errors = (body && body.errors) || [];
  if (!errors.length) return "";
  return errors.map((item) => [item.code, item.message].filter(Boolean).join(" ")).join("; ");
}

function normalizeParams(params) {
  return (params || []).map((value) => {
    if (value === undefined) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    return value;
  });
}

/* Bytes a request body sends out, for the backup's egress meter. */
function bodyBytes(body) {
  if (!body) return 0;
  if (typeof body === "string") return Buffer.byteLength(body);
  if (body.byteLength != null) return Number(body.byteLength) || 0;
  return 0;
}

export function createCloudflareClient({ token, accountId, fetchImpl, baseUrl, timeoutMs, onSend }) {
  const doFetch = fetchImpl || fetch;
  const root = String(baseUrl || API_BASE).replace(/\/$/, "");
  const authHeaders = { Authorization: "Bearer " + token };
  // A hung Cloudflare call used to hold the user's request open forever.
  const limit = Number(timeoutMs) > 0 ? Number(timeoutMs) : 20000;

  async function call(path, init, attempt) {
    const tries = attempt == null ? 2 : attempt;
    let response;
    try {
      const signal = (init && init.signal) || (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(limit) : undefined);
      if (onSend) onSend(bodyBytes(init && init.body) + path.length + 200);
      response = await doFetch(root + path, {
        ...init,
        signal,
        headers: { ...authHeaders, ...((init && init.headers) || {}) }
      });
    } catch (err) {
      // A timeout is not retried: the user is already waiting on it.
      const timedOut = err && (err.name === "TimeoutError" || err.name === "AbortError");
      if (tries > 0 && !timedOut) return call(path, init, tries - 1);
      throw new CloudflareError("cloudflare_unreachable: " + String(err && err.message || err), 0);
    }
    if ((response.status === 429 || response.status === 500 || response.status === 502 || response.status === 503 || response.status === 504) && tries > 0) {
      const retryAfter = Number(response.headers.get("retry-after") || 0);
      const wait = retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : (3 - tries) * 300;
      await new Promise((resolve) => setTimeout(resolve, wait));
      return call(path, init, tries - 1);
    }
    return response;
  }

  async function json(path, init) {
    const response = await call(path, init);
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; }
    catch (err) { body = null; }
    if (!response.ok || !body || body.success === false) {
      const detail = describeErrors(body) || text.slice(0, 200) || response.statusText;
      throw new CloudflareError("cloudflare_api_error: " + detail, response.status, body);
    }
    return body;
  }

  return { json, call, accountId };
}

export async function resolveD1DatabaseId(client, wantedName) {
  const name = String(wantedName || "").trim();
  const query = name ? "?name=" + encodeURIComponent(name) + "&per_page=100" : "?per_page=100";
  const body = await client.json("/accounts/" + encodeURIComponent(client.accountId) + "/d1/database" + query);
  const list = (body && body.result) || [];
  if (!list.length) throw new CloudflareError("d1_database_not_found: " + (name || "(any)"), 404, body);
  if (name) {
    const exact = list.find((row) => row && row.name === name);
    if (exact && exact.uuid) return exact.uuid;
    throw new CloudflareError("d1_database_not_found: " + name, 404, body);
  }
  const first = list.find((row) => row && row.uuid);
  if (first) return first.uuid;
  throw new CloudflareError("d1_database_not_found: " + (name || "(any)"), 404, body);
}

class RemoteStatement {
  constructor(database, sql, params) {
    this.database = database;
    this.sql = sql;
    this.params = params || [];
  }
  bind(...params) {
    return new RemoteStatement(this.database, this.sql, params);
  }
  async first(column) {
    const result = await this.database.query(this.sql, this.params);
    const row = (result && result.results && result.results[0]) || null;
    if (!row) return null;
    if (column != null) return row[column] == null ? null : row[column];
    return row;
  }
  all() {
    return this.database.query(this.sql, this.params);
  }
  run() {
    return this.database.query(this.sql, this.params);
  }
}

class RemoteD1 {
  constructor(client, databaseId) {
    this.client = client;
    this.databaseId = databaseId;
  }
  prepare(sql) {
    return new RemoteStatement(this, sql, []);
  }
  query(sql, params) {
    return this.client
      .json("/accounts/" + encodeURIComponent(this.client.accountId) + "/d1/database/" + encodeURIComponent(this.databaseId) + "/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql, params: normalizeParams(params) })
      })
      .then((body) => {
        const first = ((body && body.result) || [])[0] || {};
        return {
          results: first.results || [],
          success: first.success !== false,
          meta: first.meta || {}
        };
      });
  }
  batch(statements) {
    const list = Array.isArray(statements) ? statements : [];
    if (!list.length) return Promise.resolve([]);
    return this.client
      .json("/accounts/" + encodeURIComponent(this.client.accountId) + "/d1/database/" + encodeURIComponent(this.databaseId) + "/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          batch: list.map((statement) => ({
            sql: statement.sql,
            params: normalizeParams(statement.params)
          }))
        })
      })
      .then((body) => {
        const rows = (body && body.result) || [];
        return rows.map((row) => ({
          results: (row && row.results) || [],
          success: !row || row.success !== false,
          meta: (row && row.meta) || {}
        }));
      });
  }
}

export function createD1(client, databaseId) {
  return new RemoteD1(client, databaseId);
}

class RemoteR2Object {
  /* bytes is either a Uint8Array or a fetch Response whose body is read
     lazily, so a large file streams through instead of sitting in memory. */
  constructor(bytes, meta) {
    this._bytes = bytes instanceof Uint8Array ? bytes : null;
    this._response = bytes && !(bytes instanceof Uint8Array) && typeof bytes.arrayBuffer === "function" ? bytes : null;
    this.size = meta.size;
    this.etag = meta.etag;
    this.httpEtag = meta.httpEtag;
    this.httpMetadata = meta.httpMetadata;
    this.customMetadata = meta.customMetadata || {};
    this.uploaded = meta.uploaded;
  }
  get body() {
    if (this._response) return this._response.body || new Response(new Uint8Array(0)).body;
    const bytes = this._bytes || new Uint8Array(0);
    return new Response(bytes).body;
  }
  async _all() {
    if (this._response) {
      this._bytes = new Uint8Array(await this._response.arrayBuffer());
      this._response = null;
    }
    return this._bytes || new Uint8Array(0);
  }
  async arrayBuffer() {
    const bytes = await this._all();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  async text() {
    return new TextDecoder().decode(await this._all());
  }
  json() {
    return this.text().then((text) => JSON.parse(text));
  }
}

function metaFromListing(row) {
  const etag = row && row.etag ? String(row.etag).replace(/^"|"$/g, "") : "";
  return {
    size: Number((row && row.size) || 0),
    etag,
    httpEtag: etag ? '"' + etag + '"' : "",
    httpMetadata: {
      contentType: (row && row.http_metadata && row.http_metadata.contentType) || "application/octet-stream"
    },
    customMetadata: (row && row.custom_metadata) || {},
    uploaded: row && row.last_modified ? new Date(row.last_modified) : undefined
  };
}

class RemoteR2 {
  constructor(client, bucket) {
    this.client = client;
    this.bucket = bucket;
    this.base = "/accounts/" + encodeURIComponent(client.accountId) + "/r2/buckets/" + encodeURIComponent(bucket) + "/objects";
  }
  async head(key) {
    // List Objects returns the metadata we need without downloading the body.
    let cursor = "";
    for (let page = 0; page < 5; page++) {
      const query = "?prefix=" + encodeURIComponent(key) + "&per_page=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
      const body = await this.client.json(this.base + query);
      const rows = (body && body.result) || [];
      const found = rows.find((row) => row && row.key === key);
      if (found) return metaFromListing(found);
      const info = (body && body.result_info) || {};
      if (!info.is_truncated || !info.cursor) break;
      cursor = info.cursor;
    }
    return null;
  }
  async get(key, options) {
    const range = options && options.range;
    const headers = {};
    if (range) {
      const start = Number(range.offset) || 0;
      const length = Number(range.length) || 0;
      headers.Range = "bytes=" + start + "-" + Math.max(start, start + length - 1);
    }
    // Media can be large and slow: a longer limit than API calls.
    const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(120000) : undefined;
    const response = await this.client.call(this.base + "/" + encodeKey(key), { headers, signal });
    if (response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new CloudflareError("r2_get_failed: " + (text.slice(0, 160) || response.statusText), response.status);
    }
    const etag = String(response.headers.get("etag") || "").replace(/^"|"$/g, "");
    const declared = Number(response.headers.get("content-length"));
    let bytes;
    if (range && response.status === 200) {
      // The range was ignored: cut it out of the whole object.
      const buffer = new Uint8Array(await response.arrayBuffer());
      const start = Number(range.offset) || 0;
      const length = Number(range.length) || 0;
      bytes = buffer.slice(start, start + length);
    } else if (Number.isFinite(declared) && declared >= 0 && response.headers.get("content-length") !== null) {
      bytes = response;
    } else {
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    return new RemoteR2Object(bytes, {
      size: bytes instanceof Uint8Array ? bytes.byteLength : declared,
      etag,
      httpEtag: etag ? '"' + etag + '"' : "",
      httpMetadata: { contentType: response.headers.get("content-type") || "application/octet-stream" }
    });
  }
  async put(key, value, options) {
    const headers = {};
    const meta = (options && options.httpMetadata) || {};
    if (meta.contentType) headers["content-type"] = meta.contentType;
    let body = value;
    if (typeof value === "string") body = new TextEncoder().encode(value);
    const response = await this.client.call(this.base + "/" + encodeKey(key), { method: "PUT", headers, body });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new CloudflareError("r2_put_failed: " + (text.slice(0, 160) || response.statusText), response.status);
    }
    const etag = String(response.headers.get("etag") || "").replace(/^"|"$/g, "");
    const size = body && body.byteLength != null ? body.byteLength : 0;
    return new RemoteR2Object(body instanceof Uint8Array ? body : new Uint8Array(0), {
      size,
      etag,
      httpEtag: etag ? '"' + etag + '"' : "",
      httpMetadata: { contentType: (meta.contentType || "application/octet-stream") }
    });
  }
  async delete(key) {
    const response = await this.client.call(this.base + "/" + encodeKey(key), { method: "DELETE" });
    if (response.ok || response.status === 404) return;
    const text = await response.text().catch(() => "");
    throw new CloudflareError("r2_delete_failed: " + (text.slice(0, 160) || response.statusText), response.status);
  }
}

export function createR2(client, bucket) {
  return new RemoteR2(client, bucket);
}

/* The Worker uses caches.default for GitHub API responses, presence,
   previews and Telegram bodies. Cloudflare's edge cache expires entries and
   evicts under pressure; the old Map here kept every response, media files
   included, forever. On a 512 MB free instance that ended in an out of
   memory restart, and stale entries never refreshed. This one keeps bytes
   only, honours max-age, skips private/no-store and large bodies, and
   evicts least recently used entries past a byte budget. */
function cacheTtlMs(headers, now) {
  const cc = String(headers.get("cache-control") || "").toLowerCase();
  if (/\b(no-store|private)\b/.test(cc)) return 0;
  const m = cc.match(/s-maxage=(\d+)/) || cc.match(/max-age=(\d+)/);
  let secs = m ? Number(m[1]) : 300;
  const expires = headers.get("expires");
  if (!m && expires) {
    const when = Date.parse(expires);
    if (Number.isFinite(when)) secs = Math.max(0, Math.round((when - now) / 1000));
  }
  return Math.min(Math.max(secs, 0), 86400) * 1000;
}

export function createMemoryCache(options) {
  const opts = options || {};
  const maxBytes = Number(opts.maxBytes) > 0 ? Number(opts.maxBytes) : 32 * 1024 * 1024;
  const maxEntry = Number(opts.maxEntryBytes) > 0 ? Number(opts.maxEntryBytes) : 2 * 1024 * 1024;
  const clock = typeof opts.now === "function" ? opts.now : () => Date.now();
  const store = new Map();
  const stats = { bytes: 0, entries: 0, hits: 0, misses: 0, skipped: 0, evicted: 0 };
  const keyOf = (request) => (typeof request === "string" ? request : request.url);
  function drop(key) {
    const row = store.get(key);
    if (!row) return false;
    stats.bytes -= row.bytes.byteLength;
    store.delete(key);
    stats.entries = store.size;
    return true;
  }
  const cache = {
    async match(request) {
      const key = keyOf(request);
      const row = store.get(key);
      if (!row) { stats.misses += 1; return undefined; }
      if (row.until <= clock()) { drop(key); stats.misses += 1; return undefined; }
      // Most recently used goes to the end.
      store.delete(key);
      store.set(key, row);
      stats.hits += 1;
      return new Response(row.bytes.slice(0), { status: row.status, headers: row.headers });
    },
    async put(request, response) {
      const key = keyOf(request);
      if (!response || response.status === 206 || (request && request.method && request.method !== "GET")) return;
      const ttl = cacheTtlMs(response.headers, clock());
      const declared = Number(response.headers.get("content-length"));
      if (!ttl || (Number.isFinite(declared) && declared > maxEntry)) {
        stats.skipped += 1;
        if (response.body && !response.bodyUsed) await response.body.cancel().catch(() => {});
        return;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxEntry) { stats.skipped += 1; return; }
      drop(key);
      const headers = [];
      response.headers.forEach((value, name) => headers.push([name, value]));
      store.set(key, { bytes, status: response.status || 200, headers, until: clock() + ttl });
      stats.bytes += bytes.byteLength;
      while (stats.bytes > maxBytes && store.size) {
        const oldest = store.keys().next().value;
        drop(oldest);
        stats.evicted += 1;
      }
      stats.entries = store.size;
    },
    async delete(request) {
      return drop(keyOf(request));
    }
  };
  return {
    default: cache,
    async open() { return cache; },
    stats
  };
}
