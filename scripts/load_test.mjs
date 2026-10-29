#!/usr/bin/env node
/* Load test: 100 virtual users against read-only targets.

   Each user does what one visible tab does in quiet minutes after the
   change-signal work: read the public pulse file every ~20 seconds (no
   Worker request) and, at start, read one Worker health check. One extra
   client sends a burst to /v1/pulse with a made-up token to check the
   per-client cap answers 429 instead of passing everything through.

   Nothing here writes or signs in.

   node scripts/load_test.mjs [--users 100] [--seconds 120] [--api URL] [--pulse URL] [--burst 140]
*/
const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const USERS = Number(opt("users", 100));
const SECONDS = Number(opt("seconds", 120));
const API = String(opt("api", "https://viktorych-accounts.viktorych-accounts.workers.dev")).replace(/\/$/, "");
const PULSE = String(opt("pulse", "https://pub-bf9b5e3ebb2b421aa49e7af484f3c22d.r2.dev/pulse/v1.json"));
const BURST = Number(opt("burst", 140));
const ORIGIN = "https://viktorychgroup.github.io";

const stats = {};
function note(kind, ms, status) {
  const s = stats[kind] || (stats[kind] = { n: 0, ok: 0, codes: {}, times: [] });
  s.n += 1;
  if (status >= 200 && status < 400) s.ok += 1;
  s.codes[status] = (s.codes[status] || 0) + 1;
  s.times.push(ms);
}
async function hit(kind, url, init) {
  const t = performance.now();
  let status = 0;
  try {
    const res = await fetch(url, Object.assign({ headers: { Origin: ORIGIN } }, init || {}));
    status = res.status;
    await res.arrayBuffer();
  } catch (err) { status = 0; }
  note(kind, performance.now() - t, status);
  return status;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function pct(list, p) {
  if (!list.length) return 0;
  const sorted = list.slice().sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]);
}

async function user(i, until) {
  await sleep(Math.random() * 2000);
  await hit("worker /v1/health", API + "/v1/health");
  while (Date.now() < until) {
    await hit("public pulse", PULSE + "?t=" + Math.floor(Date.now() / 10000));
    await sleep(20000 + Math.random() * 3000);
  }
}

async function burst() {
  const token = "loadtest-" + Math.random().toString(36).slice(2);
  const codes = [];
  for (let i = 0; i < BURST; i += 20) {
    const batch = [];
    for (let j = i; j < Math.min(BURST, i + 20); j++) batch.push(hit("burst /v1/pulse", API + "/v1/pulse", { headers: { Origin: ORIGIN, Authorization: "Bearer " + token } }).then((c) => codes.push(c)));
    await Promise.all(batch);
  }
  return codes;
}

const started = Date.now();
const until = started + SECONDS * 1000;
const burstCodes = BURST > 0 ? burst() : Promise.resolve([]);
await Promise.all(Array.from({ length: USERS }, (_, i) => user(i, until)));
const codes = await burstCodes;
const elapsed = (Date.now() - started) / 1000;

console.log(`users ${USERS}, ${elapsed.toFixed(0)} s`);
for (const [kind, s] of Object.entries(stats)) {
  console.log(`${kind}: ${s.n} requests, ${s.ok} ok, codes ${JSON.stringify(s.codes)}, p50 ${pct(s.times, 0.5)} ms, p95 ${pct(s.times, 0.95)} ms, max ${pct(s.times, 1)} ms`);
}
if (codes.length) {
  const limited = codes.filter((c) => c === 429).length;
  console.log(`burst: ${codes.length} sent, ${limited} answered 429 by the per-client cap`);
}
const workerCalls = Object.entries(stats).filter(([k]) => k.startsWith("worker") || k.startsWith("burst")).reduce((n, [, s]) => n + s.n, 0);
console.log(`Worker requests spent: ${workerCalls}`);
