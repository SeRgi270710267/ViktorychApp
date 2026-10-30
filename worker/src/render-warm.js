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
   D1 or R2 call. The backup counts its own awake time in R2
   (ops/render-hours/<month>.json); from 90% of the 750 hours the ping
   stops until the 1st, so Render never suspends the backup for going over.
   RENDER_WARM = "0" turns the ping off. BACKUP_HEALTH_URL
   points it at another backup host. RENDER_WARM_QUIET_UTC overrides the
   quiet hours, as a comma list of UTC hours. */

export const RENDER_BACKUP = "https://viktorych-backup.onrender.com";
export const WARM_EVERY_MIN = 10;
export const QUIET_HOURS_UTC = [21, 22, 23, 0];

export const RENDER_HOURS_KEY = "ops/render-hours/";
export const RENDER_FREE_HOURS = 750;
export const RENDER_HOURS_PAUSE_PCT = 90;

/* The month's awake hours as the backup counted them, or null before the
   backup has saved any. Paused means: stop waking it until resetAt. */
export function renderHoursReport(at, ms, env) {
  const now = Number(at) || Date.now();
  const d = new Date(now);
  const free = Number(env && env.RENDER_FREE_HOURS) || RENDER_FREE_HOURS;
  const pausePct = Number(env && env.RENDER_HOURS_PAUSE_PCT) || RENDER_HOURS_PAUSE_PCT;
  const used = Math.round((Math.max(0, Number(ms) || 0) / 36e5) * 10) / 10;
  const pct = Math.min(100, Math.round(used * 100 / free));
  return {
    month: new Date(now).toISOString().slice(0, 7),
    used,
    free,
    left: Math.max(0, Math.round((free - used) * 10) / 10),
    pct,
    paused: pct >= pausePct,
    resetAt: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString()
  };
}

export async function renderHours(env, at) {
  if (!env || !env.DATA) return null;
  const now = Number(at) || Date.now();
  try {
    const object = await env.DATA.get(RENDER_HOURS_KEY + new Date(now).toISOString().slice(0, 7) + ".json");
    const row = object ? await object.json() : null;
    if (!row || !(Number(row.ms) >= 0)) return null;
    return Object.assign(renderHoursReport(now, row.ms, env), { savedAt: Number(row.at) || 0 });
  } catch (err) {
    return null;
  }
}

export function quietHours(env) {
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
  const hours = await renderHours(env, at);
  if (hours && hours.paused) return { skipped: true, paused: true };
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
