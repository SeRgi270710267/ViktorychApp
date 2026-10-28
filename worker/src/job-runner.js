/* Background cron jobs can run on the Render backup instead of the Worker.
   While Render is awake it claims the jobs below every minute; the Worker
   cron skips whatever was claimed in the last FRESH_MS. When Render sleeps
   (free plan) the claim goes stale and the Worker picks the jobs back up on
   its own, so nothing ever stops running. */

// Heavy, not latency critical, and need nothing Render lacks (no push keys,
// no Durable Objects, no deletion secrets).
export const OFFLOAD_JOBS = ["ownerFeeds", "tiktokLive", "storiesSweep", "birthdays", "birthdayPoints"];
export const FRESH_MS = 150000;
const RUNNER_ID = "render";

export function isRunner(env) {
  return !!(env && env.JOB_RUNNER);
}

/* Names of jobs Render runs right now; empty when it is asleep or unknown. */
export async function claimedJobs(env, at) {
  if (!env || !env.DB || isRunner(env)) return new Set();
  try {
    const row = await env.DB.prepare("SELECT jobs, seen_at FROM job_runner WHERE id = ?").bind(RUNNER_ID).first();
    if (!row || (Number(at) || Date.now()) - Number(row.seen_at || 0) > FRESH_MS) return new Set();
    return new Set(String(row.jobs || "").split(",").filter((name) => OFFLOAD_JOBS.includes(name)));
  } catch (err) {
    return new Set();
  }
}

export async function claimJobs(env, at, jobs) {
  const list = (jobs || OFFLOAD_JOBS).filter((name) => OFFLOAD_JOBS.includes(name));
  await env.DB.prepare(
    "INSERT INTO job_runner (id, jobs, seen_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET jobs = excluded.jobs, seen_at = excluded.seen_at"
  ).bind(RUNNER_ID, list.join(","), Number(at) || Date.now()).run();
  return list;
}

/* Wider pools on Render, which has no per-invocation subrequest cap. */
export function poolWidth(env, base) {
  return isRunner(env) ? base * 2 : base;
}
