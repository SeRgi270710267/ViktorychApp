import assert from "node:assert/strict";
import test from "node:test";
import { handleNewsletter, sweepNewsletters } from "../src/newsletters.js";
import { sanitizeHtml, feedCandidates, parseFeed, archiveLinks, extractArticle } from "../../shared/newsletter-feed.js";

function bucket() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.has(key) ? { text: async () => store.get(key).body } : null; },
    async put(key, value) { store.set(key, { body: value, uploaded: new Date(store.now || 0) }); },
    async list({ prefix }) { return { objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ key: k, uploaded: store.get(k).uploaded })), truncated: false }; },
    async delete(keys) { keys.forEach((k) => store.delete(k)); }
  };
}

function site(routes, seen) {
  return async (url) => {
    seen.push(String(url));
    const route = routes[String(url)];
    if (!route) return new Response("no", { status: 404 });
    if (route.redirect) return new Response(null, { status: 301, headers: { location: route.redirect } });
    return new Response(route.body, { status: 200, headers: { "content-type": route.type || "text/html" } });
  };
}

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
<title><![CDATA[Fixture Weekly]]></title><link>https://fixture.substack.com</link><description>Notes from a fixture</description>
<image><url>https://cdn.example.com/logo.png</url></image>
<item><title>Issue &amp; one</title><link>https://fixture.substack.com/p/one</link><guid>one</guid><pubDate>Tue, 27 Oct 2026 10:00:00 GMT</pubDate><dc:creator>Writer</dc:creator>
<description>Short teaser</description>
<content:encoded><![CDATA[<p onclick="x()">Hello <b>reader</b></p><script>alert(1)</script><img src="https://cdn.example.com/hero.jpg" width="800"><img src="https://track.example.com/o.gif?u=1" width="1" height="1"><a href="javascript:alert(1)">bad</a><a href="https://example.org/x">good</a><iframe src="https://evil.example"></iframe><div style="color:red">styled</div>]]></content:encoded></item>
<item><title>Second</title><link>https://fixture.substack.com/p/two</link><guid>two</guid><description>Only an excerpt</description></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Letter</title><link href="https://atom.example.com/"/><icon>https://atom.example.com/i.png</icon>
<entry><title>Atom one</title><id>tag:a,1</id><link rel="alternate" href="https://atom.example.com/1"/><updated>2026-10-20T00:00:00Z</updated><content type="html">&lt;p&gt;Atom body&lt;/p&gt;</content></entry></feed>`;

test("sanitizer drops scripts, handlers, frames, styles, javascript links and tracking pixels", () => {
  const out = sanitizeHtml(parseFeed(RSS, "https://fixture.substack.com/feed").items[0].html, "https://fixture.substack.com/p/one").html;
  assert.ok(!/script|onclick|iframe|style=|javascript:|track\.example/i.test(out), out);
  assert.ok(out.includes('<img src="https://cdn.example.com/hero.jpg"'));
  assert.ok(out.includes('href="https://example.org/x" target="_blank" rel="noopener noreferrer nofollow"'));
  assert.ok(out.includes("<b>reader</b>"));
});

test("feed candidates cover Substack, Medium, Buttondown and Mailchimp", () => {
  assert.deepEqual(feedCandidates("https://fixture.substack.com/p/x"), ["https://fixture.substack.com/feed"]);
  assert.deepEqual(feedCandidates("https://medium.com/@someone"), ["https://medium.com/feed/@someone"]);
  assert.deepEqual(feedCandidates("https://buttondown.email/someone"), ["https://buttondown.com/someone/rss"]);
  assert.equal(feedCandidates("https://us5.campaign-archive.com/home/?u=abcdef123456&id=abc123")[0], "https://us5.campaign-archive.com/feed?u=abcdef123456&id=abc123");
});

test("a pasted Substack link becomes a sender with issues, then answers from R2", async () => {
  const seen = [];
  const r2 = bucket();
  const deps = { fetch: site({ "https://fixture.substack.com/feed": { body: RSS, type: "application/rss+xml" } }, seen), r2, now: () => 1000 };
  const res = await handleNewsletter(new Request("https://api.test/v1/newsletter?url=" + encodeURIComponent("fixture.substack.com/p/one")), deps);
  assert.equal(res.status, 200);
  const doc = await res.json();
  assert.equal(doc.feed, "https://fixture.substack.com/feed");
  assert.equal(doc.profile.name, "Fixture Weekly");
  assert.equal(doc.profile.avatar, "https://cdn.example.com/logo.png");
  assert.equal(doc.items.length, 2);
  assert.equal(doc.items[0].title, "Issue & one");
  assert.equal(doc.items[0].image, "https://cdn.example.com/hero.jpg");
  assert.equal(doc.items[0].html, undefined, "the list has no HTML");
  assert.ok(/^[a-f0-9]{16}$/.test(doc.items[0].id));
  const issue = await (await handleNewsletter(new Request("https://api.test/v1/newsletter/issue?key=" + doc.key + "&id=" + doc.items[0].id), deps)).json();
  assert.ok(issue.html.includes("Hello <b>reader</b>"));
  const before = seen.length;
  const again = await (await handleNewsletter(new Request("https://api.test/v1/newsletter?url=" + encodeURIComponent(doc.feed)), deps)).json();
  assert.equal(again.key, doc.key);
  assert.equal(seen.length, before, "fresh copy, no refetch");
  const stored = JSON.stringify([...r2.store.values()]);
  assert.ok(!/user|account|email/i.test(Object.keys(JSON.parse(r2.store.values().next().value.body)).join(",")), "no reader data stored");
  assert.ok(stored.length > 0);
});

test("feeds linked from a page, Atom, and excerpt-only issues read from the page", async () => {
  const seen = [];
  const page = `<html><head><link rel="alternate" type="application/atom+xml" href="/atom.xml"><link rel="apple-touch-icon" href="/t.png"></head><body></body></html>`;
  const article = `<html><body><nav>menu</nav><div class="gh-content"><p>${"Full issue text. ".repeat(30)}</p><script>x</script></div></body></html>`;
  const atom = ATOM.replace("&lt;p&gt;Atom body&lt;/p&gt;", "short");
  const deps = { fetch: site({ "https://atom.example.com/": { body: page }, "https://atom.example.com/atom.xml": { body: atom, type: "application/atom+xml" }, "https://atom.example.com/1": { body: article } }, seen), r2: bucket(), now: () => 1 };
  const doc = await (await handleNewsletter(new Request("https://api.test/v1/newsletter?url=https://atom.example.com/"), deps)).json();
  assert.equal(doc.profile.name, "Atom Letter");
  assert.equal(doc.items[0].link, "https://atom.example.com/1");
  const issue = await (await handleNewsletter(new Request("https://api.test/v1/newsletter/issue?key=" + doc.key + "&id=" + doc.items[0].id), deps)).json();
  assert.ok(issue.html.includes("Full issue text."));
  assert.ok(!/menu|<script/.test(issue.html));
});

test("a Mailchimp style web archive without a feed still lists issues", async () => {
  const html = `<html><head><title>x</title></head><body><ul><li class="campaign">10/27/2026 - <a href="https://us5.campaign-archive.com/?u=abcdef123456&id=1111aaaa" title="Weekly 3">Weekly 3</a></li><li class="campaign">10/20/2026 - <a href="https://us5.campaign-archive.com/?u=abcdef123456&id=2222bbbb">Weekly 2</a></li><li class="campaign">10/13/2026 - <a href="https://us5.campaign-archive.com/?u=abcdef123456&id=3333cccc">Weekly 1</a></li></ul></body></html>`;
  const links = archiveLinks(html, "https://us5.campaign-archive.com/home/?u=abcdef123456&id=abc123");
  assert.equal(links.length, 3);
  assert.equal(links[0].date.slice(0, 10), "2026-10-27");
  const deps = { fetch: site({ "https://us5.campaign-archive.com/home/?u=abcdef123456&id=abc123": { body: html } }, []), r2: bucket(), now: () => 1 };
  const doc = await (await handleNewsletter(new Request("https://api.test/v1/newsletter?url=" + encodeURIComponent("https://us5.campaign-archive.com/home/?u=abcdef123456&id=abc123")), deps)).json();
  assert.equal(doc.items.length, 3);
  assert.equal(doc.items[0].title, "Weekly 3");
  assert.ok(extractArticle(`<body><td id="templateBody"><p>${"x ".repeat(200)}</p></td></body>`).includes("templateBody"));
});

test("private and bad targets are refused; the cron drops stale copies", async () => {
  const deps = { fetch: site({}, []), r2: bucket(), now: () => 1 };
  assert.equal((await handleNewsletter(new Request("https://api.test/v1/newsletter?url=" + encodeURIComponent("http://127.0.0.1/feed")), deps)).status, 400);
  const r2 = bucket();
  r2.store.now = 0;
  await r2.put("newsletter/old-1.json", "{}");
  r2.store.now = 20 * 24 * 3600 * 1000;
  await r2.put("newsletter/new-1.json", "{}");
  assert.equal(await sweepNewsletters(r2, 21 * 24 * 3600 * 1000), 1);
  assert.ok(r2.store.has("newsletter/new-1.json"));
});
