/* Local scheduler for the sharing pool. Every decision is made on this
   device from what it measured; there is no coordinator. Pure functions,
   so the Worker tests and the browser share them.

   - Sources (each peer, and the normal request chain) get a score from
     measured latency, throughput and failures. Lower is better.
   - Work runs in priority order: what is on screen, the next screen, likely
     next (followed accounts, open threads), then background prefetch.
   - Device conditions set a budget: how much to seed and whether to
     prefetch at all.
   - The memory store evicts by recency weighted by how often peers asked.
   - Seeding announces the rarest items first, and a peer is never sent the
     same chunk twice. */

export const PRIORITY = { visible: 0, next: 1, likely: 2, background: 3 };
export const MB = 1024 * 1024;

/* ---------- source scores ---------- */

const PRIOR = { peer: { lat: 120, tput: 400, fail: 0.1 }, origin: { lat: 250, tput: 800, fail: 0.05 } };
const ALPHA = 0.3;

export function kindOf(name) {
  return String(name || "").indexOf("peer:") === 0 ? "peer" : "origin";
}

/* One measurement: ms until the answer finished, bytes it carried, ok. */
export function recordSource(scores, name, sample, now) {
  const key = String(name || "");
  if (!key) return null;
  const prior = PRIOR[kindOf(key)];
  const s = scores.get(key) || { lat: prior.lat, tput: prior.tput, fail: prior.fail, n: 0, at: 0 };
  const ms = Math.max(1, Number(sample && sample.ms) || 1);
  const bytes = Math.max(0, Number(sample && sample.bytes) || 0);
  const ok = !!(sample && sample.ok);
  s.fail = s.fail * (1 - ALPHA) + (ok ? 0 : 1) * ALPHA;
  if (ok) {
    // Short answers say more about latency, long ones about throughput.
    if (bytes < 16 * 1024) s.lat = s.lat * (1 - ALPHA) + ms * ALPHA;
    else s.tput = s.tput * (1 - ALPHA) + (bytes / ms) * ALPHA;
  }
  s.n += 1;
  s.at = Number(now) || Date.now();
  scores.set(key, s);
  if (scores.size > 64) scores.delete(scores.keys().next().value);
  return s;
}

/* Expected milliseconds for a typical 64 KB answer, padded for failures.
   Old measurements drift back toward the prior so a source gets retried. */
export function sourceScore(scores, name, now) {
  const prior = PRIOR[kindOf(name)];
  const s = scores.get(String(name || ""));
  if (!s) return (prior.lat + 65536 / prior.tput) * (1 + 4 * prior.fail);
  const age = Math.max(0, (Number(now) || Date.now()) - s.at);
  const keep = Math.max(0, 1 - age / (30 * 60 * 1000));
  const lat = s.lat * keep + prior.lat * (1 - keep);
  const tput = s.tput * keep + prior.tput * (1 - keep);
  const fail = s.fail * keep + prior.fail * (1 - keep);
  return (lat + 65536 / Math.max(1, tput)) * (1 + 4 * fail);
}

export function rankSources(scores, names, now) {
  return names.slice().sort((a, b) => sourceScore(scores, a, now) - sourceScore(scores, b, now));
}

/* Starts the two best sources together; the first good answer wins and the
   other is cancelled. If both fail, the rest are tried in order.
   tasks: [{ name, run(signal) -> Promise<value> }], already ranked.
   good(value) says whether an answer counts. */
export async function raceTop(tasks, opts) {
  const o = opts || {};
  const good = o.good || ((v) => v != null);
  const width = Math.max(1, Math.min(Number(o.width) || 2, tasks.length));
  const runOne = (task) => {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : { signal: { aborted: false }, abort() { this.signal.aborted = true; } };
    const t0 = Date.now();
    const p = Promise.resolve().then(() => task.run(ctl.signal)).then(
      (value) => ({ task, value, ok: good(value), ms: Date.now() - t0 }),
      (err) => ({ task, value: null, ok: false, err, ms: Date.now() - t0 }));
    return { ctl, p };
  };
  const head = tasks.slice(0, width).map(runOne);
  const winner = await new Promise((resolve) => {
    let left = head.length;
    head.forEach((r) => r.p.then((out) => {
      if (o.onResult) o.onResult(out);
      if (out.ok) resolve(out);
      else if (--left === 0) resolve(null);
    }));
  });
  if (winner) {
    head.forEach((r) => { try { r.ctl.abort(); } catch (err) { /* done */ } });
    return { name: winner.task.name, value: winner.value };
  }
  for (const task of tasks.slice(width)) {
    const r = runOne(task);
    const out = await r.p;
    if (o.onResult) o.onResult(out);
    if (out.ok) return { name: task.name, value: out.value };
  }
  return null;
}

/* ---------- priorities ---------- */

export function priorityOf(value) {
  const v = String(value || "visible");
  return Object.prototype.hasOwnProperty.call(PRIORITY, v) ? PRIORITY[v] : PRIORITY.visible;
}

/* A small queue: at most `limit` jobs at once, highest priority first.
   Background jobs are dropped (resolve null) when the budget says no
   prefetch. */
export function createQueue(limit, budget) {
  const q = { limit: Math.max(1, limit || 3), busy: 0, jobs: [], budget: budget || (() => ({ prefetch: true })), seq: 0 };
  const pump = () => {
    while (q.busy < q.limit && q.jobs.length) {
      q.jobs.sort((a, b) => a.p - b.p || a.n - b.n);
      const job = q.jobs.shift();
      if (job.p >= PRIORITY.background && !q.budget().prefetch) { job.resolve(null); continue; }
      q.busy += 1;
      Promise.resolve().then(job.fn).then(job.resolve, () => job.resolve(null)).then(() => { q.busy -= 1; pump(); });
    }
  };
  q.run = (priority, fn) => new Promise((resolve) => {
    const p = priorityOf(priority);
    if (p >= PRIORITY.background && !q.budget().prefetch) { resolve(null); return; }
    q.jobs.push({ p, n: q.seq++, fn, resolve });
    pump();
  });
  return q;
}

/* ---------- device budget ---------- */

/* seed: 0 off, 1 low, 2 normal, 3 high. Whether the pool runs at all is
   still poolEnabled's call; this only tunes how much it does. */
export function deviceBudget(facts, env) {
  const f = facts || {};
  const e = env || {};
  const level = typeof e.battery === "number" ? e.battery : null;
  const charging = f.charging === true;
  const effective = String(e.effectiveType || "").toLowerCase();
  let seed = 2;
  let why = "normal";
  if (f.saveData || f.cellular || f.metered) { seed = 0; why = "network"; }
  else if (level !== null && !charging && level < 0.15) { seed = 0; why = "battery"; }
  else if (e.hidden) { seed = 1; why = "background"; }
  else if ((level !== null && !charging && level < 0.3) || effective === "3g") { seed = 1; why = level !== null && level < 0.3 ? "battery" : "slow"; }
  else if (f.unmetered && (charging || f.desktop)) { seed = 3; why = "wifi-power"; }
  const caps = [0, 5 * MB, 20 * MB, 40 * MB];
  return {
    seed: seed,
    why: why,
    uploadCap: caps[seed],
    maxPeers: [0, 2, 3, 4][seed] || (e.rescue ? 2 : 0),
    prefetch: seed >= 2 && !e.hidden && !f.saveData
  };
}

/* ---------- cache policy ---------- */

/* Higher keeps longer: peers asking for it counts as much as recent use. */
export function keepWeight(entry, now) {
  const ageMin = Math.max(0, ((Number(now) || Date.now()) - (Number(entry.last) || 0)) / 60000);
  return (1 + Math.log2(1 + (Number(entry.asks) || 0))) / (1 + ageMin / 30);
}

/* Hashes to evict, worst first, until `need` bytes fit under `cap`. */
export function evictList(entries, used, need, cap, now) {
  const list = entries.slice().sort((a, b) => keepWeight(a, now) - keepWeight(b, now));
  const out = [];
  let total = used;
  for (const e of list) {
    if (total + need <= cap) break;
    out.push(e.h);
    total -= e.size;
  }
  return out;
}

/* Memory store size from the storage estimate: 2% of what is free, kept
   between 4 and 32 MB. Unknown quota keeps the 16 MB default. */
export function storeCap(estimate, fallback) {
  const def = fallback || 16 * MB;
  if (!estimate || !Number(estimate.quota)) return def;
  const free = Math.max(0, Number(estimate.quota) - (Number(estimate.usage) || 0));
  return Math.max(4 * MB, Math.min(32 * MB, Math.floor(free * 0.02)));
}

/* ---------- seeding ---------- */

/* Items fewest peers hold go first; duplicates by content id collapse. */
export function rarestFirst(items, haves) {
  const seen = new Set();
  const count = (h) => { let n = 0; haves.forEach((set) => { if (set && set.has(h)) n += 1; }); return n; };
  return items.filter((it) => (seen.has(it.h) ? false : seen.add(it.h)))
    .map((it) => ({ it, n: count(it.h) }))
    .sort((a, b) => a.n - b.n)
    .map((x) => x.it);
}

/* True the first time this peer asks for this chunk of this item. */
export function firstSend(sent, h, o) {
  const key = h + ":" + o;
  if (sent.has(key)) return false;
  sent.add(key);
  if (sent.size > 4096) sent.delete(sent.values().next().value);
  return true;
}
