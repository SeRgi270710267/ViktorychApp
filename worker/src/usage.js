/* Owner-only usage against the free limits.

   GET /v1/owner/usage reads Cloudflare's GraphQL analytics with a read-only
   token kept as Worker secrets (CF_ANALYTICS_TOKEN, CF_ACCOUNT_ID). Without
   them it still answers with the limits and configured:false, so the panel
   can say what is missing. The answer is kept in memory for five minutes so
   an open panel costs one analytics read per isolate per five minutes. */

import { renderHours } from "./render-warm.js";

export const FREE_LIMITS = {
  workerRequestsDay: 100000,
  d1RowsReadDay: 5000000,
  d1RowsWrittenDay: 100000,
  durableRequestsDay: 100000,
  r2ClassAMonth: 1000000,
  r2ClassBMonth: 10000000,
  renderHoursMonth: 750
};

let memo = null;
let memoAt = 0;

function day(ms) { return new Date(ms).toISOString().slice(0, 10); }

async function graphql(env, query, variables) {
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: "Bearer " + env.CF_ANALYTICS_TOKEN },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error("analytics " + res.status);
  const body = await res.json();
  if (body.errors && body.errors.length) throw new Error("analytics query");
  return body.data;
}

const QUERY = `query U($acc: String!, $since: Date!, $today: Date!, $start: Time!, $end: Time!, $month: Date!) {
  viewer { accounts(filter: { accountTag: $acc }) {
    week: workersInvocationsAdaptive(limit: 100, filter: { date_geq: $since }) { sum { requests errors subrequests } dimensions { date } }
    d1: d1AnalyticsAdaptiveGroups(limit: 10, filter: { date_geq: $today }) { sum { rowsRead rowsWritten } }
    durable: durableObjectsInvocationsAdaptiveGroups(limit: 10, filter: { datetime_geq: $start, datetime_lt: $end }) { sum { requests } }
    r2: r2OperationsAdaptiveGroups(limit: 100, filter: { date_geq: $month }) { sum { requests } dimensions { actionType } }
  } }
}`;

const CLASS_A = /^(ListBuckets|PutBucket|ListObjects|PutObject|CopyObject|CompleteMultipartUpload|CreateMultipartUpload|LifecycleStorageTierTransition|ListMultipartUploads|UploadPart|UploadPartCopy|ListParts|PutBucketEncryption|PutBucketCors|PutBucketLifecycleConfiguration)$/;

export function renderHoursCeiling(now) {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return Math.round((now - start) / 36e5);
}

/* Render's free allowance, as the backup counted its own awake time. Null
   until the backup has saved a reading this month. */
export async function usageReport(env, now) {
  const at = Number(now) || Date.now();
  if (memo && at - memoAt < 5 * 60 * 1000) return memo;
  const out = {
    configured: !!(env.CF_ANALYTICS_TOKEN && env.CF_ACCOUNT_ID),
    at: at,
    limits: FREE_LIMITS,
    renderHoursCeiling: renderHoursCeiling(at),
    renderHours: await renderHours(env, at)
  };
  if (out.configured) {
    const today = day(at);
    const since = day(at - 6 * 864e5);
    const d = new Date(at);
    const month = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
    try {
      const data = await graphql(env, QUERY, { acc: env.CF_ACCOUNT_ID, since, today, start: today + "T00:00:00Z", end: new Date(at).toISOString(), month });
      const acc = data && data.viewer && data.viewer.accounts && data.viewer.accounts[0] || {};
      const byDay = {};
      (acc.week || []).forEach((row) => {
        const key = row.dimensions && row.dimensions.date;
        if (!key) return;
        byDay[key] = (byDay[key] || 0) + Number(row.sum && row.sum.requests || 0);
      });
      out.week = Object.keys(byDay).sort().map((key) => ({ date: key, requests: byDay[key] }));
      out.workerRequestsToday = byDay[today] || 0;
      out.d1RowsReadToday = (acc.d1 || []).reduce((n, r) => n + Number(r.sum && r.sum.rowsRead || 0), 0);
      out.d1RowsWrittenToday = (acc.d1 || []).reduce((n, r) => n + Number(r.sum && r.sum.rowsWritten || 0), 0);
      out.durableRequestsToday = (acc.durable || []).reduce((n, r) => n + Number(r.sum && r.sum.requests || 0), 0);
      let a = 0, b = 0;
      (acc.r2 || []).forEach((r) => {
        const n = Number(r.sum && r.sum.requests || 0);
        if (CLASS_A.test(String(r.dimensions && r.dimensions.actionType || ""))) a += n; else b += n;
      });
      out.r2ClassAMonth = a;
      out.r2ClassBMonth = b;
    } catch (err) {
      out.error = "analytics_unavailable";
    }
  }
  memo = out;
  memoAt = at;
  return out;
}
