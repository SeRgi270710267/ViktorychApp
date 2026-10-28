/* Merit badges. The Worker is the only place that awards a tier.
   The page can draw progress. It cannot claim one. */

export const EARLY_BEFORE = Date.parse("2026-10-28T00:00:00Z");

export const CATALOG = [
  { id: "member", metric: "ageDays", steps: [7, 30, 365], points: [0, 0, 5] },
  { id: "streak", metric: "loginStreak", steps: [3, 7, 30], points: [0, 2, 5] },
  { id: "author", metric: "posts", steps: [1, 10, 50], points: [0, 0, 5] },
  { id: "voice", metric: "comments", steps: [1, 25, 100], points: [0, 0, 0] },
  { id: "signal", metric: "reposts", steps: [1, 10, 40], points: [0, 0, 0] },
  { id: "circle", metric: "followers", steps: [1, 10, 100], points: [0, 0, 5] },
  { id: "giver", metric: "giftsSent", steps: [1, 5, 20], points: [0, 0, 0] },
  { id: "kept", metric: "giftsReceived", steps: [1, 5, 20], points: [0, 0, 0] },
  { id: "story", metric: "stories", steps: [1, 5, 20], points: [0, 0, 0] },
  { id: "highlight", metric: "highlights", steps: [1, 3, 10], points: [0, 0, 0] },
  { id: "live", metric: "lives", steps: [1, 5, 20], points: [0, 5, 10] },
  { id: "early", metric: "early", steps: [1, 1, 1], points: [0, 0, 5], flat: "gold" },
  { id: "helpful", metric: "reports", steps: [1, 3, 10], points: [1, 2, 5] }
];

const ORDER = ["bronze", "silver", "gold"];

export function badgeById(id) {
  return CATALOG.find((item) => item.id === id) || null;
}

export function tierRank(tier) {
  const at = ORDER.indexOf(String(tier || ""));
  return at < 0 ? 0 : at + 1;
}

export function tierFor(def, value) {
  const n = Number(value) || 0;
  if (!def) return "";
  if (def.flat) return n >= (def.steps[0] || 1) ? def.flat : "";
  if (n >= def.steps[2]) return "gold";
  if (n >= def.steps[1]) return "silver";
  if (n >= def.steps[0]) return "bronze";
  return "";
}

export function crossedTiers(prev, next, flat) {
  if (!next) return [];
  if (flat) return tierRank(prev) >= tierRank(next) ? [] : [next];
  const from = tierRank(prev);
  const to = tierRank(next);
  if (to <= from) return [];
  return ORDER.slice(from, to);
}

export function nextStep(def, value) {
  const n = Number(value) || 0;
  if (!def) return null;
  if (def.flat) return n >= (def.steps[0] || 1) ? null : { tier: "gold", goal: def.steps[0] || 1 };
  if (n >= def.steps[2]) return null;
  if (n >= def.steps[1]) return { tier: "gold", goal: def.steps[2] };
  if (n >= def.steps[0]) return { tier: "silver", goal: def.steps[1] };
  return { tier: "bronze", goal: def.steps[0] };
}

export function progressRatio(def, value) {
  const next = nextStep(def, value);
  if (!next) return 1;
  const n = Number(value) || 0;
  let floor = 0;
  if (!def.flat && next.tier === "silver") floor = def.steps[0];
  if (!def.flat && next.tier === "gold") floor = def.steps[1];
  const span = Math.max(1, next.goal - floor);
  return Math.max(0, Math.min(1, (n - floor) / span));
}
