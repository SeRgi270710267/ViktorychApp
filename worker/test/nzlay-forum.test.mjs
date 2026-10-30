import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { parseIndex, parseCategory, parseTopic, parseMembers, parseForm, loginFields, cleanCookie, mergeCookies, viewerOf, bodyHtml, bodyParts, parseWhen, hasCaptcha } from "../src/nzlay-forum.js";

/* Every name, address and value here is synthetic. */
const fx = (name) => readFileSync(new URL("./fixtures/nzlay-forum-" + name + ".html", import.meta.url), "utf8");
const TOP_HTML = readFileSync(new URL("./fixtures/regone-top100.html", import.meta.url), "utf8");
const PASSWORD = "synthetic-pass-Z9";
const SESSION = "PHPSESSID=synthsess123";
let seen = [];
let mode = "ok";

function options() {
  return {
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/index.js", import.meta.url)),
    modulesRoot: fileURLToPath(new URL("../..", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: { ACCOUNT_PEPPER: "pepper-test", OWNER_CLAIM_CODE: "claim-test", OWNER_HANDLE: "owner_synth", ALLOWED_ORIGINS: "http://127.0.0.1:8080", PBKDF2_ITERATIONS: "1000" },
    async outboundService(request) {
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.text() : "";
      seen.push({ method: request.method, path: url.pathname + url.search, cookie: request.headers.get("cookie") || "", body, ua: request.headers.get("user-agent") || "" });
      const html = (text, extra) => new Response(text, Object.assign({ headers: { "content-type": "text/html" } }, extra || {}));
      assert.equal(url.hostname, "nzlay.com", "only NZlay is called");
      const p = url.pathname;
      if (p === "/pages/top100") return html(TOP_HTML);
      if (p === "/forums" && url.searchParams.get("format") === "html") return html(fx("index"));
      if (p === "/forums") return request.headers.get("cookie") === "PHPSESSID=fresh456" || request.headers.get("cookie") === SESSION ? html(fx("signedin")) : html(fx("login"));
      if (p === "/members") return html(fx("members"));
      if (p === "/forums/1/general") return html(fx("cat1"));
      if (p === "/forums/7/clans") return html(fx("cat7"));
      if (p.startsWith("/forums/topic/9/") && !p.endsWith("/post-reply")) return html(fx("topic9"));
      if (p.startsWith("/forums/topic/12/")) return html(fx("topic12"));
      if (p === "/login" && request.method === "GET") return html(fx("login"), { headers: { "content-type": "text/html", "set-cookie": "PHPSESSID=guest111; path=/; secure" } });
      if (p === "/login" && request.method === "POST") {
        const form = new URLSearchParams(body);
        if (form.get("password") !== PASSWORD) return html('<form id="user_form_login"><ul class="form-errors"><li>Invalid credentials supplied</li></ul></form>');
        return new Response(null, { status: 302, headers: { location: "/", "set-cookie": "PHPSESSID=fresh456; path=/; secure" } });
      }
      if (p === "/forums/topic/9/synthetic-welcome/post-reply" && request.method === "GET") {
        if (mode === "captcha") return html(fx("reply").replace("</form>", '<div class="g-recaptcha" data-sitekey="synthetic"></div></form>'));
        if (!request.headers.get("cookie")) return new Response(null, { status: 302, headers: { location: "/login" } });
        return html(fx("reply"));
      }
      if (p === "/forums/topic/9/synthetic-welcome/post-reply" && request.method === "POST") {
        return new Response(null, { status: 302, headers: { location: "/forums/topic/9/synthetic-welcome/view/post_id/77" } });
      }
      if (p === "/logout") return new Response(null, { status: 302, headers: { location: "/" } });
      assert.fail("unexpected outbound request " + request.method + " " + p);
      return new Response("", { status: 404 });
    }
  };
}

let mf;
async function call(path, opts, inst) {
  opts = opts || {};
  const headers = new Headers({ "CF-Connecting-IP": opts.ip || "203.0.113.40" });
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.body) headers.set("content-type", "application/json");
  const res = await (inst || mf).dispatchFetch("https://accounts.test" + path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (err) { body = { raw: text }; }
  return { status: res.status, body, text, headers: res.headers };
}

test.before(async () => { mf = new Miniflare(options()); });
test.after(async () => { if (mf) await mf.dispose(); });

test("parsers read NZlay's page shapes", () => {
  const cats = parseIndex(fx("index"));
  assert.deepEqual(cats.map((c) => [c.id, c.slug, c.title, c.topics]), [[1, "general", "General", 1], [7, "clans", "Clans & Teams", 1]]);
  assert.equal(cats[0].about, "Talk about anything");
  assert.equal(cats[0].lastAt, "2026-10-28T18:51:19.000Z");
  const list = parseCategory(fx("cat1"), 1);
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].id, list[0].title, list[0].views, list[0].replies, list[0].sticky, list[0].lastBy.name], [9, "Synthetic welcome & rules", 1204, 2, true, "QuietOtter"]);
  assert.equal(list[0].lastBy.avatar, "https://nzlay.com/public/user/bb/otter.webp");
  const t = parseTopic(fx("topic9"));
  assert.equal(t.title, "Synthetic welcome & rules");
  assert.deepEqual(t.category, { id: 1, title: "General" });
  assert.equal(t.pages, 2);
  assert.equal(t.posts.length, 3);
  const [a, b, c] = t.posts;
  assert.equal(a.moderator, true);
  assert.equal(a.author.role, "Moderator");
  assert.equal(a.author.posts, 12);
  assert.equal(a.at, "2026-10-18T12:03:00.000Z");
  assert.equal(a.edited, true);
  assert.match(a.text, /^Welcome to the synthetic forum\.\n/);
  assert.match(a.text, /Be kind & have fun\.\nSee the rules\./);
  assert.deepEqual(a.media, [{ type: "image", url: "https://i.imgur.example/full-size.png", alt: "Map" }], "full-size media, emoticons skipped");
  assert.ok(a.links.includes("https://example.com/rules"));
  assert.deepEqual(b.quote, { name: "SynthMod", text: "Be kind & have fun." });
  assert.equal(b.text, "Thanks! See you in NZlay Mini 01 - USA.");
  assert.equal(b.author.name, "Synth Alpha");
  assert.deepEqual(c.quote, { name: "Synth Alpha", text: "Thanks!" }, "a nested quote keeps only the outer reply");
  assert.equal(c.text, "Same here.");
  assert.equal(parseMembers(fx("members")), 1234);
  assert.equal(parseWhen("Sun, 18 Oct 2026 5:03:11 -0700"), "2026-10-18T12:03:11.000Z");
  assert.equal(parseWhen("nonsense"), "");
});

test("forms, cookies and bodies for the relay", () => {
  const form = parseForm(fx("login"), /user_form_login/);
  assert.equal(form.captcha, false);
  const fields = loginFields(form, "someone@example.test", PASSWORD);
  assert.equal(fields.get("RandFieldQz"), "someone@example.test", "the random email field");
  assert.equal(fields.get("email"), "", "the honeypot stays empty");
  assert.equal(fields.get("email_field"), "UmFuZEZpZWxkUXo=");
  assert.equal(fields.get("password"), PASSWORD);
  assert.equal(cleanCookie("PHPSESSID=abc; en4_locale=en"), "PHPSESSID=abc; en4_locale=en");
  assert.equal(cleanCookie("PHPSESSID=abc\r\nX-Evil: 1"), "");
  assert.equal(cleanCookie("x".repeat(3000)), "");
  const res = new Response("", { headers: [["set-cookie", "PHPSESSID=new1; path=/"], ["set-cookie", "en4_locale=en; path=/"]] });
  assert.equal(mergeCookies("PHPSESSID=old; keep=1", res), "PHPSESSID=new1; keep=1; en4_locale=en");
  assert.equal(viewerOf(fx("login")), null);
  assert.equal(viewerOf(fx("signedin")).name, "SynthViewer");
  assert.equal(bodyHtml("a < b\nnext\n\nsecond", true), "<p>a &lt; b<br>next</p><p>second</p>");
  assert.equal(bodyHtml("  plain  ", false), "plain");
  assert.equal(hasCaptcha('<div class="g-recaptcha"></div>'), true);
  assert.equal(bodyParts('<p><img src="javascript:alert(1)"></p>').media.length, 0, "only https media");
});

test("the forum feed and a thread come from cached public reads", async () => {
  seen = [];
  const feed = await call("/v1/nzlay/forum");
  assert.equal(feed.status, 200, feed.text);
  assert.equal(feed.headers.get("cache-control"), "public, max-age=60");
  assert.equal(feed.body.forum.members, 1234);
  assert.equal(feed.body.categories.length, 2);
  assert.deepEqual(feed.body.topics.map((t) => t.id), [9, 12], "latest first");
  const t = feed.body.topics[0];
  assert.equal(t.starter.author.name, "SynthMod");
  assert.equal(t.starter.media[0].url, "https://i.imgur.example/full-size.png");
  assert.equal(t.url, "https://nzlay.com/forums/topic/9/synthetic-welcome");
  assert.ok(seen.every((r) => /ViktorychApp/.test(r.ua) && r.method === "GET" && !r.cookie), "polite, anonymous reads");
  assert.ok(seen.length <= 50, "within the free subrequest budget");
  const before = seen.length;
  await call("/v1/nzlay/forum");
  assert.equal(seen.length, before, "the second read is cached");
  const thread = await call("/v1/nzlay/forum/topic/9");
  assert.equal(thread.status, 200, thread.text);
  assert.equal(thread.body.posts.length, 3);
  assert.equal(thread.body.pages, 2);
  assert.equal(thread.body.posts[1].quote.name, "SynthMod");
  const cat = await call("/v1/nzlay/forum?category=7");
  assert.equal(cat.status, 200, cat.text);
  assert.equal(cat.body.topics[0].title, "Come to NZlay Mini 01 - USA tonight");
  assert.equal((await call("/v1/nzlay/forum?category=99")).status, 404);
  assert.equal((await call("/v1/nzlay/forum/topic/abc")).status, 404);
});

test("sign-in and replies go through a relay that keeps nothing", async () => {
  seen = [];
  const bad = await call("/v1/nzlay/relay/login", { method: "POST", ip: "203.0.113.41", body: { email: "someone@example.test", password: "wrong" } });
  assert.equal(bad.body.result, "rejected");
  assert.deepEqual(bad.body.errors, ["Invalid credentials supplied"]);
  const ok = await call("/v1/nzlay/relay/login", { method: "POST", ip: "203.0.113.41", body: { email: "someone@example.test", password: PASSWORD } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.result, "signed_in");
  assert.equal(ok.body.session, "PHPSESSID=fresh456");
  assert.equal(ok.body.viewer.name, "SynthViewer");
  assert.equal(ok.headers.get("cache-control"), "private, no-store");
  assert.equal(ok.text.indexOf(PASSWORD), -1, "the password never comes back");
  const post = seen.find((r) => r.method === "POST" && r.path === "/login" && r.body.indexOf("wrong") < 0);
  assert.equal(post.cookie, "PHPSESSID=guest111", "the sign-in form's own session");
  const db = await mf.getD1Database("DB");
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results.map((r) => r.name).filter((n) => !/^(_cf_|sqlite_)/.test(n));
  for (const name of tables) {
    const rows = (await db.prepare("SELECT * FROM \"" + name + "\"").all()).results;
    const dump = JSON.stringify(rows);
    assert.equal(dump.indexOf(PASSWORD), -1, name + " holds no password");
    assert.equal(dump.indexOf("fresh456"), -1, name + " holds no session");
    assert.equal(dump.indexOf("someone@example.test"), -1, name + " holds no email");
  }

  seen = [];
  const reply = await call("/v1/nzlay/relay/reply", { method: "POST", ip: "203.0.113.41", body: { session: SESSION, topicId: 9, slug: "synthetic-welcome", text: "Hello <there>\nfriend" } });
  assert.equal(reply.body.result, "posted", reply.text);
  assert.equal(reply.body.postId, 77);
  const sent = seen.find((r) => r.method === "POST");
  const form = new URLSearchParams(sent.body);
  assert.equal(form.get("token"), "tok-synthetic", "hidden fields go back");
  assert.equal(form.get("watch"), "1");
  assert.match(form.get("body"), /^<blockquote>[\s\S]*QuietOtter[\s\S]*<\/blockquote>\n<p>Hello &lt;there&gt;<br>friend<\/p>$/, "NZlay's quote first, then the escaped reply");
  assert.equal(sent.cookie, SESSION);

  const none = await call("/v1/nzlay/relay/reply", { method: "POST", body: { topicId: 9, slug: "synthetic-welcome", text: "hi" } });
  assert.equal(none.body.result, "needs_login");
  const forged = await call("/v1/nzlay/relay/reply", { method: "POST", body: { session: "PHPSESSID=a\r\nHost: evil", topicId: 9, text: "hi" } });
  assert.equal(forged.body.result, "needs_login", "a malformed cookie never reaches NZlay");

  mode = "captcha";
  seen = [];
  const cap = await call("/v1/nzlay/relay/reply", { method: "POST", ip: "203.0.113.42", body: { session: SESSION, topicId: 9, slug: "synthetic-welcome", text: "hi" } });
  mode = "ok";
  assert.equal(cap.body.result, "captcha", "a captcha goes back to the person");
  assert.match(cap.body.url, /^https:\/\/nzlay\.com\/forums\/topic\/9\//);
  assert.equal(seen.filter((r) => r.method === "POST").length, 0, "nothing is sent past a captcha");

  const me = await call("/v1/nzlay/relay/me", { method: "POST", body: { session: SESSION } });
  assert.equal(me.body.viewer.name, "SynthViewer");
  assert.equal((await call("/v1/nzlay/relay/logout", { method: "POST", body: { session: SESSION } })).body.ok, true);
  assert.equal((await call("/v1/nzlay/relay/reply")).status, 405);
});

test("the relay is paced per address", async () => {
  let last;
  for (let i = 0; i < 13; i++) last = await call("/v1/nzlay/relay/reply", { method: "POST", ip: "203.0.113.77", body: { session: SESSION, topicId: 9, slug: "synthetic-welcome", text: "n" + i } });
  assert.equal(last.status, 429);
});

test("forum badges show ranks and only consented links", async () => {
  const made = await call("/v1/signup", { method: "POST", ip: "198.51.100.90", body: { displayName: "Test badge", handle: "badge_synth" } });
  assert.equal(made.status, 201, made.text);
  const token = made.body.token;
  await call("/v1/games/link-name", { method: "POST", ip: "198.51.100.90", token, body: { name: "QuietOtter" } });
  const other = await call("/v1/signup", { method: "POST", ip: "198.51.100.91", body: { displayName: "Test viewer", handle: "viewer_synth" } });
  const got = await call("/v1/games/regone/forum-badges?names=" + encodeURIComponent("Synth Alpha,QuietOtter,Nobody Here"), { ip: "198.51.100.91", token: other.body.token });
  assert.equal(got.status, 200, got.text);
  assert.equal(got.body.badges["Synth Alpha"].rank, 1);
  assert.equal(got.body.badges["QuietOtter"].person.handle, "badge_synth", "public stats audience by default");
  assert.equal(got.body.badges["Nobody Here"], undefined);
  await call("/v1/games/prefs", { method: "POST", ip: "198.51.100.90", token, body: { audiences: { stats: "only" } } });
  const hidden = await call("/v1/games/regone/forum-badges?names=QuietOtter", { ip: "198.51.100.91", token: other.body.token });
  assert.equal(hidden.body.badges.QuietOtter, undefined, "a private stats audience hides the link");
  assert.equal((await call("/v1/games/regone/forum-badges?names=x")).status, 401);
});

test("each part has its own switch, on by default", async () => {
  const features = await call("/v1/features");
  ["nzlay_forum", "nzlay_forum_post", "nzlay_forum_regone"].forEach((name) => {
    assert.ok(features.body.features.includes(name), name);
    assert.ok(!features.body.off.includes(name), name + " on");
  });
  const flagged = new Miniflare(options());
  try {
    const db = await flagged.getD1Database("DB");
    await db.prepare("CREATE TABLE IF NOT EXISTS feature_flags (name TEXT PRIMARY KEY, off INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)").run();
    for (const name of ["nzlay_forum", "nzlay_forum_post", "nzlay_forum_regone"]) await db.prepare("INSERT INTO feature_flags (name, off, updated_at) VALUES (?, 1, 0)").bind(name).run();
    seen = [];
    for (const [path, method] of [["/v1/nzlay/forum", "GET"], ["/v1/nzlay/forum/topic/9", "GET"], ["/v1/nzlay/relay/login", "POST"], ["/v1/games/regone/forum-badges?names=x", "GET"]]) {
      assert.equal((await call(path, { method, body: method === "POST" ? {} : undefined }, flagged)).status, method === "GET" ? 204 : 404, path);
    }
    assert.equal(seen.length, 0, "an off switch calls nothing");
  } finally {
    await flagged.dispose();
  }
});
