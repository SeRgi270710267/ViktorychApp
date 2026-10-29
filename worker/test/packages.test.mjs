import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { fromBring, fromDhl, fromFedex, fromPochta, fromPostnord, fromUps } from "../src/packages.js";
import { detectCarriers, extractNumbers, s10Valid, trackingUrl } from "../../shared/packages-carriers.js";

test("carrier detection and pasted-text extraction", () => {
  assert.ok(s10Valid("RR123456785SE"));
  assert.ok(!s10Valid("RR123456784SE"));
  assert.equal(detectCarriers("RR 1234 5678 5SE")[0], "postnord");
  assert.equal(detectCarriers("RA123456785RU")[0], "pochta");
  assert.equal(detectCarriers("RA123456785ES")[0], "correos");
  assert.equal(detectCarriers("1Z999AA10123456784")[0], "ups");
  assert.equal(detectCarriers("JJD0099999999")[0], "dhl");
  const got = extractNumbers("Hej! Ditt paket RR123456785SE är på väg. Трек-номер: 12345678901234 https://www.ups.com/track?tracknum=1Z999AA10123456784 order 20261029");
  assert.deepEqual(got.map((g) => g.number).sort(), ["12345678901234", "1Z999AA10123456784", "RR123456785SE"]);
  assert.ok(trackingUrl("postnord", "RR123456785SE").indexOf("RR123456785SE") > 0);
});

test("carrier responses map to the five statuses", () => {
  assert.equal(fromPostnord({ TrackingInformationResponse: { shipments: [{ status: "AVAILABLE_FOR_DELIVERY", items: [{ events: [{ eventTime: "2026-10-28T10:00:00", eventDescription: "Ready", location: { displayName: "Ombud", countryCode: "SE" } }] }] }] } }).status, "ready_for_pickup");
  assert.equal(fromDhl({ shipments: [{ status: { statusCode: "transit", description: "Out for delivery" }, events: [] }] }).status, "out_for_delivery");
  assert.equal(fromDhl({ shipments: [{ status: { statusCode: "delivered" }, estimatedTimeOfDelivery: "2026-10-30T12:00:00Z", events: [{ timestamp: "2026-10-29T08:00:00Z", description: "Delivered", location: { address: { addressLocality: "Stockholm" } } }] }] }).events[0].place, "Stockholm");
  assert.equal(fromBring({ consignmentSet: [{ packageSet: [{ eventSet: [{ status: "TRANSPORT_TO_RECIPIENT", description: "On the way", dateIso: "2026-10-28T10:00:00+01:00", city: "Oslo" }] }] }] }).status, "out_for_delivery");
  assert.equal(fromUps({ trackResponse: { shipment: [{ package: [{ activity: [{ status: { type: "X", description: "Exception" }, date: "20261028", time: "101500", location: { address: { city: "Madrid" } } }] }] }] } }).status, "problem");
  assert.equal(fromFedex({ output: { completeTrackResults: [{ trackResults: [{ latestStatusDetail: { code: "DL", description: "Delivered" }, scanEvents: [] }] }] } }).status, "delivered");
  const xml = "<ns:historyRecord><ns:OperationParameters><ns:OperType><ns:Id>1</ns:Id><ns:Name>Приём</ns:Name></ns:OperType><ns:OperAttr><ns:Id>1</ns:Id><ns:Name>Единичный</ns:Name></ns:OperAttr><ns:OperDate>2026-10-20T10:00:00.000+03:00</ns:OperDate></ns:OperationParameters></ns:historyRecord>"
    + "<ns:historyRecord><ns:AddressParameters><ns:OperationAddress><ns:Description>Москва</ns:Description></ns:OperationAddress></ns:AddressParameters><ns:OperationParameters><ns:OperType><ns:Id>8</ns:Id><ns:Name>Обработка</ns:Name></ns:OperType><ns:OperAttr><ns:Id>2</ns:Id><ns:Name>Прибыло в место вручения</ns:Name></ns:OperAttr><ns:OperDate>2026-10-25T10:00:00.000+03:00</ns:OperDate></ns:OperationParameters></ns:historyRecord>";
  const ru = fromPochta(xml);
  assert.equal(ru.status, "ready_for_pickup");
  assert.equal(ru.events[0].place, "Москва");
});

let mf;
let dhlStatus = "transit";
test.before(async () => {
  mf = new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/index.js", import.meta.url)),
    modulesRoot: fileURLToPath(new URL("../..", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: { ACCOUNT_PEPPER: "pepper-test", OWNER_CLAIM_CODE: "claim-test", OWNER_HANDLE: "user_owner", ALLOWED_ORIGINS: "https://viktorychgroup.github.io", PBKDF2_ITERATIONS: "1000", DHL_API_KEY: "test-key" },
    outboundService: async (req) => {
      const url = new URL(req.url);
      if (url.hostname === "api-eu.dhl.com") {
        assert.equal(req.headers.get("DHL-API-Key"), "test-key");
        return Response.json({ shipments: [{ status: { statusCode: dhlStatus, description: dhlStatus === "delivered" ? "Delivered" : "In transit" }, events: [{ timestamp: "2026-10-28T08:00:00Z", description: "Processed", location: { address: { addressLocality: "Malmö", countryCode: "SE" } } }] }] });
      }
      return new Response("", { status: 404 });
    }
  });
});
test.after(async () => { if (mf) await mf.dispose(); });

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers({ "CF-Connecting-IP": opts.ip || "203.0.113.190" });
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.json) headers.set("content-type", "application/json");
  const res = await mf.dispatchFetch("https://accounts.test" + path, { method: opts.method || "GET", headers, body: opts.json ? JSON.stringify(opts.json) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test("packages are private per account, live with a key, archived, deleted, and notify on change", async () => {
  const a = (await call("/v1/signup", { method: "POST", ip: "203.0.113.191", json: { displayName: "A", handle: "user_a" } })).body;
  const b = (await call("/v1/signup", { method: "POST", ip: "203.0.113.192", json: { displayName: "B", handle: "member_test" } })).body;
  assert.equal((await call("/v1/packages")).status, 401);

  const dhl = await call("/v1/packages", { method: "POST", token: a.token, json: { number: "JJD 0099 9999 99", name: "Shoes" } });
  assert.equal(dhl.status, 201, JSON.stringify(dhl.body));
  assert.equal(dhl.body.package.carrier, "dhl");
  assert.equal(dhl.body.package.status, "in_transit");
  assert.equal(dhl.body.package.events[0].place, "Malmö, SE");
  assert.ok(dhl.body.package.live);

  const pn = await call("/v1/packages", { method: "POST", token: a.token, json: { number: "RR123456785SE" } });
  assert.equal(pn.body.package.carrier, "postnord");
  assert.equal(pn.body.package.live, false, "no PostNord key yet");
  assert.equal(pn.body.package.error, "no_api");
  assert.ok(pn.body.package.url.indexOf("postnord.se") > 0);

  assert.equal((await call("/v1/packages", { method: "POST", token: a.token, json: { number: "ZZ" } })).status, 400);
  assert.equal((await call("/v1/packages", { token: b.token })).body.packages.length, 0, "another account sees none");
  assert.equal((await call("/v1/packages/" + dhl.body.package.id, { token: b.token })).status, 404);

  const carriers = await call("/v1/packages/carriers", { token: a.token });
  assert.ok(carriers.body.carriers.find((c) => c.id === "dhl").live);
  assert.ok(!JSON.stringify(carriers.body).includes("test-key"));

  dhlStatus = "delivered";
  const worker = await mf.getWorker();
  await worker.scheduled({ scheduledTime: Date.now() + 2 * 3600 * 1000, cron: "* * * * *" });
  const list = (await call("/v1/packages", { token: a.token })).body.packages;
  assert.equal(list.find((p) => p.id === dhl.body.package.id).status, "delivered");
  const notes = (await call("/v1/notifications", { token: a.token })).body.items || [];
  assert.ok(notes.some((n) => n.kind === "package"), JSON.stringify(notes.map((n) => n.kind)));

  const arch = await call("/v1/packages/" + pn.body.package.id, { method: "PATCH", token: a.token, json: { archived: true, name: "Book" } });
  assert.equal(arch.body.package.archived, true);
  assert.equal(arch.body.package.name, "Book");
  assert.equal((await call("/v1/packages/" + pn.body.package.id, { method: "DELETE", token: a.token })).status, 200);
  assert.equal((await call("/v1/packages", { token: a.token })).body.packages.length, 1);
});
