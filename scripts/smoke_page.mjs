#!/usr/bin/env node
/* Load the built site, or a live URL, in headless Chrome.
   Fails when a script or stylesheet is missing, the page throws,
   or the screen stays empty. Runs once with a fresh profile and
   once with saved data from before the presence deploy. */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8"
};

const OLD_STATE = `
localStorage.setItem("viktorychapp-account-v1", JSON.stringify({token:"t", account:{publicId:"123456789012", handle:"owner", name:"Owner"}}));
localStorage.setItem("viktorychapp-settings-v1", "{");
localStorage.setItem("viktorych-screen-v1", "{");
localStorage.setItem("viktorychapp-storage", "nope");
`;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  return process.argv[i + 1];
}

function chromeBin() {
  const listed = [process.env.CHROME_PATH, process.env.CHROME_BIN, "google-chrome", "google-chrome-stable", "chrome", "chromium", "chromium-browser"];
  for (const bin of listed) {
    if (!bin) continue;
    if (bin.includes("/")) {
      try { statSync(bin); return bin; } catch (err) { continue; }
    }
    const found = spawnSync("which", [bin], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error("Chrome is not installed");
}

function serve(root) {
  const base = resolve(root);
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = resolve(join(base, rel));
    if (file !== base && !file.startsWith(base + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("missing");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}/` });
    });
  });
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function textOf(url) {
  const res = await fetch(url, { cache: "no-store" });
  return { status: res.status, text: await res.text(), type: res.headers.get("content-type") || "" };
}

function assetRefs(html) {
  const refs = [];
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(html))) {
    const raw = match[1];
    if (!raw || raw.startsWith("data:") || raw.startsWith("#") || raw.startsWith("mailto:")) continue;
    if (/^https?:/i.test(raw) || raw.startsWith("//")) continue;
    const clean = raw.split("#")[0].split("?")[0];
    if (!/\.(?:js|css)$/i.test(clean)) continue;
    refs.push(clean.replace(/^\.\//, ""));
  }
  return [...new Set(refs)];
}

async function checkAssets(pageUrl) {
  const base = new URL(pageUrl);
  const home = await textOf(base.href);
  if (home.status !== 200 || !home.text.includes("<html")) {
    throw new Error("page HTML status " + home.status);
  }
  const missing = [];
  for (const rel of assetRefs(home.text)) {
    const asset = new URL(rel, base);
    const res = await fetch(asset, { method: "GET", cache: "no-store" });
    if (res.status !== 200) missing.push(res.status + " " + asset.pathname);
    await res.arrayBuffer().catch(() => {});
  }
  if (missing.length) throw new Error("missing assets:\n" + missing.join("\n"));
  return assetRefs(home.text).length;
}

async function waitForAssets(pageUrl, tries) {
  let last = "not ready";
  for (let i = 0; i < tries; i++) {
    try {
      const count = await checkAssets(pageUrl);
      console.log("live assets " + count);
      return;
    } catch (err) {
      last = err.message || String(err);
      console.log("waiting for live page: " + last.split("\n")[0]);
      await sleep(15000);
    }
  }
  throw new Error(last);
}

function get(url) {
  return fetch(url).then((res) => res.text());
}

async function probe(pageUrl, opts) {
  const dir = mkdtempSync(join(tmpdir(), "viktorych-smoke-"));
  const port = 9300 + Math.floor(Math.random() * 500);
  const logPath = join(dir, "chrome.log");
  const logFd = openSync(logPath, "a");
  const bin = chromeBin();
  const chrome = spawn(bin, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--remote-allow-origins=*",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dir}`,
    `--window-size=${opts.width},${opts.height}`,
    "about:blank"
  ], { stdio: ["ignore", logFd, logFd] });
  try {
    let wsUrl = "";
    for (let i = 0; i < 50; i++) {
      try {
        const ver = JSON.parse(await get(`http://127.0.0.1:${port}/json/version`));
        wsUrl = ver.webSocketDebuggerUrl;
        break;
      } catch (err) {
        await sleep(200);
      }
    }
    if (!wsUrl) {
      let detail = "";
      try { detail = readFileSync(logPath, "utf8").trim().slice(-800); } catch (err) { detail = ""; }
      throw new Error("Chrome did not open a debugger (" + bin + ")" + (detail ? "\n" + detail : ""));
    }
    const targets = JSON.parse(await get(`http://127.0.0.1:${port}/json/list`));
    const page = targets.find((item) => item.type === "page") || targets[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const events = [];
    function send(method, params) {
      const msgId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(msgId, { resolve, reject });
        ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
      });
    }
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const waiter = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) waiter.reject(new Error(JSON.stringify(msg.error)));
        else waiter.resolve(msg.result);
      } else if (msg.method) events.push(msg);
    });
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
    });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Log.enable");
    if (opts.init) await send("Page.addScriptToEvaluateOnNewDocument", { source: opts.init });
    await send("Page.navigate", { url: pageUrl });
    const start = Date.now();
    while (Date.now() - start < 20000) {
      if (events.some((event) => event.method === "Page.loadEventFired")) break;
      await sleep(200);
    }
    await sleep(3500);
    const info = await send("Runtime.evaluate", {
      expression: `(() => {
        const text = (document.body && document.body.innerText || "").replace(/\\s+/g, " ").trim();
        return { text: text.slice(0, 300), guard: !!document.getElementById("boot-guard"), children: (document.getElementById("app") || {}).childElementCount || 0 };
      })()`,
      returnByValue: true
    });
    const pageInfo = info && info.result && info.result.value || {};
    const exceptions = events.filter((event) => event.method === "Runtime.exceptionThrown").map((event) => {
      const detail = event.params.exceptionDetails || {};
      const ex = detail.exception || {};
      return (ex.description || detail.text || "exception").slice(0, 400);
    });
    const failed = events.filter((event) => event.method === "Network.responseReceived" && event.params.response && event.params.response.status >= 400).map((event) => {
      const response = event.params.response;
      return response.status + " " + response.url;
    }).filter((line) => {
      try {
        const asset = new URL(line.split(" ").slice(1).join(" "));
        const page = new URL(pageUrl);
        if (asset.origin !== page.origin) return false;
        return /\.(?:js|css)(?:$|\?)/i.test(asset.pathname) || asset.pathname === page.pathname;
      } catch (err) {
        return false;
      }
    });
    ws.close();
    const problems = [];
    if (exceptions.length) problems.push("exception: " + exceptions[0]);
    if (failed.length) problems.push("request: " + failed[0]);
    if (pageInfo.guard) problems.push("boot guard is showing");
    if (!pageInfo.text || pageInfo.text.length < 8) problems.push("empty render");
    return { problems, text: pageInfo.text || "", label: opts.label };
  } finally {
    try { chrome.kill("SIGKILL"); } catch (err) { /* already gone */ }
    await sleep(300);
    try { rmSync(dir, { recursive: true, force: true }); } catch (err) { /* Chrome may still be releasing the profile */ }
  }
}

async function main() {
  const site = arg("--site", "");
  const live = arg("--url", process.env.PAGE_URL || "");
  const tries = Number(arg("--retry", "1")) || 1;
  let url = live;
  let server = null;
  if (site) {
    const served = await serve(site);
    server = served.server;
    url = served.url;
  }
  if (!url) {
    console.error("pass --site or --url");
    process.exit(1);
  }
  try {
    if (tries > 1) await waitForAssets(url, tries);
    else {
      const count = await checkAssets(url);
      console.log("assets " + count);
    }
    const runs = [
      { label: "fresh-desktop", width: 1366, height: 768 },
      { label: "fresh-mobile", width: 412, height: 860 },
      { label: "old-state", width: 1366, height: 768, init: OLD_STATE }
    ];
    const problems = [];
    for (const run of runs) {
      const result = await probe(url, run);
      console.log(run.label + ": " + (result.text || "(empty)").slice(0, 120));
      result.problems.forEach((problem) => problems.push(run.label + " " + problem));
    }
    if (problems.length) {
      console.error(problems.join("\n"));
      process.exit(1);
    }
    console.log("smoke ok");
  } finally {
    if (server) server.close();
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
