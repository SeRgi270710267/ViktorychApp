/* Packages: a private package tracker per account.

   Rows live in D1 (packages), one per tracking number and account; nothing
   about them is in the repo. The Worker reads carriers' official APIs with
   keys kept as Worker secrets, so the app never holds a key:
     PostNord  POSTNORD_API_KEY                (developer.postnord.com)
     DHL       DHL_API_KEY                     (developer.dhl.com, Shipment Tracking - Unified)
     Bring     BRING_API_UID + BRING_API_KEY   (developer.bring.com, Mybring login e-mail + API key)
     UPS       UPS_CLIENT_ID + UPS_CLIENT_SECRET   (developer.ups.com, Tracking API)
     FedEx     FEDEX_CLIENT_ID + FEDEX_CLIENT_SECRET (developer.fedex.com, Track API)
     Почта     POCHTA_LOGIN + POCHTA_PASSWORD  (tracking.pochta.ru, API access)
   Carriers without a public API (or without a key yet) still get a row,
   carrier detection and a link to the carrier's official tracking page.
   The cron re-reads open packages with a growing interval and notifies the
   owner (in-app and web push) when the status changes. */

import { CARRIERS, carrierById, cleanNumber, detectCarriers, trackingUrl, STATUSES } from "../../shared/packages-carriers.js";

export const PACKAGES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS packages (
    id TEXT PRIMARY KEY,
    public_id TEXT NOT NULL,
    number TEXT NOT NULL,
    carrier TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    status_text TEXT NOT NULL DEFAULT '',
    eta TEXT NOT NULL DEFAULT '',
    events TEXT NOT NULL DEFAULT '[]',
    archived INTEGER NOT NULL DEFAULT 0,
    fails INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    changed_at INTEGER NOT NULL DEFAULT 0,
    checked_at INTEGER NOT NULL DEFAULT 0,
    next_check_at INTEGER NOT NULL DEFAULT 0
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS packages_owner_number ON packages(public_id, number)",
  "CREATE INDEX IF NOT EXISTS packages_owner ON packages(public_id, updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS packages_due ON packages(archived, next_check_at)"
];

const MAX_PER_USER = 100;
const MIN_GAP = 30 * 60 * 1000;
const MAX_GAP = 12 * 3600 * 1000;
const MANUAL_GAP = 60 * 1000;
const CRON_BATCH = 8;

/* ---------- carrier adapters ---------- */

function place(...parts) { return parts.map((p) => String(p || "").trim()).filter(Boolean).join(", ").slice(0, 120); }
function iso(value) { const ms = Date.parse(String(value || "")); return Number.isFinite(ms) ? new Date(ms).toISOString() : ""; }
function clip(text, n) { return String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, n || 200); }

export function keyed(env, api) {
  if (!env) return false;
  if (api === "postnord") return !!env.POSTNORD_API_KEY;
  if (api === "dhl") return !!env.DHL_API_KEY;
  if (api === "bring") return !!(env.BRING_API_UID && env.BRING_API_KEY);
  if (api === "ups") return !!(env.UPS_CLIENT_ID && env.UPS_CLIENT_SECRET);
  if (api === "fedex") return !!(env.FEDEX_CLIENT_ID && env.FEDEX_CLIENT_SECRET);
  if (api === "pochta") return !!(env.POCHTA_LOGIN && env.POCHTA_PASSWORD);
  return false;
}

async function getJson(fetcher, url, init) {
  const res = await fetcher(url, init || {});
  if (res && res.status === 404) return { notFound: true };
  if (!res || !res.ok) throw new Error("carrier_http_" + (res ? res.status : 0));
  return res.json();
}

export function fromPostnord(doc) {
  const ship = doc && doc.TrackingInformationResponse && (doc.TrackingInformationResponse.shipments || [])[0];
  if (!ship) return null;
  const events = [];
  (ship.items || []).forEach((item) => (item.events || []).forEach((e) => events.push({
    at: iso(e.eventTime), text: clip(e.eventDescription), place: place(e.location && (e.location.displayName || e.location.name), e.location && e.location.countryCode), code: clip(e.status, 40)
  })));
  const s = String(ship.status || "").toUpperCase();
  const last = events.slice().sort((a, b) => (b.at > a.at ? 1 : -1))[0];
  let status = "in_transit";
  if (s === "DELIVERED") status = "delivered";
  else if (s === "AVAILABLE_FOR_DELIVERY") status = "ready_for_pickup";
  else if (s === "CREATED" || s === "INFORMED") status = "pending";
  else if (/IMPOSSIBLE|REFUSED|RETURNED|STOPPED|DELAYED/.test(s)) status = "problem";
  if (status === "in_transit" && last && /out for delivery|ute för leverans|levereras idag/i.test(last.text)) status = "out_for_delivery";
  const text = ship.statusText && (ship.statusText.header || ship.statusText.body);
  return { status, statusText: clip(text || (last && last.text)), eta: iso(ship.estimatedTimeOfArrival || (ship.statusText && ship.statusText.estimatedTimeOfArrival) || ship.deliveryDate), events };
}

export function fromDhl(doc) {
  const ship = doc && (doc.shipments || [])[0];
  if (!ship) return null;
  const addr = (e) => (e && e.location && e.location.address) || {};
  const events = (ship.events || []).map((e) => ({ at: iso(e.timestamp), text: clip(e.description || e.status), place: place(addr(e).addressLocality, addr(e).countryCode), code: clip(e.statusCode, 40) }));
  const st = ship.status || {};
  const code = String(st.statusCode || "").toLowerCase();
  let status = code === "delivered" ? "delivered" : code === "failure" ? "problem" : code === "pre-transit" ? "pending" : "in_transit";
  const desc = String(st.description || st.status || "");
  if (status === "in_transit" && /out for delivery|with delivery courier|ute för utdelning/i.test(desc)) status = "out_for_delivery";
  if (status === "in_transit" && /service ?point|pick ?up|ombud|utlämningsställe/i.test(desc) && /ready|available|arrived|kan hämtas|finns att hämta/i.test(desc)) status = "ready_for_pickup";
  return { status, statusText: clip(desc), eta: iso(ship.estimatedTimeOfDelivery), events };
}

export function fromBring(doc) {
  const pkg = doc && doc.consignmentSet && doc.consignmentSet[0] && (doc.consignmentSet[0].packageSet || [])[0];
  if (!pkg) return null;
  const events = (pkg.eventSet || []).map((e) => ({ at: iso(e.dateIso), text: clip(e.description), place: place(e.city, e.countryCode), code: clip(e.status, 40) }));
  const s = String((pkg.eventSet && pkg.eventSet[0] && pkg.eventSet[0].status) || "").toUpperCase();
  let status = "in_transit";
  if (s === "DELIVERED" || s === "DELIVERED_SENDER") status = "delivered";
  else if (s === "READY_FOR_PICKUP") status = "ready_for_pickup";
  else if (s === "TRANSPORT_TO_RECIPIENT") status = "out_for_delivery";
  else if (s === "PRE_NOTIFIED" || s === "NOTIFICATION_SENT") status = "pending";
  else if (/DEVIATION|RETURN|CUSTOMS/.test(s)) status = "problem";
  return { status, statusText: events[0] ? events[0].text : "", eta: iso(pkg.dateOfEstimatedDelivery), events };
}

export function fromUps(doc) {
  const pkg = doc && doc.trackResponse && doc.trackResponse.shipment && doc.trackResponse.shipment[0] && (doc.trackResponse.shipment[0].package || [])[0];
  if (!pkg) return null;
  const when = (d, t) => { const ds = String(d || ""), ts = String(t || "000000").padStart(6, "0"); return ds.length === 8 ? ds.slice(0, 4) + "-" + ds.slice(4, 6) + "-" + ds.slice(6) + "T" + ts.slice(0, 2) + ":" + ts.slice(2, 4) + ":" + ts.slice(4, 6) + "Z" : ""; };
  const events = (pkg.activity || []).map((a) => {
    const ad = (a.location && a.location.address) || {};
    return { at: when(a.date, a.time), text: clip(a.status && a.status.description), place: place(ad.city, ad.countryCode), code: clip(a.status && a.status.type, 8) };
  });
  const cur = pkg.currentStatus || (pkg.activity && pkg.activity[0] && pkg.activity[0].status) || {};
  const type = String((pkg.activity && pkg.activity[0] && pkg.activity[0].status && pkg.activity[0].status.type) || "").toUpperCase();
  const desc = String(cur.description || "");
  let status = type === "D" ? "delivered" : type === "X" ? "problem" : type === "M" || type === "P" ? "pending" : "in_transit";
  if (/out for delivery/i.test(desc)) status = "out_for_delivery";
  if (/access point|ready for pickup/i.test(desc) && status !== "delivered") status = "ready_for_pickup";
  const est = (pkg.deliveryDate || []).find((d) => d && d.type !== "DEL") || null;
  return { status, statusText: clip(desc), eta: est ? when(est.date, "120000") : "", events };
}

export function fromFedex(doc) {
  const res = doc && doc.output && doc.output.completeTrackResults && doc.output.completeTrackResults[0] && (doc.output.completeTrackResults[0].trackResults || [])[0];
  if (!res || (res.error && !res.latestStatusDetail)) return null;
  const events = (res.scanEvents || []).map((e) => ({ at: iso(e.date), text: clip(e.eventDescription), place: place(e.scanLocation && e.scanLocation.city, e.scanLocation && e.scanLocation.countryCode), code: clip(e.derivedStatusCode || e.eventType, 8) }));
  const st = res.latestStatusDetail || {};
  const code = String(st.code || st.derivedCode || "").toUpperCase();
  let status = code === "DL" ? "delivered" : code === "OD" ? "out_for_delivery" : code === "DE" || code === "CA" || code === "SE" || code === "RS" ? "problem" : code === "OC" || code === "PU" ? "pending" : "in_transit";
  if (/ready for (?:recipient )?pickup|at fedex location/i.test(String(st.description || "")) && status !== "delivered") status = "ready_for_pickup";
  const eta = (res.dateAndTimes || []).find((d) => d && /ESTIMATED_DELIVERY/.test(d.type)) || null;
  const win = res.estimatedDeliveryTimeWindow && res.estimatedDeliveryTimeWindow.window;
  return { status, statusText: clip(st.description), eta: iso((eta && eta.dateTime) || (win && (win.ends || win.begins))), events };
}

function tag(xml, name) {
  const m = new RegExp("<(?:\\w+:)?" + name + "\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?" + name + ">").exec(xml);
  return m ? m[1] : "";
}

export function fromPochta(xml) {
  const text = String(xml || "");
  if (/Fault>/.test(text) && !/historyRecord/.test(text)) return null;
  const records = text.split(/<(?:\w+:)?historyRecord\b/).slice(1);
  if (!records.length) return null;
  const events = records.map((r) => {
    const oper = tag(r, "OperationParameters");
    const addr = tag(tag(r, "AddressParameters"), "OperationAddress");
    return { at: iso(tag(oper, "OperDate")), text: clip(tag(tag(oper, "OperAttr"), "Name") || tag(tag(oper, "OperType"), "Name")), place: clip(tag(addr, "Description"), 120), code: clip(tag(tag(oper, "OperType"), "Id") + ":" + tag(tag(oper, "OperAttr"), "Id"), 12) };
  });
  const last = events[events.length - 1];
  const [type, attr] = String(last.code || "").split(":");
  let status = "in_transit";
  if (type === "2") status = "delivered";
  else if (type === "8" && attr === "2") status = "ready_for_pickup";
  else if (type === "1") status = "pending";
  else if (type === "3" || type === "5" || type === "12" || type === "16" || type === "17") status = "problem";
  return { status, statusText: last.text, eta: "", events: events.reverse() };
}

const tokenCache = {};
async function oauth(fetcher, key, url, init) {
  const hit = tokenCache[key];
  if (hit && hit.until > Date.now()) return hit.token;
  const doc = await getJson(fetcher, url, init);
  const token = doc && doc.access_token;
  if (!token) throw new Error("carrier_auth");
  tokenCache[key] = { token, until: Date.now() + Math.max(60, (Number(doc.expires_in) || 3600) - 120) * 1000 };
  return token;
}

export async function readCarrier(env, carrierId, number, fetcher) {
  const c = carrierById(carrierId);
  const api = c && c.api;
  if (!api || !keyed(env, api)) return { unsupported: true };
  const n = encodeURIComponent(number);
  const f = fetcher || ((u, i) => fetch(u, i));
  if (api === "postnord") {
    const doc = await getJson(f, "https://api2.postnord.com/rest/shipment/v5/trackandtrace/findByIdentifier.json?locale=en&id=" + n + "&apikey=" + encodeURIComponent(env.POSTNORD_API_KEY));
    return doc.notFound ? { notFound: true } : (fromPostnord(doc) || { notFound: true });
  }
  if (api === "dhl") {
    const service = carrierId === "dhl_freight" ? "&service=freight" : carrierId === "dhl_express" ? "&service=express" : "";
    const doc = await getJson(f, "https://api-eu.dhl.com/track/shipments?trackingNumber=" + n + service, { headers: { "DHL-API-Key": String(env.DHL_API_KEY), accept: "application/json" } });
    return doc.notFound ? { notFound: true } : (fromDhl(doc) || { notFound: true });
  }
  if (api === "bring") {
    const doc = await getJson(f, "https://api.bring.com/tracking/api/v2/tracking.json?q=" + n, { headers: { "X-Mybring-API-Uid": String(env.BRING_API_UID), "X-Mybring-API-Key": String(env.BRING_API_KEY), "X-Bring-Client-URL": "https://viktorychgroup.github.io/ViktorychApp/", accept: "application/json" } });
    return doc.notFound ? { notFound: true } : (fromBring(doc) || { notFound: true });
  }
  if (api === "ups") {
    const token = await oauth(f, "ups", "https://onlinetools.ups.com/security/v1/oauth/token", { method: "POST", headers: { authorization: "Basic " + btoa(env.UPS_CLIENT_ID + ":" + env.UPS_CLIENT_SECRET), "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
    const doc = await getJson(f, "https://onlinetools.ups.com/api/track/v1/details/" + n + "?locale=en_US", { headers: { authorization: "Bearer " + token, transId: String(Date.now()), transactionSrc: "viktorych" } });
    return doc.notFound ? { notFound: true } : (fromUps(doc) || { notFound: true });
  }
  if (api === "fedex") {
    const token = await oauth(f, "fedex", "https://apis.fedex.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials&client_id=" + encodeURIComponent(env.FEDEX_CLIENT_ID) + "&client_secret=" + encodeURIComponent(env.FEDEX_CLIENT_SECRET) });
    const doc = await getJson(f, "https://apis.fedex.com/track/v1/trackingnumbers", { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify({ includeDetailedScans: true, trackingInfo: [{ trackingNumberInfo: { trackingNumber: number } }] }) });
    return doc.notFound ? { notFound: true } : (fromFedex(doc) || { notFound: true });
  }
  if (api === "pochta") {
    const x = (s) => String(s).replace(/[<>&'"]/g, "");
    const body = '<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:oper="http://russianpost.org/operationhistory" xmlns:data="http://russianpost.org/operationhistory/data"><soap:Header/><soap:Body><oper:getOperationHistory><data:OperationHistoryRequest><data:Barcode>' + x(number) + '</data:Barcode><data:MessageType>0</data:MessageType><data:Language>RUS</data:Language></data:OperationHistoryRequest><data:AuthorizationHeader soap:mustUnderstand="1"><data:login>' + x(env.POCHTA_LOGIN) + '</data:login><data:password>' + x(env.POCHTA_PASSWORD) + '</data:password></data:AuthorizationHeader></oper:getOperationHistory></soap:Body></soap:Envelope>';
    const res = await f("https://tracking.russianpost.ru/rtm34", { method: "POST", headers: { "content-type": "application/soap+xml; charset=utf-8" }, body });
    if (!res || (!res.ok && res.status !== 500)) throw new Error("carrier_http_" + (res ? res.status : 0));
    return fromPochta(await res.text()) || { notFound: true };
  }
  return { unsupported: true };
}

/* ---------- rows ---------- */

function rowOut(row, env) {
  let events = [];
  try { events = JSON.parse(row.events || "[]"); } catch (err) { events = []; }
  const c = carrierById(row.carrier);
  return {
    id: row.id, number: row.number, carrier: row.carrier, carrierName: c ? c.name : row.carrier, name: row.name,
    status: row.status, statusText: row.status_text, eta: row.eta, events, archived: !!row.archived,
    error: row.error, live: !!(c && c.api && keyed(env, c.api)), url: trackingUrl(row.carrier, row.number),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), changedAt: Number(row.changed_at), checkedAt: Number(row.checked_at)
  };
}

function nextGap(row, changed, failed) {
  if (failed) return Math.min(MAX_GAP, MIN_GAP * Math.pow(2, Math.min(5, (Number(row.fails) || 0) + 1)));
  if (changed) return MIN_GAP;
  const since = Date.now() - (Number(row.changed_at) || Number(row.created_at) || Date.now());
  return Math.max(MIN_GAP, Math.min(MAX_GAP, Math.round(since / 4)));
}

/* Reads one row from its carrier, stores it, and returns { row, changed }. */
export async function refreshRow(env, row, fetcher, notify) {
  const now = Date.now();
  let got;
  try { got = await readCarrier(env, row.carrier, row.number, fetcher); }
  catch (err) { got = { error: String((err && err.message) || "carrier_error").slice(0, 60) }; }
  if (got.unsupported) {
    await env.DB.prepare("UPDATE packages SET checked_at = ?, next_check_at = ?, error = 'no_api' WHERE id = ?").bind(now, now + MAX_GAP, row.id).run();
    return { row: Object.assign({}, row, { checked_at: now, error: "no_api" }), changed: false };
  }
  if (got.error || got.notFound) {
    const err = got.notFound ? "not_found" : got.error;
    const fails = (Number(row.fails) || 0) + 1;
    await env.DB.prepare("UPDATE packages SET checked_at = ?, next_check_at = ?, fails = ?, error = ? WHERE id = ?").bind(now, now + nextGap(row, false, true), fails, err, row.id).run();
    return { row: Object.assign({}, row, { checked_at: now, fails, error: err }), changed: false };
  }
  const status = STATUSES.indexOf(got.status) >= 0 ? got.status : "in_transit";
  const events = (got.events || []).filter((e) => e && (e.text || e.at)).sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0)).slice(0, 60);
  const changed = status !== row.status;
  const next = status === "delivered" ? 0 : now + nextGap(row, changed || events.length !== safeLen(row.events), false);
  const fields = { status, status_text: clip(got.statusText, 200), eta: got.eta || "", events: JSON.stringify(events) };
  await env.DB.prepare("UPDATE packages SET status = ?, status_text = ?, eta = ?, events = ?, fails = 0, error = '', checked_at = ?, next_check_at = ?, updated_at = ?, changed_at = ? WHERE id = ?")
    .bind(fields.status, fields.status_text, fields.eta, fields.events, now, next, changed ? now : Number(row.updated_at) || now, changed ? now : Number(row.changed_at) || 0, row.id).run();
  const out = Object.assign({}, row, fields, { fails: 0, error: "", checked_at: now, next_check_at: next, changed_at: changed ? now : row.changed_at });
  if (changed && notify && row.status !== "") {
    try { await notify(env, out); } catch (err) { /* the row is saved either way */ }
  }
  return { row: out, changed };
}

function safeLen(text) { try { return JSON.parse(text || "[]").length; } catch (err) { return 0; } }

function newId() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return "pk" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function pollPackages(env, at, fetcher, notify) {
  if (!env || !env.DB) return { checked: 0 };
  await ensurePackagesSchema(env);
  const now = Number(at) || Date.now();
  const due = await env.DB.prepare("SELECT * FROM packages WHERE archived = 0 AND next_check_at > 0 AND next_check_at <= ? AND status != 'delivered' ORDER BY next_check_at ASC LIMIT ?").bind(now, CRON_BATCH).all();
  // Delivered a week ago: off the open list on every device.
  await env.DB.prepare("UPDATE packages SET archived = 1, updated_at = ? WHERE archived = 0 AND status = 'delivered' AND changed_at > 0 AND changed_at < ?").bind(now, now - 7 * 86400000).run();
  let checked = 0;
  for (const row of (due && due.results) || []) {
    await refreshRow(env, row, fetcher, notify);
    checked += 1;
  }
  return { checked };
}

let schemaReady = null;
export function ensurePackagesSchema(env) {
  if (!schemaReady) schemaReady = env.DB.batch(PACKAGES_SCHEMA.map((sql) => env.DB.prepare(sql))).catch((err) => { schemaReady = null; throw err; });
  return schemaReady;
}

export async function handlePackagesRoute(request, env, path, deps) {
  const viewer = await deps.sessionAccount(env, request);
  if (!viewer) return deps.json(401, { error: "unauthorized" });
  await ensurePackagesSchema(env);
  const me = viewer.public_id;
  const method = request.method;
  const fetcher = deps.fetcher;
  const notify = deps.notify;
  if (path === "/v1/packages/carriers" && method === "GET") {
    return deps.json(200, { carriers: CARRIERS.map((c) => ({ id: c.id, name: c.name, country: c.country, live: !!(c.api && keyed(env, c.api)) })) });
  }
  if (path === "/v1/packages" && method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM packages WHERE public_id = ? ORDER BY archived ASC, updated_at DESC LIMIT ?").bind(me, MAX_PER_USER).all();
    return deps.json(200, { packages: ((rows && rows.results) || []).map((r) => rowOut(r, env)) });
  }
  if (path === "/v1/packages" && method === "POST") {
    const body = await deps.readJson(request);
    const number = cleanNumber(body && body.number);
    if (number.length < 6) return deps.json(400, { error: "bad_number" });
    const guess = detectCarriers(number);
    const carrier = body && carrierById(body.carrier) ? String(body.carrier) : guess[0] || "";
    if (!carrier) return deps.json(400, { error: "unknown_carrier", number });
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM packages WHERE public_id = ?").bind(me).first();
    if (Number(count && count.n) >= MAX_PER_USER) return deps.json(429, { error: "too_many" });
    const now = Date.now();
    const existing = await env.DB.prepare("SELECT * FROM packages WHERE public_id = ? AND number = ?").bind(me, number).first();
    let row = existing;
    if (existing) {
      await env.DB.prepare("UPDATE packages SET carrier = ?, name = COALESCE(NULLIF(?, ''), name), archived = 0, updated_at = ?, next_check_at = ? WHERE id = ?").bind(carrier, clip(body && body.name, 80), now, now, existing.id).run();
      row = await env.DB.prepare("SELECT * FROM packages WHERE id = ?").bind(existing.id).first();
    } else {
      const id = newId();
      await env.DB.prepare("INSERT INTO packages (id, public_id, number, carrier, name, status, created_at, updated_at, next_check_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)").bind(id, me, number, carrier, clip(body && body.name, 80), now, now, now).run();
      row = await env.DB.prepare("SELECT * FROM packages WHERE id = ?").bind(id).first();
    }
    const done = await refreshRow(env, row, fetcher, null);
    return deps.json(existing ? 200 : 201, { package: rowOut(done.row, env), guesses: guess });
  }
  const m = /^\/v1\/packages\/(pk[0-9a-f]{18})(\/refresh)?$/.exec(path);
  if (!m) return deps.json(404, { error: "not_found" });
  const row = await env.DB.prepare("SELECT * FROM packages WHERE id = ? AND public_id = ?").bind(m[1], me).first();
  if (!row) return deps.json(404, { error: "not_found" });
  if (m[2] && method === "POST") {
    if (Date.now() - (Number(row.checked_at) || 0) < MANUAL_GAP) return deps.json(200, { package: rowOut(row, env), fresh: false });
    const done = await refreshRow(env, row, fetcher, notify);
    return deps.json(200, { package: rowOut(done.row, env), fresh: true });
  }
  if (m[2]) return deps.json(405, { error: "method_not_allowed" });
  if (method === "PATCH") {
    const body = (await deps.readJson(request)) || {};
    const name = body.name != null ? clip(body.name, 80) : row.name;
    const archived = body.archived != null ? (body.archived ? 1 : 0) : Number(row.archived);
    const carrier = body.carrier && carrierById(body.carrier) ? String(body.carrier) : row.carrier;
    const now = Date.now();
    const recheck = carrier !== row.carrier || (!archived && Number(row.archived)) ? now : Number(row.next_check_at);
    await env.DB.prepare("UPDATE packages SET name = ?, archived = ?, carrier = ?, updated_at = ?, next_check_at = ? WHERE id = ?").bind(name, archived, carrier, now, recheck, row.id).run();
    const fresh = await env.DB.prepare("SELECT * FROM packages WHERE id = ?").bind(row.id).first();
    return deps.json(200, { package: rowOut(fresh, env) });
  }
  if (method === "DELETE") {
    await env.DB.prepare("DELETE FROM packages WHERE id = ? AND public_id = ?").bind(row.id, me).run();
    return deps.json(200, { ok: true });
  }
  if (method === "GET") return deps.json(200, { package: rowOut(row, env) });
  return deps.json(405, { error: "method_not_allowed" });
}

const STATUS_TEXT = { pending: "Label created", in_transit: "In transit", out_for_delivery: "Out for delivery", ready_for_pickup: "Ready for pickup", delivered: "Delivered", problem: "Problem" };

/* In-app note and web push for one status change. */
export function packageNotifier(emit) {
  return (env, row) => emit(env, {
    publicId: row.public_id,
    kind: "package",
    at: Date.now(),
    idempotencyKey: "package:" + row.id + ":" + row.status + ":" + Math.floor(Date.now() / 60000),
    subject: row.id,
    name: clip(row.name || row.number, 80),
    text: clip((STATUS_TEXT[row.status] || row.status) + (row.status_text ? " · " + row.status_text : ""), 180),
    hash: "#/packages/" + row.id,
    platform: "app"
  });
}
