import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";

const OWNER = "S\u0435\u0420g\u0418";
const dispatches = [];

let mf;

function workerOptions() {
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
      GITHUB_DISPATCH_TOKEN: "dispatch-test"
    },
    async outboundService(request) {
      const url = new URL(request.url);
      if (url.hostname === "www.tiktok.com" || url.hostname === "tiktok.com") {
        if (url.pathname.indexOf("@blocked_name") >= 0) {
          return new Response("<html>captcha-verify</html>", { status: 200, headers: { "content-type": "text/html" } });
        }
        const html = '<html><meta property="og:title" content="Sample (@sample_name)"><meta property="og:image" content="https://cdn.example/a.jpg">' +
          '<script>"uniqueId":"sample_name","nickname":"Sample","avatarLarger":"https:\\/\\/cdn.example\\/a.jpg"</script></html>';
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (/(^|\.)tiktokcdn\.com$/i.test(url.hostname)) {
        if (url.pathname.endsWith(".m3u8")) {
          return new Response("#EXTM3U\n#EXTINF:2,\nhttps://v16.tiktokcdn.com/seg.ts\n", {
            status: 200,
            headers: { "content-type": "application/vnd.apple.mpegurl" }
          });
        }
        const bytes = new Uint8Array(8100000);
        bytes[0] = 7;
        bytes[bytes.length - 1] = 9;
        return new Response(bytes, { status: 200, headers: { "content-type": "video/mp2t" } });
      }
      if (url.hostname === "api.github.com") {
        dispatches.push(url.pathname);
        const auth = request.headers.get("authorization") || "";
        if (!auth.startsWith("Bearer ")) return new Response("no", { status: 401 });
        return new Response(null, { status: 204 });
      }
      return new Response("no", { status: 404 });
    }
  };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.10");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.body) headers.set("content-type", "application/json");
  const res = await mf.dispatchFetch("https://accounts.test" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch (err) { body = { raw: text }; }
  return { status: res.status, body, text, headers: res.headers };
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("owner adds and removes a TikTok account in private storage", async () => {
  const stranger = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.70",
    body: { displayName: "Ada", handle: "ada_tt" }
  });
  assert.equal(stranger.status, 201);
  const denied = await call("/v1/owner/tiktok/accounts", { ip: "203.0.113.71", token: stranger.body.token });
  assert.equal(denied.status, 403);
  const deniedWrite = await call("/v1/owner/tiktok/accounts", {
    method: "POST",
    ip: "203.0.113.72",
    token: stranger.body.token,
    body: { handle: "sample_name" }
  });
  assert.equal(deniedWrite.status, 403);
  const open = await call("/v1/owner/tiktok/accounts", { ip: "203.0.113.73" });
  assert.equal(open.status, 401);

  const owner = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.74",
    body: { displayName: "Owner", handle: OWNER, claimCode: "claim-test" }
  });
  assert.equal(owner.status, 201);
  assert.equal(owner.body.account.owner, true);

  const bad = await call("/v1/owner/tiktok/accounts", {
    method: "POST",
    ip: "203.0.113.75",
    token: owner.body.token,
    body: { handle: "not a handle" }
  });
  assert.equal(bad.status, 400);

  dispatches.length = 0;
  const added = await call("/v1/owner/tiktok/accounts", {
    method: "POST",
    ip: "203.0.113.76",
    token: owner.body.token,
    body: { handle: "https://www.tiktok.com/@sample_name?lang=en" }
  });
  assert.equal(added.status, 200);
  assert.equal(added.body.account.handle, "sample_name");
  assert.equal(added.body.account.name, "Sample");
  assert.equal(added.body.preview, true);
  assert.equal(added.body.dispatched, true);
  assert.equal(added.body.removed, undefined);
  assert.ok(dispatches.some((path) => path.indexOf("tiktok-added.yml") >= 0));
  assert.ok(dispatches.some((path) => path.indexOf("media-extract.yml") >= 0));
  assert.ok(dispatches.some((path) => path.indexOf("tiktok-live.yml") >= 0));

  const listed = await call("/v1/owner/tiktok/accounts", { ip: "203.0.113.77", token: owner.body.token });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.added.length, 1);
  assert.equal(listed.body.removed, undefined);

  const leaked = await call("/v1/data/owner/tiktok-accounts.json", { ip: "203.0.113.78", token: owner.body.token });
  assert.equal(leaked.status, 404);

  const bindings = await mf.getBindings();
  const stored = await bindings.DATA.get("owner/tiktok-accounts.json");
  const doc = JSON.parse(await stored.text());
  assert.equal(doc.added[0].handle, "sample_name");
  assert.ok(Array.isArray(doc.removed));

  const blocked = await call("/v1/owner/tiktok/accounts", {
    method: "POST",
    ip: "203.0.113.79",
    token: owner.body.token,
    body: { handle: "@blocked_name" }
  });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.body.account.handle, "blocked_name");
  assert.equal(blocked.body.preview, false);

  const removed = await call("/v1/owner/tiktok/accounts/sample_name", {
    method: "DELETE",
    ip: "203.0.113.80",
    token: owner.body.token
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.added.some((row) => row.handle === "sample_name"), false);

  const again = await bindings.DATA.get("owner/tiktok-accounts.json");
  const after = JSON.parse(await again.text());
  assert.ok(after.removed.indexOf("sample_name") >= 0);
  assert.equal(after.added.some((row) => row.handle === "sample_name"), false);

  const back = await call("/v1/owner/tiktok/accounts", {
    method: "POST",
    ip: "203.0.113.81",
    token: owner.body.token,
    body: { url: "https://tiktok.com/@sample_name" }
  });
  assert.equal(back.status, 200);
  const restored = JSON.parse(await (await bindings.DATA.get("owner/tiktok-accounts.json")).text());
  assert.equal(restored.removed.indexOf("sample_name"), -1);
  assert.equal(restored.added.some((row) => row.handle === "sample_name"), true);

  const share = await call("/v1/owner/tiktok/accounts", {
    method: "POST",
    ip: "203.0.113.82",
    token: owner.body.token,
    body: { handle: "https://www.tiktok.com/@noranaslundddd?_r=1&_t=ZN-9AmQevSXE18" }
  });
  assert.equal(share.status, 200);
  assert.equal(share.body.account.handle, "noranaslundddd");
  assert.equal(share.body.account.name, "");
  assert.equal(share.body.preview, false);

  await bindings.DATA.put("owner/tiktok-accounts.json", JSON.stringify({
    added: [{ handle: "https://www.tiktok.com/@noranaslundddd?_r=1&_t=ZN-9AmQevSXE18", name: "N", avatar: "", addedAt: "2026-10-22T00:00:00Z" }],
    removed: ["https://www.tiktok.com/@gabii_g5"]
  }));
  const repaired = await call("/v1/owner/tiktok/accounts", { ip: "203.0.113.83", token: owner.body.token });
  assert.equal(repaired.status, 200);
  assert.equal(repaired.body.added.length, 1);
  assert.equal(repaired.body.added[0].handle, "noranaslundddd");
  assert.equal(repaired.body.added[0].name, "N");
  const repairedDoc = JSON.parse(await (await bindings.DATA.get("owner/tiktok-accounts.json")).text());
  assert.equal(repairedDoc.added[0].handle, "noranaslundddd");
  assert.equal(repairedDoc.removed[0], "gabii_g5");

  const mediaDenied = await call("/v1/owner/media?url=" + encodeURIComponent("https://v16.tiktokcdn.com/live.m3u8"), {
    ip: "203.0.113.84",
    token: stranger.body.token
  });
  assert.equal(mediaDenied.status, 403);
  const playlist = await call("/v1/owner/media?url=" + encodeURIComponent("https://v16.tiktokcdn.com/live.m3u8"), {
    ip: "203.0.113.85",
    token: owner.body.token
  });
  assert.equal(playlist.status, 200);
  assert.match(playlist.text, /#EXTM3U/);
  assert.match(playlist.text, /\/v1\/owner\/media\?url=/);
  assert.match(playlist.headers.get("cache-control"), /private/);
  assert.match(playlist.headers.get("cache-control"), /no-store/);
  const streamed = await call("/v1/owner/media?url=" + encodeURIComponent("https://v16.tiktokcdn.com/seg.ts"), {
    ip: "203.0.113.86",
    token: owner.body.token
  });
  assert.equal(streamed.status, 200);
  assert.equal(streamed.text.length, 8100000);
  assert.equal(streamed.text.charCodeAt(0), 7);
  assert.equal(streamed.text.charCodeAt(streamed.text.length - 1), 9);
  assert.match(streamed.headers.get("cache-control"), /private, no-store/);
  const names = (await bindings.DATA.list()).objects.map((object) => object.key);
  assert.equal(names.some((key) => key.indexOf("seg") >= 0 || key.indexOf("m3u8") >= 0), false);
});
