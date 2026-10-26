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

export function createCloudflareClient({ token, accountId, fetchImpl, baseUrl }) {
  const doFetch = fetchImpl || fetch;
  const root = String(baseUrl || API_BASE).replace(/\/$/, "");
  const authHeaders = { Authorization: "Bearer " + token };

  async function call(path, init, attempt) {
    const tries = attempt == null ? 2 : attempt;
    let response;
    try {
      response = await doFetch(root + path, {
        ...init,
        headers: { ...authHeaders, ...((init && init.headers) || {}) }
      });
    } catch (err) {
      if (tries > 0) return call(path, init, tries - 1);
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
  constructor(bytes, meta) {
    this._bytes = bytes;
    this.size = meta.size;
    this.etag = meta.etag;
    this.httpEtag = meta.httpEtag;
    this.httpMetadata = meta.httpMetadata;
    this.customMetadata = meta.customMetadata || {};
    this.uploaded = meta.uploaded;
  }
  get body() {
    const bytes = this._bytes || new Uint8Array(0);
    return new Response(bytes).body;
  }
  arrayBuffer() {
    const bytes = this._bytes || new Uint8Array(0);
    return Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  text() {
    return Promise.resolve(new TextDecoder().decode(this._bytes || new Uint8Array(0)));
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
    const response = await this.client.call(this.base + "/" + encodeKey(key), { headers });
    if (response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new CloudflareError("r2_get_failed: " + (text.slice(0, 160) || response.statusText), response.status);
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    let bytes = buffer;
    if (range && response.status === 200) {
      const start = Number(range.offset) || 0;
      const length = Number(range.length) || 0;
      bytes = buffer.slice(start, start + length);
    }
    const etag = String(response.headers.get("etag") || "").replace(/^"|"$/g, "");
    return new RemoteR2Object(bytes, {
      size: bytes.byteLength,
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

/* The Worker uses caches.default for GitHub API responses and Telegram
   bodies. A process-local cache is enough for the backup. */
export function createMemoryCache() {
  const store = new Map();
  return {
    default: {
      async match(request) {
        const key = typeof request === "string" ? request : request.url;
        const hit = store.get(key);
        return hit ? hit.clone() : undefined;
      },
      async put(request, response) {
        const key = typeof request === "string" ? request : request.url;
        store.set(key, response.clone());
      },
      async delete(request) {
        const key = typeof request === "string" ? request : request.url;
        return store.delete(key);
      }
    }
  };
}
