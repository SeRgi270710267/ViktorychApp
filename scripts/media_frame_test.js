#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const communitiesCss = fs.readFileSync(path.join(ROOT, "communities.css"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf("function " + name + "(");
  if (start < 0) throw new Error("missing " + name);
  let i = source.indexOf("{", start);
  let depth = 0;
  for (; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("unclosed " + name);
}

const sandbox = {
  youtubeId(post, media) { return !!(media && media.youtube); },
  frameNarrow() { return !!sandbox.narrow; },
  narrow: false
};
vm.runInNewContext(
  [
    extractFunction(app, "frameSpec"),
    extractFunction(app, "frameAttrs"),
    extractFunction(app, "stripLeadMentions"),
    extractFunction(app, "stripLeadMentionHtml"),
    extractFunction(app, "mentionless")
  ].join("\n"),
  sandbox
);

function near(actual, expected, slack) {
  assert.ok(Math.abs(actual - expected) <= (slack == null ? 0.02 : slack), actual + " !~ " + expected);
}

function expectBox(width, height, narrow, boxW, boxH, clamped) {
  const spec = sandbox.frameSpec(width, height, narrow);
  assert.ok(spec, width + "x" + height);
  assert.strictEqual(spec.clamped, clamped, width + "x" + height + " clamped");
  near(spec.boxW / spec.boxH, boxW / boxH, 0.01);
  assert.strictEqual(spec.narrow, !!narrow);
}

expectBox(1920, 1080, false, 16, 9, false);
expectBox(1600, 1200, false, 4, 3, false);
expectBox(1000, 1000, false, 1, 1, false);
expectBox(800, 1000, false, 4, 5, false);
expectBox(1080, 1920, false, 4, 5, true);
expectBox(1080, 1920, true, 9, 16, false);
expectBox(300, 900, false, 4, 5, true);
expectBox(300, 900, true, 9, 16, true);
expectBox(4000, 1000, false, 2, 1, true);
expectBox(4000, 1000, true, 2, 1, true);
assert.strictEqual(sandbox.frameSpec(0, 100, false), null);
assert.strictEqual(sandbox.frameSpec(100, 0, true), null);

sandbox.narrow = false;
const photo = sandbox.frameAttrs({}, { width: 1080, height: 1920 });
assert.ok(photo.cls.indexOf("has-ratio") >= 0 && photo.cls.indexOf("is-clamped") >= 0, photo.cls);
assert.ok(photo.attr.indexOf("aspect-ratio:4 / 5") >= 0 || photo.attr.indexOf("aspect-ratio:800 / 1000") >= 0, photo.attr);
assert.ok(photo.attr.indexOf('data-fit="feed"') >= 0, photo.attr);
const wide = sandbox.frameAttrs({}, { width: 1920, height: 1080 });
assert.ok(wide.cls.indexOf("is-clamped") < 0, wide.cls);
assert.ok(wide.attr.indexOf("aspect-ratio:16 / 9") >= 0 || wide.attr.indexOf("aspect-ratio:1920 / 1080") >= 0, wide.attr);
const youtube = sandbox.frameAttrs({}, { youtube: true, width: 480, height: 360 });
assert.ok(youtube.attr.indexOf("aspect-ratio:16 / 9") >= 0, youtube.attr);
assert.ok(youtube.cls.indexOf("is-clamped") < 0, youtube.cls);
const pending = sandbox.frameAttrs({}, {});
assert.strictEqual(pending.known, false);
assert.ok(pending.attr.indexOf('data-fit="pending"') >= 0, pending.attr);
const round = sandbox.frameAttrs({}, { round: true, width: 100, height: 400 });
assert.strictEqual(round.attr, "");

assert.strictEqual(sandbox.stripLeadMentions("@bob @ann hello @cara"), "hello @cara");
assert.strictEqual(sandbox.stripLeadMentions("@bob"), "");
assert.strictEqual(sandbox.stripLeadMentions("@bob, hello"), "@bob, hello");
assert.strictEqual(sandbox.stripLeadMentions("hello @bob"), "hello @bob");
assert.strictEqual(sandbox.stripLeadMentions("  @bob hi"), "@bob hi");
assert.strictEqual(sandbox.stripLeadMentions("@Bob_1\nnext @zed"), "next @zed");
assert.strictEqual(
  sandbox.stripLeadMentionHtml('<a href="#/u/x/bob">@bob</a> <a href="#/u/x/ann">@ann</a> hello <a href="#/u/x/cara">@cara</a>'),
  'hello <a href="#/u/x/cara">@cara</a>'
);
assert.strictEqual(sandbox.stripLeadMentionHtml("@bob hello @cara"), "hello @cara");
assert.strictEqual(sandbox.stripLeadMentionHtml("see <a href=\"#\">@cara</a>"), "see <a href=\"#\">@cara</a>");
const stripped = sandbox.mentionless({ text: "@bob hello @cara", html: '<a href="#/u/x/bob">@bob</a> hello @cara' });
assert.strictEqual(stripped.text, "hello @cara");
assert.strictEqual(stripped.html, "hello @cara");
const kept = sandbox.mentionless({ text: "hello @cara", html: "" });
assert.strictEqual(kept.text, "hello @cara");

assert.ok(app.indexOf('return `<div class="thread">${parentHtml}${childHtml}</div>`') >= 0, "thread wrapper");
assert.ok(app.indexOf("opts.parentShown ? (mode !== \"status\"") >= 0, "reply line shows beside the parent in feeds and hides on the status page");
assert.ok(app.indexOf("opts.parentShown ? mentionless(displayPost(post))") >= 0, "leading mentions drop only beside the parent");
assert.ok(app.indexOf("function quoteCard(") >= 0 && app.indexOf('return `<div class="quote"') >= 0, "quotes stay bordered cards");
const cardStart = app.indexOf("function card(post, mode, opts)");
const cardEnd = app.indexOf("function emptyBlock(", cardStart);
const cardFn = app.slice(cardStart, cardEnd);
assert.ok(cardFn.indexOf("contextCard(") < 0, "a reply parent is not a quote box");
assert.ok(cardFn.indexOf("threadPair(") >= 0 && cardFn.indexOf("quoteCard(post.quoted)") >= 0, "threads and quotes render together");
assert.ok(app.indexOf('data-open="${esc(dest)}"') >= 0, "each post opens itself");
assert.ok(app.indexOf("function ancestorBlock(") >= 0 && app.indexOf("ancestorCard(node, index > 0)") >= 0, "detail walks the ancestor chain");
assert.ok(app.indexOf('class="ancestor"') >= 0 && app.indexOf('class="thread-line"') >= 0, "ancestors keep the connector");

assert.ok(css.indexOf("--thread: #2f3336") >= 0, "dark thread");
assert.ok(css.indexOf("--thread: #38444d") >= 0, "dim thread");
assert.ok(css.indexOf("--thread: #cfd9de") >= 0, "light thread");
assert.ok(css.indexOf(".thread > .post.continues { border-bottom: 0; }") >= 0, "no divider between a reply and its parent");
assert.ok(css.indexOf(".replying { color: var(--muted); font-size: 15px; line-height: 20px;") >= 0, "replying line");
assert.ok(/\.replying a \{ color: var\((?:--link, var\()?--blue\)\)?; \}/.test(css), "replying handle");
assert.ok(css.indexOf(".status-text { font-size: 17px; line-height: 24px;") >= 0, "focused post text");
assert.ok(css.indexOf(".ancestor .post-text { font-size: 15px; line-height: 20px; }") >= 0, "ancestor text");
assert.ok(css.indexOf(".media.m1 > .tile.has-ratio") >= 0 && css.indexOf("max-height: 125cqi") >= 0, "desktop clamp");
assert.ok(css.indexOf("max-height: 177.78cqi") >= 0, "mobile clamp");
assert.ok(css.indexOf(".media.m2 { grid-template-columns: 1fr 1fr; height: 288px; }") >= 0, "multi grid");
assert.ok(communitiesCss.indexOf("container-type: inline-size") >= 0 && communitiesCss.indexOf("max-height: 125cqi") >= 0, "community frames");

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return "rgb(" + ((n >> 16) & 255) + ", " + ((n >> 8) & 255) + ", " + (n & 255) + ")";
}

function tile(id, spec, extra) {
  const cls = "tile has-ratio" + (spec.clamped ? " is-clamped" : "") + (extra || "");
  const fit = extra && extra.indexOf("vplay") >= 0 ? '<img class="vposter" alt="">' : "<img alt=\"\">";
  return '<div class="media m1" data-case="' + id + '"><div class="' + cls + '" style="aspect-ratio:' + spec.boxW + " / " + spec.boxH + '">' + fit + "</div></div>";
}

function page(narrow) {
  const cases = [
    ["r169", 1920, 1080],
    ["r43", 1600, 1200],
    ["r11", 1000, 1000],
    ["r45", 800, 1000],
    ["r916", 1080, 1920],
    ["tall", 300, 900],
    ["wide", 4000, 1000]
  ];
  const tiles = cases.map((row) => tile(row[0], sandbox.frameSpec(row[1], row[2], narrow))).join("");
  const poster = tile("poster", sandbox.frameSpec(1920, 1080, narrow), " vplay");
  const cm = (id, spec, video) => {
    const cls = (video ? "cm-reddit-video" : "cm-reddit-photo") + " has-ratio" + (spec.clamped ? " is-clamped" : "");
    const tag = video
      ? '<video class="' + cls + '" style="aspect-ratio:' + spec.boxW + " / " + spec.boxH + '"></video>'
      : '<img class="' + cls + '" alt="" style="aspect-ratio:' + spec.boxW + " / " + spec.boxH + '" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">';
    return '<div class="cm-media-wrap" data-case="' + id + '">' + tag + "</div>";
  };
  const community = [
    cm("cm169", sandbox.frameSpec(1920, 1080, narrow), false),
    cm("cm916", sandbox.frameSpec(1080, 1920, narrow), false),
    cm("cmwide", sandbox.frameSpec(4000, 1000, narrow), true)
  ].join("");
  return `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="file://${path.join(ROOT, "styles.css")}"><link rel="stylesheet" href="file://${path.join(ROOT, "communities.css")}"><style>.post{content-visibility:visible}</style></head><body>
<div id="col" style="width:${narrow ? 360 : 500}px">
${tiles}
${poster}
<div class="media m2" data-case="grid"><div class="tile"><img alt=""></div><div class="tile"><img alt=""></div></div>
${community}
<div class="thread">
  <article class="post continues" data-open="#/status/parent">
    <div class="post-row"><div class="ava-col"><a><span class="ava"></span></a><div class="thread-line"></div></div>
    <div class="post-main"><div class="byline"><a class="name">Ada</a><a class="handle">@ada</a><span class="dot">·</span><a class="time">1h</a></div>
    <div class="post-text">Parent text</div></div></div>
  </article>
  <article class="post" data-open="#/status/reply">
    <div class="post-row"><a><span class="ava"></span></a>
    <div class="post-main"><div class="byline"><a class="name">Bea</a><a class="handle">@bea</a></div>
    <div class="post-text">hello @cara</div></div></div>
  </article>
</div>
<article class="post" data-case="solo">
  <div class="post-row"><a><span class="ava"></span></a>
  <div class="post-main"><div class="replying">Replying to <a href="#/u/x/ada">@ada</a></div><div class="post-text">@ada still here</div></div></div>
</article>
<div class="quote" data-open="#/status/quoted"><div class="quote-head"><span class="name">Cara</span><span class="handle">@cara</span></div><div class="quote-text">quoted</div></div>
<article class="ancestor" data-open="#/status/parent"><div class="ava-col"><span class="ava"></span><div class="thread-line"></div></div><div class="ancestor-main"><div class="post-text">ancestor</div></div></article>
<article class="status"><div class="status-author"><a class="name">Bea</a></div><div class="status-text">focused</div></article>
</div>
<pre id="out"></pre>
<script>
const themes = ["dark", "dim", "default"];
const colors = {};
themes.forEach((theme) => {
  document.documentElement.setAttribute("data-theme", theme === "dark" ? "" : theme);
  if (theme === "dark") document.documentElement.removeAttribute("data-theme");
  const line = document.querySelector(".thread .thread-line");
  const reply = document.querySelector(".replying");
  const link = document.querySelector(".replying a");
  colors[theme] = {
    thread: getComputedStyle(line).backgroundColor,
    muted: getComputedStyle(reply).color,
    blue: getComputedStyle(link).color
  };
});
document.documentElement.removeAttribute("data-theme");
const rows = [];
document.querySelectorAll("[data-case]").forEach((el) => {
  const box = el.matches(".media") ? el.querySelector(".tile") : (el.querySelector("img, video") || el);
  const rect = box.getBoundingClientRect();
  const img = box.matches && box.matches("img, video") ? box : box.querySelector("img, video");
  rows.push({
    id: el.dataset.case,
    w: rect.width,
    h: rect.height,
    fit: img ? getComputedStyle(img).objectFit : "",
    boxH: el.getBoundingClientRect().height
  });
});
const parent = document.querySelector(".post.continues");
const reply = document.querySelector('.post[data-open="#/status/reply"]');
const line = parent.querySelector(".thread-line");
const parentAva = parent.querySelector(".ava");
const replyAva = reply.querySelector(".ava");
const lr = line.getBoundingClientRect();
const pr = parent.getBoundingClientRect();
const ar = parentAva.getBoundingClientRect();
const rr = replyAva.getBoundingClientRect();
const quote = document.querySelector(".quote");
const ancestor = document.querySelector(".ancestor");
document.getElementById("out").textContent = JSON.stringify({
  rows: rows,
  colors: colors,
  thread: {
    lineW: lr.width,
    lineLeft: lr.left,
    lineTop: lr.top,
    lineBottom: lr.bottom,
    avaCenter: ar.left + ar.width / 2,
    avaBottom: ar.bottom,
    replyAvaTop: rr.top,
    parentBorder: getComputedStyle(parent).borderBottomWidth,
    replyBorder: getComputedStyle(reply).borderBottomWidth,
    parentOpen: parent.getAttribute("data-open"),
    replyOpen: reply.getAttribute("data-open"),
    quoteBorder: getComputedStyle(quote).borderTopWidth,
    quoteRadius: getComputedStyle(quote).borderRadius,
    replying: getComputedStyle(document.querySelector(".replying")).fontSize,
    postText: getComputedStyle(document.querySelector(".post-text")).fontSize,
    statusText: getComputedStyle(document.querySelector(".status-text")).fontSize,
    ancestorText: getComputedStyle(ancestor.querySelector(".post-text")).fontSize,
    ancestorLine: ancestor.querySelector(".thread-line").getBoundingClientRect().width,
    byline: getComputedStyle(document.querySelector(".byline")).fontSize,
    nameWeight: getComputedStyle(document.querySelector(".status-author .name")).fontWeight,
    parentBottom: pr.bottom
  }
});
</script></body></html>`;
}

function chrome(htmlName, html, width, height) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frame-"));
  const file = path.join(dir, htmlName);
  fs.writeFileSync(file, html);
  const bin = fs.existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : "google-chrome";
  const run = spawnSync(bin, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--force-device-scale-factor=1",
    "--virtual-time-budget=4000",
    "--window-size=" + width + "," + height,
    "--dump-dom",
    "file://" + file
  ], { encoding: "utf8", timeout: 30000 });
  if (run.status !== 0) {
    throw new Error("chrome failed " + (run.stderr || run.stdout || run.status));
  }
  const match = String(run.stdout || "").match(/<pre id="out">([\s\S]*?)<\/pre>/);
  if (!match) throw new Error("chrome did not measure layout:\n" + String(run.stdout || "").slice(0, 500));
  return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'"));
}

function checkLayout(data, narrow) {
  const byId = {};
  data.rows.forEach((row) => { byId[row.id] = row; });
  function ratio(id, width, height) {
    const spec = sandbox.frameSpec(width, height, narrow);
    const row = byId[id];
    assert.ok(row && row.w > 100 && row.h > 40, id + " " + JSON.stringify(row));
    near(row.w / row.h, spec.boxW / spec.boxH, 0.03);
    const expectFit = spec.clamped || id === "poster" ? "cover" : "contain";
    assert.strictEqual(row.fit, expectFit, id + " fit " + row.fit);
  }
  ratio("r169", 1920, 1080);
  ratio("r43", 1600, 1200);
  ratio("r11", 1000, 1000);
  ratio("r45", 800, 1000);
  ratio("r916", 1080, 1920);
  ratio("tall", 300, 900);
  ratio("wide", 4000, 1000);
  ratio("poster", 1920, 1080);
  ratio("cm169", 1920, 1080);
  ratio("cm916", 1080, 1920);
  ratio("cmwide", 4000, 1000);
  near(byId.grid.boxH, 288, 2);
  const thread = data.thread;
  near(thread.lineW, 2, 0.6);
  near(thread.lineLeft + 1, thread.avaCenter, 1.5);
  assert.ok(thread.lineTop + 1 >= thread.avaBottom, "line starts under the avatar " + thread.lineTop + " " + thread.avaBottom);
  assert.ok(thread.lineBottom >= thread.replyAvaTop - 1, "line reaches the reply " + thread.lineBottom + " " + thread.replyAvaTop);
  assert.strictEqual(thread.parentBorder, "0px");
  assert.strictEqual(thread.replyBorder, "1px");
  assert.notStrictEqual(thread.parentOpen, thread.replyOpen);
  assert.strictEqual(thread.quoteBorder, "1px");
  assert.ok(thread.quoteRadius.indexOf("16px") === 0, thread.quoteRadius);
  assert.strictEqual(thread.replying, "15px");
  assert.strictEqual(thread.postText, "15px");
  assert.strictEqual(thread.statusText, "17px");
  assert.strictEqual(thread.ancestorText, "15px");
  near(thread.ancestorLine, 2, 0.6);
  assert.strictEqual(thread.byline, "15px");
  assert.ok(thread.nameWeight === "800" || thread.nameWeight === "bold", thread.nameWeight);
  assert.strictEqual(data.colors.dark.thread, rgb("#2f3336"));
  assert.strictEqual(data.colors.dim.thread, rgb("#38444d"));
  assert.strictEqual(data.colors.default.thread, rgb("#cfd9de"));
  assert.strictEqual(data.colors.dark.muted, rgb("#71767b"));
  assert.strictEqual(data.colors.dim.muted, rgb("#8b98a5"));
  assert.strictEqual(data.colors.default.muted, rgb("#536471"));
  assert.strictEqual(data.colors.dark.blue, rgb("#1d9bf0"));
  assert.strictEqual(data.colors.default.blue, rgb("#1d9bf0"));
}

const desktop = chrome("desktop.html", page(false), 1000, 900);
checkLayout(desktop, false);
const mobile = chrome("mobile.html", page(true), 390, 900);
checkLayout(mobile, true);

const py = spawnSync("python3", ["-c", `
import tempfile
from pathlib import Path
import sys
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "scripts"))})
from update_feeds import image_size, stamp_media_dimensions

png = b"\\x89PNG\\r\\n\\x1a\\n" + (13).to_bytes(4, "big") + b"IHDR" + (1920).to_bytes(4, "big") + (1080).to_bytes(4, "big")
gif = b"GIF89a" + (16).to_bytes(2, "little") + (9).to_bytes(2, "little")
jpeg = bytes.fromhex("ffd8ffc0000b0800100020")
webp = b"RIFF" + b"\\x00" * 4 + b"WEBPVP8X" + b"\\x00" * 8 + (1919).to_bytes(3, "little") + (1079).to_bytes(3, "little")
assert image_size(png) == (1920, 1080), image_size(png)
assert image_size(gif) == (16, 9), image_size(gif)
assert image_size(jpeg) == (32, 16), image_size(jpeg)
assert image_size(webp) == (1920, 1080), image_size(webp)
root = Path(tempfile.mkdtemp())
media = root / "media"
media.mkdir()
(media / "wide.png").write_bytes(png)
posts = [
    {"media": [{"url": "media/wide.png"}]},
    {"media": [{"url": "media/wide.png", "width": 4, "height": 5}]},
    {"media": [{"url": "https://cdn.example/a.jpg"}]},
    {"media": [{"url": "media/../wide.png"}]},
    {"quoted": {"media": [{"url": "media/wide.png"}]}},
    {"replyParent": {"media": [{"poster": "media/wide.png"}]}},
]
stamped = stamp_media_dimensions(posts, root)
assert stamped == 3, stamped
assert posts[0]["media"][0]["width"] == 1920 and posts[0]["media"][0]["height"] == 1080
assert posts[1]["media"][0]["width"] == 4 and posts[1]["media"][0]["height"] == 5
assert "width" not in posts[2]["media"][0]
assert "width" not in posts[3]["media"][0]
assert posts[4]["quoted"]["media"][0]["width"] == 1920
assert posts[5]["replyParent"]["media"][0]["height"] == 1080
print("stamp-ok")
`], { encoding: "utf8" });
if (py.status !== 0) {
  throw new Error(py.stderr || py.stdout || "image header probe failed");
}
assert.ok(String(py.stdout).indexOf("stamp-ok") >= 0, py.stdout);

console.log("media frame and reply thread checks passed");
