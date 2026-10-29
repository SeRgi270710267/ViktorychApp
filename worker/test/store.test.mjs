import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { stripeSignature, verifyStripe } from "../src/payments.js";
import { keepOwnedStickers } from "../src/store.js";

const WEBHOOK_SECRET = "whsec_test_only";
const stripeCalls = [];

function workerOptions(extra) {
  return {
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/index.js", import.meta.url)),
    modulesRoot: fileURLToPath(new URL("../..", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: Object.assign({
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      OWNER_HANDLE: "user_owner",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000"
    }, extra || {}),
    outboundService: async (request) => {
      const url = new URL(request.url);
      const body = await request.text();
      stripeCalls.push({ path: url.pathname, body });
      if (url.hostname === "api.stripe.com" && url.pathname === "/v1/checkout/sessions") {
        return Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
      }
      if (url.hostname === "api.stripe.com" && url.pathname === "/v1/refunds") return Response.json({ id: "re_test_1" });
      return new Response("not found", { status: 404 });
    }
  };
}

let nextIp = 30;
function caller(mf) {
  return async function call(path, opts) {
    opts = opts || {};
    const headers = new Headers(opts.headers || {});
    headers.set("CF-Connecting-IP", opts.ip || "203.0." + Math.floor(nextIp / 250) + "." + (1 + (nextIp++ % 250)));
    if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
    if (opts.body && !opts.raw) headers.set("content-type", "application/json");
    const res = await mf.dispatchFetch("https://accounts.test" + path, {
      method: opts.method || "GET",
      headers,
      body: opts.raw != null ? opts.raw : opts.body ? JSON.stringify(opts.body) : undefined
    });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (err) { body = { raw: text }; }
    return { status: res.status, body };
  };
}

async function signup(call, handle, ip, claimCode) {
  const created = await call("/v1/signup", { method: "POST", ip, body: { displayName: "Member", handle, claimCode } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body;
}

test("webhook signatures are checked in constant form with a time window", async () => {
  const env = { STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET };
  const now = Date.now();
  const t = String(Math.floor(now / 1000));
  const sig = await stripeSignature(WEBHOOK_SECRET, t, "{}");
  assert.equal(await verifyStripe(env, "t=" + t + ",v1=" + sig, "{}", now), true);
  assert.equal(await verifyStripe(env, "t=" + t + ",v1=" + sig, "{ }", now), false);
  assert.equal(await verifyStripe(env, "t=" + t + ",v1=" + sig, "{}", now + 600000), false);
  assert.equal(await verifyStripe({}, "t=" + t + ",v1=" + sig, "{}", now), false);
});

test("store without payment keys: Viktorych prices, owner grants, atomic spends", async () => {
  const mf = new Miniflare(workerOptions());
  const env = await mf.getBindings();
  const call = caller(mf);
  try {
    const owner = await signup(call, "user_owner", "198.51.100.11", "claim-test");
    const ada = await signup(call, "user_sa", "198.51.100.12");
    const bea = await signup(call, "user_sb", "198.51.100.13");

    const catalog = await call("/v1/store/catalog", { token: ada.token });
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.payments.enabled, false);
    assert.equal(catalog.body.balance, 0);
    assert.equal(catalog.body.stickers.find((pack) => pack.id === "starter").owned, true);
    assert.equal(catalog.body.stickers.find((pack) => pack.id === "critters").owned, false);
    assert.equal(JSON.stringify(catalog.body).includes("pack_v"), false, "Viktorychs are never sold");

    const pay = await call("/v1/store/checkout", { method: "POST", token: ada.token, body: { kind: "gift", itemId: "crown", accept: true } });
    assert.equal(pay.status, 503);
    assert.equal(pay.body.error, "payments_off");

    const poor = await call("/v1/store/buy", { method: "POST", token: ada.token, body: { kind: "stickers", itemId: "critters" } });
    assert.equal(poor.status, 402);
    const none = await env.DB.prepare("SELECT COUNT(*) AS n FROM store_orders").first();
    assert.equal(none.n, 0, "a failed spend leaves no order behind");

    const denied = await call("/v1/viktorychs/grant", { method: "POST", token: ada.token, body: { handle: "user_sa", amount: 1000 } });
    assert.equal(denied.status, 403);
    const granted = await call("/v1/viktorychs/grant", { method: "POST", token: owner.token, body: { handle: "user_sa", amount: 1000 } });
    assert.equal(granted.status, 200);

    const pack = await call("/v1/store/buy", { method: "POST", token: ada.token, body: { kind: "stickers", itemId: "critters" } });
    assert.equal(pack.status, 201, JSON.stringify(pack.body));
    assert.equal(pack.body.balance, 920);
    const twice = await call("/v1/store/buy", { method: "POST", token: ada.token, body: { kind: "stickers", itemId: "critters" } });
    assert.equal(twice.status, 409);
    assert.equal((await env.DB.prepare("SELECT balance FROM point_balances WHERE public_id = ?").bind(ada.account.publicId).first()).balance, 920);

    const kept = await keepOwnedStickers(env, ada.account.publicId, "hi [[sticker:critters/fox]] [[sticker:royal/crown]] [[sticker:starter/hug]]");
    assert.equal(kept, "hi [[sticker:critters/fox]]  [[sticker:starter/hug]]");

    const moneyOnly = await call("/v1/store/buy", { method: "POST", token: ada.token, body: { kind: "gift", itemId: "crown_founders" } });
    assert.equal(moneyOnly.status, 400);
    assert.equal(moneyOnly.body.error, "money_only");

    await env.DB.prepare("INSERT INTO store_editions (item_id, sold) VALUES ('unicorn_gold', 249)").run();
    const last = await call("/v1/store/buy", { method: "POST", token: ada.token, body: { kind: "gift", itemId: "unicorn_gold", handle: "user_sb", message: "for you", privacy: "anonymous" } });
    assert.equal(last.status, 201, JSON.stringify(last.body));
    assert.equal(last.body.edition, 250);
    assert.equal(last.body.balance, 20);
    await call("/v1/viktorychs/grant", { method: "POST", token: owner.token, body: { handle: "user_sa", amount: 1000 } });
    const soldOut = await call("/v1/store/buy", { method: "POST", token: ada.token, body: { kind: "gift", itemId: "unicorn_gold" } });
    assert.equal(soldOut.status, 409);
    assert.equal(soldOut.body.error, "sold_out");
    assert.equal(soldOut.body.balance, 1020, "a sold-out item takes no Viktorychs");

    const shelf = await call("/v1/gifts?handle=user_sb", { token: bea.token });
    const unicorn = shelf.body.gifts.find((gift) => gift.id === "unicorn_gold" || gift.giftId === "unicorn_gold");
    assert.ok(unicorn, JSON.stringify(shelf.body.gifts));
    assert.equal(JSON.stringify(shelf.body).includes(ada.account.publicId), false);

    await call("/v1/blocks", { method: "PUT", token: bea.token, body: { id: ada.account.publicId } });
    const blocked = await call("/v1/store/buy", { method: "POST", token: ada.token, body: { kind: "stickers", itemId: "love", handle: "user_sb" } });
    assert.equal(blocked.status, 403);

    const testItem = await call("/v1/store/grant", { method: "POST", token: owner.token, body: { kind: "stickers", itemId: "royal", handle: "user_sb" } });
    assert.equal(testItem.status, 201);
    const bCatalog = await call("/v1/store/catalog", { token: bea.token });
    assert.equal(bCatalog.body.stickers.find((item) => item.id === "royal").owned, true);
  } finally {
    await mf.dispose();
  }
});

test("money checkout, verified webhook, unopened refund", async () => {
  const mf = new Miniflare(workerOptions({ STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }));
  const env = await mf.getBindings();
  const call = caller(mf);
  try {
    const ada = await signup(call, "user_ma", "198.51.100.21");
    const bea = await signup(call, "user_mb", "198.51.100.22");
    const catalog = await call("/v1/store/catalog", { token: ada.token });
    assert.equal(catalog.body.payments.enabled, true);

    const noTerms = await call("/v1/store/checkout", { method: "POST", token: ada.token, body: { kind: "gift", itemId: "crown", handle: "user_mb" } });
    assert.equal(noTerms.status, 400);
    const started = await call("/v1/store/checkout", { method: "POST", token: ada.token, body: { kind: "gift", itemId: "crown", handle: "user_mb", message: "hi", accept: true, returnUrl: "https://viktorychgroup.github.io/ViktorychApp/" } });
    assert.equal(started.status, 201, JSON.stringify(started.body));
    assert.equal(started.body.url.startsWith("https://checkout.stripe.com/"), true);
    const sent = stripeCalls.find((row) => row.path === "/v1/checkout/sessions");
    assert.ok(sent.body.includes("unit_amount%5D=699"));
    assert.ok(sent.body.includes(encodeURIComponent("https://viktorychgroup.github.io/ViktorychApp/#/store/orders?paid=")));

    const event = JSON.stringify({ type: "checkout.session.completed", data: { object: { payment_status: "paid", payment_intent: "pi_test_1", client_reference_id: started.body.id, metadata: { order_id: started.body.id } } } });
    const forged = await call("/v1/pay/webhook/stripe", { method: "POST", raw: event, headers: { "stripe-signature": "t=1,v1=00" } });
    assert.equal(forged.status, 400);
    const t = String(Math.floor(Date.now() / 1000));
    const sig = "t=" + t + ",v1=" + (await stripeSignature(WEBHOOK_SECRET, t, event));
    for (let i = 0; i < 2; i++) {
      const hook = await call("/v1/pay/webhook/stripe", { method: "POST", raw: event, headers: { "stripe-signature": sig } });
      assert.equal(hook.status, 200);
    }
    const sends = await env.DB.prepare("SELECT COUNT(*) AS n FROM gift_sends WHERE recipient_id = ?").bind(bea.account.publicId).first();
    assert.equal(sends.n, 1, "a repeated webhook delivers once");

    const orders = await call("/v1/store/orders", { token: ada.token });
    const order = orders.body.orders[0];
    assert.equal(order.status, "paid");
    assert.equal(order.refundable, true);

    const refunded = await call("/v1/store/orders/" + order.id + "/refund", { method: "POST", token: ada.token });
    assert.equal(refunded.status, 200, JSON.stringify(refunded.body));
    const gone = await env.DB.prepare("SELECT COUNT(*) AS n FROM gift_sends WHERE recipient_id = ?").bind(bea.account.publicId).first();
    assert.equal(gone.n, 0);

    const second = await call("/v1/store/checkout", { method: "POST", token: ada.token, body: { kind: "gift", itemId: "crown", handle: "user_mb", accept: true } });
    const event2 = JSON.stringify({ type: "checkout.session.completed", data: { object: { payment_status: "paid", payment_intent: "pi_test_2", metadata: { order_id: second.body.id } } } });
    const sig2 = "t=" + t + ",v1=" + (await stripeSignature(WEBHOOK_SECRET, t, event2));
    await call("/v1/pay/webhook/stripe", { method: "POST", raw: event2, headers: { "stripe-signature": sig2 } });
    const row = await env.DB.prepare("SELECT gift_send_id FROM store_orders WHERE id = ?").bind(second.body.id).first();
    const opened = await call("/v1/store/gifts/" + row.gift_send_id + "/open", { method: "POST", token: bea.token });
    assert.equal(opened.status, 200);
    const late = await call("/v1/store/orders/" + second.body.id + "/refund", { method: "POST", token: ada.token });
    assert.equal(late.status, 409);
    assert.equal(late.body.error, "opened");
  } finally {
    await mf.dispose();
  }
});
