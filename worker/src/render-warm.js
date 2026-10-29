/* Keeps the free Render backup awake so failover never waits on a cold start.

   Render puts a free web service to sleep after 15 minutes without inbound
   traffic, and waking it takes 30 to 60 seconds. That wait is what users saw
   as "the backup fails sometimes": the first requests during a Worker hiccup
   hung or timed out. GitHub's scheduled warm-up workflow only runs every few
   hours in practice, so this Worker cron ping (every 10 minutes) replaces it.

   Budget: the free workspace gets 750 instance hours a month. Awake around
   the clock is ~744 hours, too close once redeploys overlap. The ping skips
   four quiet hours (21:00-00:59 UTC = 00:00-03:59 Moscow, 02:30-06:29 India),
   so warm time is ~620 hours a month. A visitor in the quiet hours still
   wakes it; the client never waits on that (see accounts.js wakeBackup).

   The ping hits /backup/health, which the backup answers itself without a
   D1 or R2 call. RENDER_WARM = "0" turns the ping off. BACKUP_HEALTH_URL
   points it at another backup host. RENDER_WARM_QUIET_UTC overrides the
   quiet hours, as a comma list of UTC hours. */

export const RENDER_BACKUP = "https://viktorych-backup.onrender.com";
export const WARM_EVERY_MIN = 10;
export const QUIET_HOURS_UTC = [21, 22, 23, 0];

function quietHours(env) {
  const raw = String((env && env.RENDER_WARM_QUIET_UTC) || "").trim();
  if (!raw) return QUIET_HOURS_UTC;
  if (raw === "none") return [];
  return raw.split(",").map((item) => Number(item.trim())).filter((hour) => Number.isInteger(hour) && hour >= 0 && hour < 24);
}

export function warmDue(env, at) {
  if (env && String(env.RENDER_WARM || "1") === "0") return false;
  const when = new Date(Number(at) || Date.now());
  if (when.getUTCMinutes() % WARM_EVERY_MIN !== 5) return false;
  return !quietHours(env).includes(when.getUTCHours());
}

export async function warmRender(env, at, deps) {
  if (!warmDue(env, at)) return { skipped: true };
  const doFetch = (deps && deps.fetch) || fetch;
  const root = String((env && env.BACKUP_HEALTH_URL) || RENDER_BACKUP).replace(/\/(v1\/health)?$/, "").replace(/\/$/, "");
  const started = Date.now();
  try {
    const res = await doFetch(root + "/backup/health", {
      headers: { "user-agent": "viktorych-worker-warm" },
      // A cold start can take a minute; the ping itself is what wakes it.
      signal: AbortSignal.timeout(55000)
    });
    const ok = res.ok;
    if (res.body) await res.body.cancel().catch(() => {});
    return { ok, status: res.status, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - started };
  }
}
