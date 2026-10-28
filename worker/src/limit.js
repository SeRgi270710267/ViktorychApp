/* Runs fn over items with at most `limit` in flight. Errors from one item do
   not stop the others; each caller already handles its own failures. */
export async function eachLimit(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  const width = Math.max(1, Math.min(Number(limit) || 1, list.length));
  let next = 0;
  async function lane() {
    while (next < list.length) {
      const index = next;
      next += 1;
      try { await fn(list[index], index); }
      catch (err) { /* the next cron pass retries this item */ }
    }
  }
  const lanes = [];
  for (let i = 0; i < width; i++) lanes.push(lane());
  await Promise.all(lanes);
}
