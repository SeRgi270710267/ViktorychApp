/* Community Notes bridging scorer, after the open-source X scorer
   (github.com/twitter/communitynotes, "matrix factorization" model).

   Every rating is modelled as
       rating ≈ mu + rater_intercept + note_intercept + rater_factor · note_factor
   with a one-dimensional factor. The factor soaks up agreement that comes
   from a shared viewpoint, so a note only earns a high intercept when people
   who usually disagree both found it helpful. Ratings: helpful 1,
   somewhat helpful 0.5, not helpful 0.

   Fitting is weighted alternating least squares with L2 penalties, the same
   regularisation shape as X (intercepts are penalised 5x harder than the
   factors). It is deterministic, so the same ratings always give the same
   statuses, and it runs on a schedule, never per request.

   Small communities: with too few raters the factor cannot be learned, so a
   simple fallback decides (a clear majority from at least MIN raters), and a
   note found helpful only by raters on one side of the factor axis still
   waits for more ratings when the factor is known. */

export const THRESHOLDS = Object.freeze({
  crhIntercept: 0.40,      // note intercept at or above this: Helpful (shown)
  crhMaxFactor: 0.50,      // ... and |note factor| below this (not one-sided)
  crnhIntercept: -0.05,    // below -0.05 - crnhFactorSlope * |factor|: Not helpful
  crnhFactorSlope: 0.8,
  minRatings: 5,           // X needs 5 ratings before a note leaves Needs more ratings
  lambdaFactor: 0.03,
  lambdaIntercept: 0.15,
  iterations: 40,
  // Below these sizes the model is not trusted and the fallback decides.
  modelMinRaters: 10,
  modelMinRatings: 40,
  fallbackMinRatings: 3,
  fallbackHelpful: 0.8,
  fallbackNotHelpful: 0.25
});

export const LEVELS = Object.freeze({ helpful: 1, somewhat: 0.5, not: 0 });

function seeded(id) {
  // Small deterministic start for a factor so runs are repeatable.
  let h = 2166136261;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (((h >>> 0) % 2001) / 1000 - 1) * 0.1;
}

/* 2x2 ridge solve for [b, f] minimising sum w (y - b - f x)^2 + lb b^2 + lf f^2. */
function solve2(rows, lb, lf) {
  let sw = 0, sx = 0, sxx = 0, sy = 0, sxy = 0;
  for (const r of rows) { sw += r.w; sx += r.w * r.x; sxx += r.w * r.x * r.x; sy += r.w * r.y; sxy += r.w * r.x * r.y; }
  const a = sw + lb, b = sx, c = sx, d = sxx + lf;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return [sy / (sw + lb || 1), 0];
  return [(d * sy - b * sxy) / det, (a * sxy - c * sy) / det];
}

/* ratings: [{ rater, note, v (0..1), w (weight, default 1) }] */
export function fitModel(ratings, opts) {
  const o = Object.assign({}, THRESHOLDS, opts || {});
  const list = (ratings || []).filter((r) => r && r.rater && r.note && Number.isFinite(Number(r.v))).map((r) => ({ u: String(r.rater), n: String(r.note), v: Number(r.v), w: r.w == null ? 1 : Math.max(0, Number(r.w)) }));
  const byNote = new Map(), byUser = new Map();
  for (const r of list) {
    if (!byNote.has(r.n)) byNote.set(r.n, []);
    if (!byUser.has(r.u)) byUser.set(r.u, []);
    byNote.get(r.n).push(r);
    byUser.get(r.u).push(r);
  }
  const ub = new Map(), uf = new Map(), nb = new Map(), nf = new Map();
  for (const u of byUser.keys()) { ub.set(u, 0); uf.set(u, seeded("u" + u)); }
  for (const n of byNote.keys()) { nb.set(n, 0); nf.set(n, seeded("n" + n)); }
  let mu = 0;
  const sw = list.reduce((s, r) => s + r.w, 0);
  if (sw > 0) mu = list.reduce((s, r) => s + r.w * r.v, 0) / sw;
  const L = sw > 0 ? 1 : 0;
  for (let it = 0; it < o.iterations; it++) {
    // Notes given raters.
    for (const [n, rs] of byNote) {
      const rows = rs.map((r) => ({ w: r.w, x: uf.get(r.u), y: r.v - mu - ub.get(r.u) }));
      const [b, f] = solve2(rows, o.lambdaIntercept * L, o.lambdaFactor * L);
      nb.set(n, b); nf.set(n, f);
    }
    // Raters given notes.
    for (const [u, rs] of byUser) {
      const rows = rs.map((r) => ({ w: r.w, x: nf.get(r.n), y: r.v - mu - nb.get(r.n) }));
      const [b, f] = solve2(rows, o.lambdaIntercept * L, o.lambdaFactor * L);
      ub.set(u, b); uf.set(u, f);
    }
    // Global mean given everything else.
    if (sw > 0) {
      let s = 0;
      for (const r of list) s += r.w * (r.v - ub.get(r.u) - nb.get(r.n) - uf.get(r.u) * nf.get(r.n));
      mu = s / sw;
    }
  }
  // Fix the sign of the factor axis so results are stable: the rater with the
  // most ratings sits on the positive side.
  let anchor = null, most = -1;
  for (const [u, rs] of byUser) if (rs.length > most || (rs.length === most && u < anchor)) { most = rs.length; anchor = u; }
  if (anchor && uf.get(anchor) < 0) {
    for (const u of uf.keys()) uf.set(u, -uf.get(u));
    for (const n of nf.keys()) nf.set(n, -nf.get(n));
  }
  return { mu, byNote, byUser, ub, uf, nb, nf };
}

export function statusFor(intercept, factor, count, o) {
  o = o || THRESHOLDS;
  if (count < o.minRatings) return "nmr";
  if (intercept >= o.crhIntercept && Math.abs(factor) < o.crhMaxFactor) return "crh";
  if (intercept < o.crnhIntercept - o.crnhFactorSlope * Math.abs(factor)) return "crnh";
  return "nmr";
}

function fallbackStatus(rs, o) {
  const w = rs.reduce((s, r) => s + r.w, 0);
  const raters = new Set(rs.map((r) => r.u)).size;
  if (raters < o.fallbackMinRatings || w <= 0) return "nmr";
  const mean = rs.reduce((s, r) => s + r.w * r.v, 0) / w;
  if (mean >= o.fallbackHelpful) return "crh";
  if (mean <= o.fallbackNotHelpful) return "crnh";
  return "nmr";
}

/* Returns { method, notes: { id: { status, intercept, factor, n } }, raters: { id: { factor, intercept } } } */
export function scoreNotes(ratings, opts) {
  const o = Object.assign({}, THRESHOLDS, opts || {});
  const m = fitModel(ratings, o);
  const raterCount = m.byUser.size;
  const ratingCount = Array.from(m.byNote.values()).reduce((s, rs) => s + rs.length, 0);
  const useModel = raterCount >= o.modelMinRaters && ratingCount >= o.modelMinRatings;
  const notes = {};
  for (const [n, rs] of m.byNote) {
    const intercept = m.nb.get(n), factor = m.nf.get(n);
    let status;
    if (useModel) {
      status = statusFor(intercept, factor, rs.length, o);
    } else {
      status = fallbackStatus(rs, o);
      // Even in the fallback, a "helpful" that only one side gave waits, once
      // there are raters on both sides of the axis to ask.
      if (status === "crh") {
        const helpfulSides = new Set(rs.filter((r) => r.v >= 0.5).map((r) => Math.sign(m.uf.get(r.u)) || 1));
        const allSides = new Set(Array.from(m.uf.values()).map((f) => Math.sign(f) || 1));
        if (allSides.size > 1 && helpfulSides.size < 2 && raterCount >= 4) status = "nmr";
      }
    }
    notes[n] = { status, intercept: round(intercept), factor: round(factor), n: rs.length };
  }
  const raters = {};
  for (const u of m.byUser.keys()) raters[u] = { factor: round(m.uf.get(u)), intercept: round(m.ub.get(u)) };
  return { method: useModel ? "mf" : "fallback", mu: round(m.mu), notes, raters };
}

function round(x) { return Math.round(Number(x || 0) * 10000) / 10000; }

/* Rating impact, like X: +1 for a rating that agreed with a note's final
   Helpful or Not helpful status, -1 for one that went against it. Notes
   still needing ratings do not count. */
export function ratingImpact(ratings, statuses) {
  const out = {};
  for (const r of ratings || []) {
    const st = statuses[r.note];
    if (st !== "crh" && st !== "crnh") continue;
    const v = Number(r.v);
    let d = 0;
    if (st === "crh") d = v >= 1 ? 1 : v <= 0 ? -1 : 0;
    else d = v <= 0 ? 1 : v >= 1 ? -1 : 0;
    out[r.rater] = (out[r.rater] || 0) + d;
  }
  return out;
}

/* Brigading: many young accounts rating the same note the same way within a
   short window get down-weighted. Input rows carry { rater, note, v, at, age }
   (age = account age in ms at rating time). Returns a weight per row. */
export function brigadeWeights(rows, opts) {
  const o = Object.assign({ youngMs: 14 * 86400000, windowMs: 3600000, burst: 4, youngWeight: 0.5, burstWeight: 0.15 }, opts || {});
  const weights = rows.map((r) => (Number(r.age) < o.youngMs ? o.youngWeight : 1));
  const groups = new Map();
  rows.forEach((r, i) => {
    if (!(Number(r.age) < o.youngMs)) return;
    const k = r.note + "|" + r.v;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  });
  for (const idx of groups.values()) {
    idx.sort((a, b) => rows[a].at - rows[b].at);
    let s = 0;
    for (let e = 0; e < idx.length; e++) {
      while (rows[idx[e]].at - rows[idx[s]].at > o.windowMs) s++;
      if (e - s + 1 >= o.burst) for (let k = s; k <= e; k++) weights[idx[k]] = Math.min(weights[idx[k]], o.burstWeight);
    }
  }
  return weights;
}

/* Owner final say: the owner's choice always wins over the algorithm.
   override: "show" | "hide" | "" ; locked keeps the status it had when the
   lock was set. A deleted note, a banned author or a post with notes turned
   off shows nothing unless the owner forced it shown. */
export function effectiveStatus(note) {
  if (!note || note.deleted) return "deleted";
  if (note.override === "show") return "crh";
  if (note.override === "hide") return "hidden";
  if (note.postBlocked) return "hidden";
  if (note.authorBanned) return "hidden";
  if (note.locked && note.lockedStatus) return note.lockedStatus;
  return note.algoStatus || "nmr";
}
