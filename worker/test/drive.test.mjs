import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";
import { decryptFile, encryptFile, encryptJson, newItemKey, setupVault } from "../../shared/drive-crypto.js";

const OWNER = "S\u0435\u0420g\u0418";
const BOT = "123456:probe-token";
const CHANNEL = "-1004242";

function workerOptions(files, deleted, names) {
  return {
    modules: true,
    scriptPath: new URL("../src/index.js", import.meta.url).pathname,
    modulesRoot: new URL("../..", import.meta.url).pathname,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: {
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000",
      TELEGRAM_BOT_TOKEN: BOT,
      TELEGRAM_CHANNEL_ID: CHANNEL
    },
    async outboundService(request) {
      const url = new URL(request.url);
      const tail = url.pathname.split("/").pop();
      if (tail === "sendDocument") {
        const form = await request.formData();
        const caption = String(form.get("caption") || "");
        const doc = form.get("document");
        names.push(doc && doc.name);
        if (caption !== "vdrive") return Response.json({ ok: false, description: "caption" });
        const buf = new Uint8Array(await doc.arrayBuffer());
        const id = "DRV" + (files.size + 1);
        files.set(id, buf);
        return Response.json({ ok: true, result: { message_id: 700 + files.size, document: { file_id: id } } });
      }
      if (tail === "deleteMessage") {
        const body = await request.json();
        deleted.push(Number(body.message_id));
        return Response.json({ ok: true });
      }
      if (tail === "getFile") {
        const id = url.searchParams.get("file_id") || "";
        if (!files.has(id)) return Response.json({ ok: false });
        return Response.json({ ok: true, result: { file_path: "documents/" + id } });
      }
      if (url.pathname.includes("/file/bot")) {
        const id = url.pathname.split("/").pop();
        const bytes = files.get(id);
        if (!bytes) return new Response("missing", { status: 404 });
        return new Response(bytes);
      }
      return new Response("missing", { status: 404 });
    }
  };
}

async function call(mf, path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.10");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.json) headers.set("content-type", "application/json");
  const res = await mf.dispatchFetch("https://accounts.test" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.raw || (opts.json ? JSON.stringify(opts.json) : undefined)
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  let body = null;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch (err) { body = null; }
  const packed = JSON.stringify(body || {});
  assert.equal(packed.includes(BOT), false);
  assert.equal(packed.includes(CHANNEL), false);
  return { status: res.status, body, bytes, headers: res.headers };
}

async function signup(mf, ip, handle, claim) {
  const body = { displayName: "Reader", handle };
  if (claim) body.claimCode = claim;
  return call(mf, "/v1/signup", { method: "POST", ip, json: body });
}

test("drive routes stay closed unless the session is the owner", async () => {
  const files = new Map();
  const mf = new Miniflare(workerOptions(files, [], []));
  try {
    const anon = await call(mf, "/v1/drive", { ip: "203.0.113.11" });
    assert.equal(anon.status, 404);
    assert.equal(anon.body.error, "not_found");
    const anonWrite = await call(mf, "/v1/drive/items", { method: "POST", ip: "203.0.113.11", json: { kind: "file" } });
    assert.equal(anonWrite.status, 404);

    const other = await signup(mf, "203.0.113.12", "ada_drive");
    assert.equal(other.status, 201);
    assert.equal(other.body.account.owner, false);
    const denied = await call(mf, "/v1/drive", { ip: "203.0.113.13", token: other.body.token });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, "forbidden");
    const deniedWrite = await call(mf, "/v1/drive/vault", {
      method: "PUT",
      ip: "203.0.113.14",
      token: other.body.token,
      json: { kdf: "pbkdf2-sha256", iterations: 1000, salt: "YQ==", verifier: "YQ==", verifierIv: "YQ==" }
    });
    assert.equal(deniedWrite.status, 403);
    const hidden = await call(mf, "/v1/drive/nope", { ip: "203.0.113.15", token: other.body.token });
    assert.equal(hidden.status, 403);
    const deniedAlbum = await call(mf, "/v1/drive/items", { method: "POST", ip: "203.0.113.16", token: other.body.token, json: { kind: "album" } });
    assert.equal(deniedAlbum.status, 403);
    assert.equal(deniedAlbum.body.error, "forbidden");
  } finally {
    await mf.dispose();
  }
});

test("the owner uploads ciphertext, downloads it, and deletion removes the channel message", async () => {
  const files = new Map();
  const deleted = [];
  const names = [];
  const mf = new Miniflare(workerOptions(files, deleted, names));
  try {
    const owner = await signup(mf, "203.0.113.20", OWNER, "claim-test");
    assert.equal(owner.status, 201);
    assert.equal(owner.body.account.owner, true);
    const token = owner.body.token;
    const vault = await setupVault("drive passphrase", 1000);
    const put = await call(mf, "/v1/drive/vault", {
      method: "PUT",
      ip: "203.0.113.21",
      token,
      json: {
        kdf: vault.kdf,
        iterations: vault.iterations,
        salt: vault.salt,
        verifier: vault.verifier,
        verifierIv: vault.verifierIv
      }
    });
    assert.equal(put.status, 201);
    const again = await call(mf, "/v1/drive/vault", {
      method: "PUT",
      ip: "203.0.113.22",
      token,
      json: {
        kdf: vault.kdf,
        iterations: vault.iterations,
        salt: vault.salt,
        verifier: vault.verifier,
        verifierIv: vault.verifierIv
      }
    });
    assert.equal(again.status, 409);

    const made = await newItemKey(vault.key);
    const meta = await encryptJson(made.key, { name: "secret-notes.txt", mime: "text/plain", size: 20, created: 5 });
    const item = await call(mf, "/v1/drive/items", {
      method: "POST",
      ip: "203.0.113.23",
      token,
      json: {
        kind: "file",
        parentId: "",
        wrappedKey: made.wrappedKey,
        wrapIv: made.wrapIv,
        meta: meta.ciphertext,
        metaIv: meta.iv
      }
    });
    assert.equal(item.status, 201);
    const plain = new Uint8Array(20);
    for (let i = 0; i < plain.length; i++) plain[i] = i + 3;
    const chunks = await encryptFile(made.key, plain, 8);
    assert.ok(chunks.length > 1);
    for (let i = 0; i < chunks.length; i++) {
      const up = await call(mf, "/v1/drive/items/" + item.body.id + "/chunks", {
        method: "POST",
        ip: "203.0.113.24",
        token,
        headers: { "x-drive-part": String(chunks[i].index), "x-drive-iv": chunks[i].iv },
        raw: chunks[i].ciphertext
      });
      assert.equal(up.status, 201);
      const retry = await call(mf, "/v1/drive/items/" + item.body.id + "/chunks", {
        method: "POST",
        ip: "203.0.113.25",
        token,
        headers: { "x-drive-part": String(chunks[i].index), "x-drive-iv": chunks[i].iv },
        raw: chunks[i].ciphertext
      });
      assert.equal(retry.status, 200);
      assert.equal(retry.body.stored, true);
    }
    assert.equal(names.length, chunks.length);
    assert.ok(names.every((name) => name === "part.bin"));
    assert.equal(files.size, chunks.length);

    const listed = await call(mf, "/v1/drive/items", { ip: "203.0.113.26", token });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.items.length, 1);
    assert.equal(JSON.stringify(listed.body).includes("secret-notes"), false);
    const got = [];
    for (let i = 0; i < chunks.length; i++) {
      const down = await call(mf, "/v1/drive/items/" + item.body.id + "/chunks/" + i, { ip: "203.0.113.27", token });
      assert.equal(down.status, 200);
      assert.equal(down.headers.get("cache-control"), "private, no-store");
      got.push({ index: i, iv: chunks[i].iv, ciphertext: down.bytes });
    }
    assert.deepEqual(await decryptFile(made.key, got), plain);

    const info = await call(mf, "/v1/drive", { ip: "203.0.113.28", token });
    assert.equal(info.body.stored > 0, true);
    const db = await mf.getBindings();
    const indexed = await db.DB.prepare("SELECT COUNT(*) AS n FROM telegram_files").first();
    assert.equal(Number(indexed.n), 0);
    const pub = await call(mf, "/tg/documents/DRV1", { ip: "203.0.113.29", token });
    assert.equal(pub.status, 404);
    assert.equal(Buffer.from(pub.bytes).equals(Buffer.from(files.get("DRV1"))), false);

    const albumKey = await newItemKey(vault.key);
    const albumMeta = await encryptJson(albumKey.key, { name: "secret-album-name", album: true, mime: "album", size: 0, created: 9 });
    const album = await call(mf, "/v1/drive/items", {
      method: "POST",
      ip: "203.0.113.40",
      token,
      json: {
        kind: "album",
        parentId: "",
        wrappedKey: albumKey.wrappedKey,
        wrapIv: albumKey.wrapIv,
        meta: albumMeta.ciphertext,
        metaIv: albumMeta.iv
      }
    });
    assert.equal(album.status, 201);
    const nested = await call(mf, "/v1/drive/items", {
      method: "POST",
      ip: "203.0.113.41",
      token,
      json: {
        kind: "album",
        parentId: "abcdefghijklmnop",
        wrappedKey: albumKey.wrappedKey,
        wrapIv: albumKey.wrapIv,
        meta: albumMeta.ciphertext,
        metaIv: albumMeta.iv
      }
    });
    assert.equal(nested.status, 400);
    const withAlbum = await call(mf, "/v1/drive/items", { ip: "203.0.113.42", token });
    assert.equal(withAlbum.body.items.length, 2);
    assert.equal(JSON.stringify(withAlbum.body).includes("secret-album-name"), false);
    const removedAlbum = await call(mf, "/v1/drive/items/" + album.body.id + "?forever=1", { method: "DELETE", ip: "203.0.113.43", token });
    assert.equal(removedAlbum.status, 200);
    assert.equal(deleted.length, 0);

    const trashed = await call(mf, "/v1/drive/items/" + item.body.id, { method: "DELETE", ip: "203.0.113.30", token });
    assert.equal(trashed.status, 200);
    assert.equal(trashed.body.trashed, true);
    assert.equal(deleted.length, 0);
    const quiet = await call(mf, "/v1/drive/items", { ip: "203.0.113.31", token });
    assert.equal(quiet.body.items.length, 0);
    const trash = await call(mf, "/v1/drive/items?trash=1", { ip: "203.0.113.32", token });
    assert.equal(trash.body.items.length, 1);
    const gone = await call(mf, "/v1/drive/items/" + item.body.id + "?forever=1", { method: "DELETE", ip: "203.0.113.33", token });
    assert.equal(gone.status, 200);
    assert.equal(gone.body.deleted, true);
    assert.equal(deleted.length, chunks.length);
    const after = await call(mf, "/v1/drive/items?trash=1", { ip: "203.0.113.34", token });
    assert.equal(after.body.items.length, 0);
    const left = await db.DB.prepare("SELECT COUNT(*) AS n FROM drive_chunks").first();
    assert.equal(Number(left.n), 0);
  } finally {
    await mf.dispose();
  }
});
