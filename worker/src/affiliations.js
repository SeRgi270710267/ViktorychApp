/* Organization affiliation badges.
   A person cannot grant one to themselves. Only an owner account can. */

import { inspectHandle } from "../../shared/handle-skeleton.js";
import { canSeeAudience, setListGrants } from "./audience.js";
import { blocksEither } from "./social.js";

const PUBLIC_ID = /^\d{12}$/;
const AUDIENCES = ["public", "followers", "mutuals", "lists", "only"];

export const AFFILIATION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS affiliations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    logo TEXT NOT NULL,
    profile_ref TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS affiliation_grants (
    affiliation_id TEXT NOT NULL,
    public_id TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    audience TEXT NOT NULL DEFAULT 'public',
    granted_at INTEGER NOT NULL,
    PRIMARY KEY (affiliation_id, public_id)
  )`,
  "CREATE INDEX IF NOT EXISTS affiliation_grants_account ON affiliation_grants(public_id)",
  "INSERT INTO affiliations (id, name, logo, profile_ref) VALUES ('viktorych', 'Viktorych', 'logo/affiliation-viktorych.svg', 'owner') ON CONFLICT(id) DO NOTHING"
];

function rows(result) {
  return (result && result.results) || [];
}

function cleanAudience(value) {
  const text = String(value || "");
  if (text === "friends") return "mutuals";
  if (text === "list") return "lists";
  if (text === "me") return "only";
  return AUDIENCES.indexOf(text) >= 0 ? text : "public";
}

function seeAs(audience) {
  if (audience === "mutuals") return "friends";
  if (audience === "lists") return "list";
  if (audience === "only") return "only";
  if (audience === "followers") return "followers";
  return "public";
}

async function ownerHref(env) {
  try {
    const row = await env.DB.prepare("SELECT handle FROM accounts WHERE owner = 1 LIMIT 1").first();
    if (row && row.handle) return "#/@" + encodeURIComponent(row.handle);
  } catch (err) { /* no owner profile yet */ }
  return "";
}

async function hrefFor(env, affiliation) {
  if (affiliation && affiliation.profile_ref === "owner") return ownerHref(env);
  return "";
}

function card(affiliation, href, extra) {
  const view = {
    id: affiliation.id,
    name: affiliation.name,
    logo: affiliation.logo,
    href: href || ""
  };
  if (extra) {
    view.hidden = extra.hidden === 1;
    view.audience = cleanAudience(extra.audience);
  }
  return view;
}

async function visibleGrant(env, viewerId, ownerId, grant, affiliation) {
  if (!grant) return false;
  if (viewerId && viewerId === ownerId) return true;
  if (grant.hidden === 1) return false;
  if (viewerId && await blocksEither(env, viewerId, ownerId)) return false;
  return canSeeAudience(env, {
    viewerId: viewerId || "",
    ownerId: ownerId,
    audience: seeAs(cleanAudience(grant.audience)),
    subject: "affiliation",
    subjectId: affiliation.id
  });
}

/* An organization whose profile_ref is "owner" is the owner's own org, so
   every owner account carries its badge without a grant row. A grant row,
   when one exists, still holds the owner's hide and audience choices. */
async function impliedOwnerRows(env, ids, listedRows) {
  if (!ids.length) return [];
  let owners = { results: [] };
  let orgs = { results: [] };
  try {
    owners = await env.DB.prepare(
      "SELECT public_id FROM accounts WHERE owner = 1 AND public_id IN (" + ids.map(() => "?").join(",") + ")"
    ).bind(...ids).all();
    if (!rows(owners).length) return [];
    orgs = await env.DB.prepare("SELECT id, name, logo, profile_ref FROM affiliations WHERE profile_ref = 'owner'").all();
  } catch (err) {
    return [];
  }
  const have = {};
  for (const row of listedRows) have[row.public_id + "|" + row.id] = true;
  const out = [];
  for (const owner of rows(owners)) {
    for (const org of rows(orgs)) {
      if (have[owner.public_id + "|" + org.id]) continue;
      out.push({ public_id: owner.public_id, hidden: 0, audience: "public", id: org.id, name: org.name, logo: org.logo, profile_ref: org.profile_ref });
    }
  }
  return out;
}

export async function handleAffiliations(request, env, path, deps) {
  const viewer = await deps.sessionAccount(env, request);
  if (path === "/v1/affiliations" && request.method === "GET") {
    const viewerId = viewer ? viewer.public_id : "";
    const ids = String(new URL(request.url).searchParams.get("ids") || "").split(",").map((id) => id.trim()).filter((id) => PUBLIC_ID.test(id)).slice(0, 40);
    const accounts = {};
    if (!ids.length) return deps.json(200, { accounts: accounts });
    const marks = ids.map(() => "?").join(",");
    let listed = { results: [] };
    try {
      listed = await env.DB.prepare(
        "SELECT g.public_id, g.hidden, g.audience, a.id, a.name, a.logo, a.profile_ref FROM affiliation_grants g JOIN affiliations a ON a.id = g.affiliation_id WHERE g.public_id IN (" + marks + ")"
      ).bind(...ids).all();
    } catch (err) {
      return deps.json(200, { accounts: accounts });
    }
    const hrefs = {};
    const all = rows(listed).concat(await impliedOwnerRows(env, ids, rows(listed)));
    for (const row of all) {
      const ok = await visibleGrant(env, viewerId, row.public_id, row, row);
      if (!ok) continue;
      if (row.profile_ref === "owner" && hrefs.owner == null) hrefs.owner = await ownerHref(env);
      if (!accounts[row.public_id]) accounts[row.public_id] = [];
      accounts[row.public_id].push(card(row, row.profile_ref === "owner" ? hrefs.owner : "", viewerId && viewerId === row.public_id ? row : null));
    }
    return deps.json(200, { accounts: accounts }, viewer ? undefined : { "cache-control": "public, max-age=300" });
  }

  if (path === "/v1/affiliations/me" && request.method === "GET") {
    if (!viewer) return deps.json(401, { error: "unauthorized" });
    let listed = { results: [] };
    try {
      listed = await env.DB.prepare(
        "SELECT g.hidden, g.audience, a.id, a.name, a.logo, a.profile_ref FROM affiliation_grants g JOIN affiliations a ON a.id = g.affiliation_id WHERE g.public_id = ?"
      ).bind(viewer.public_id).all();
    } catch (err) {
      return deps.json(200, { affiliations: [] });
    }
    const href = await ownerHref(env);
    const affiliations = rows(listed).concat(await impliedOwnerRows(env, [viewer.public_id], rows(listed))).map((row) => card(row, row.profile_ref === "owner" ? href : "", row));
    return deps.json(200, { affiliations: affiliations });
  }

  const mine = path.match(/^\/v1\/affiliations\/me\/([a-z0-9_-]+)$/);
  if (mine && request.method === "PATCH") {
    if (!viewer) return deps.json(401, { error: "unauthorized" });
    const body = await deps.readJson(request, 4000);
    if (body.error) return deps.json(400, { error: body.error });
    let grant = await env.DB.prepare(
      "SELECT hidden, audience FROM affiliation_grants WHERE affiliation_id = ? AND public_id = ?"
    ).bind(mine[1], viewer.public_id).first();
    if (!grant) {
      const implied = (await impliedOwnerRows(env, [viewer.public_id], [])).some((row) => row.id === mine[1]);
      if (!implied) return deps.json(404, { error: "not_granted" });
      await env.DB.prepare(
        "INSERT INTO affiliation_grants (affiliation_id, public_id, hidden, audience, granted_at) VALUES (?, ?, 0, 'public', ?) ON CONFLICT(affiliation_id, public_id) DO NOTHING"
      ).bind(mine[1], viewer.public_id, Date.now()).run();
      grant = { hidden: 0, audience: "public" };
    }
    const hidden = body.hidden != null ? (body.hidden ? 1 : 0) : grant.hidden;
    const audience = body.audience != null ? cleanAudience(body.audience) : cleanAudience(grant.audience);
    await env.DB.prepare(
      "UPDATE affiliation_grants SET hidden = ?, audience = ? WHERE affiliation_id = ? AND public_id = ?"
    ).bind(hidden, audience, mine[1], viewer.public_id).run();
    if (audience === "lists" && Array.isArray(body.listIds)) {
      await setListGrants(env, viewer.public_id, "affiliation", mine[1], body.listIds);
    }
    return deps.json(200, { ok: true, id: mine[1], hidden: hidden === 1, audience: audience });
  }

  if (path === "/v1/affiliations/grant" && request.method === "POST") {
    if (!viewer) return deps.json(401, { error: "unauthorized" });
    if (viewer.owner !== 1) return deps.json(403, { error: "forbidden" });
    const paced = await deps.rateHit(env, "aff-grant:" + viewer.public_id, 40, 10 * 60 * 1000);
    if (!paced.ok) return deps.limited(paced);
    const body = await deps.readJson(request, 2000);
    if (body.error) return deps.json(400, { error: body.error });
    const affiliationId = String(body.affiliationId || "");
    const affiliation = await env.DB.prepare("SELECT id FROM affiliations WHERE id = ?").bind(affiliationId).first();
    if (!affiliation) return deps.json(404, { error: "not_found" });
    const checked = inspectHandle(String(body.handle || "").replace(/^@/, ""));
    if (!checked.ok) return deps.json(400, { error: "handle" });
    const account = await env.DB.prepare("SELECT public_id FROM accounts WHERE skeleton = ?").bind(checked.skeleton).first();
    if (!account) return deps.json(404, { error: "not_found" });
    if (body.grant === false) {
      await env.DB.prepare("DELETE FROM affiliation_grants WHERE affiliation_id = ? AND public_id = ?").bind(affiliationId, account.public_id).run();
      return deps.json(200, { ok: true, granted: false });
    }
    await env.DB.prepare(
      "INSERT INTO affiliation_grants (affiliation_id, public_id, hidden, audience, granted_at) VALUES (?, ?, 0, 'public', ?) ON CONFLICT(affiliation_id, public_id) DO NOTHING"
    ).bind(affiliationId, account.public_id, Date.now()).run();
    return deps.json(200, { ok: true, granted: true });
  }
  return null;
}
