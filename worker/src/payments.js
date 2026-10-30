/* Provider-agnostic payment adapter. Real money pays for one item at a time
   (a gift or a sticker pack). It never buys Viktorychs: those are earned only.
   No card data ever reaches this Worker; the provider's hosted page takes it.
   Payments stay off until the owner adds the provider's secrets. */

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_TOLERANCE_S = 300;

function stripeReady(env) {
  return !!(String(env.STRIPE_SECRET_KEY || "").trim() && String(env.STRIPE_WEBHOOK_SECRET || "").trim()) && String(env.PAYMENTS || "") !== "off";
}

function form(fields, prefix, out) {
  out = out || [];
  Object.keys(fields).forEach((key) => {
    const value = fields[key];
    const name = prefix ? prefix + "[" + key + "]" : key;
    if (value == null) return;
    if (typeof value === "object") form(value, name, out);
    else out.push(encodeURIComponent(name) + "=" + encodeURIComponent(String(value)));
  });
  return out;
}

async function stripeCall(env, path, fields, idempotencyKey) {
  const headers = {
    authorization: "Bearer " + String(env.STRIPE_SECRET_KEY || "").trim(),
    "content-type": "application/x-www-form-urlencoded"
  };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const res = await fetch(STRIPE_API + path, { method: "POST", headers: headers, body: form(fields).join("&") });
  let body = null;
  try { body = await res.json(); } catch (err) { body = null; }
  if (!res.ok || !body) {
    const code = body && body.error && body.error.code ? String(body.error.code) : "provider_error";
    const error = new Error("stripe " + res.status + " " + code);
    error.provider = true;
    throw error;
  }
  return body;
}

function hex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameText(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

export async function stripeSignature(secret, timestamp, payload) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + "." + payload)));
}

/* Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>]. Rejects stale or forged bodies. */
export async function verifyStripe(env, header, payload, nowMs) {
  const secret = String(env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!secret || !header) return false;
  let t = "";
  const sigs = [];
  String(header).split(",").forEach((part) => {
    const cut = part.indexOf("=");
    if (cut < 0) return;
    const name = part.slice(0, cut).trim();
    const value = part.slice(cut + 1).trim();
    if (name === "t") t = value;
    if (name === "v1") sigs.push(value);
  });
  if (!/^\d{1,12}$/.test(t) || !sigs.length) return false;
  const now = Math.floor((nowMs == null ? Date.now() : nowMs) / 1000);
  if (Math.abs(now - Number(t)) > STRIPE_TOLERANCE_S) return false;
  const want = await stripeSignature(secret, t, payload);
  return sigs.some((sig) => sameText(sig, want));
}

const stripe = {
  id: "stripe",
  ready: stripeReady,
  /* One hosted Checkout page for one item. Cards, Apple Pay and Google Pay are
     offered by Stripe on that page when they are on in the Stripe dashboard. */
  async createCheckout(env, input) {
    const session = await stripeCall(env, "/checkout/sessions", {
      mode: "payment",
      client_reference_id: input.orderId,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      line_items: { 0: { quantity: 1, price_data: { currency: input.currency, unit_amount: input.cents, product_data: { name: input.name } } } },
      metadata: { order_id: input.orderId },
      payment_intent_data: { metadata: { order_id: input.orderId } },
      custom_text: { submit: { message: input.termsNote } }
    }, "order-" + input.orderId);
    return { url: String(session.url || ""), ref: String(session.id || "") };
  },
  async refund(env, paymentRef, orderId) {
    const refund = await stripeCall(env, "/refunds", { payment_intent: paymentRef, metadata: { order_id: orderId } }, "refund-" + orderId);
    return { ref: String(refund.id || "") };
  },
  /* Turns a verified webhook body into { type, orderId, paymentRef }. */
  parse(event) {
    const object = event && event.data && event.data.object ? event.data.object : {};
    const meta = object.metadata || {};
    const orderId = String(meta.order_id || object.client_reference_id || "");
    const type = String(event && event.type || "");
    if ((type === "checkout.session.completed" && object.payment_status === "paid") || type === "checkout.session.async_payment_succeeded") {
      return { type: "paid", orderId: orderId, paymentRef: String(object.payment_intent || "") };
    }
    if (type === "checkout.session.expired" || type === "checkout.session.async_payment_failed") return { type: "expired", orderId: orderId };
    if (type === "charge.refunded") return { type: "refunded", orderId: orderId, paymentRef: String(object.payment_intent || "") };
    return { type: "ignored", orderId: orderId };
  }
};

/* Placeholder for a Russia-friendly provider (YooKassa or YooMoney). It is never
   ready until someone implements createCheckout, refund and the webhook check
   against that provider's documentation and the owner adds its secrets. */
const yookassa = {
  id: "yookassa",
  ready() { return false; },
  async createCheckout() { throw Object.assign(new Error("yookassa not implemented"), { provider: true }); },
  async refund() { throw Object.assign(new Error("yookassa not implemented"), { provider: true }); },
  parse() { return { type: "ignored", orderId: "" }; }
};

export const PROVIDERS = { stripe: stripe, yookassa: yookassa };

export function paymentProvider(env, wanted) {
  const id = wanted && PROVIDERS[wanted] ? wanted : "stripe";
  const provider = PROVIDERS[id];
  return provider.ready(env) ? provider : null;
}

export function paymentsInfo(env) {
  return {
    enabled: Object.keys(PROVIDERS).some((id) => PROVIDERS[id].ready(env)),
    providers: Object.keys(PROVIDERS).map((id) => ({ id: id, ready: PROVIDERS[id].ready(env) }))
  };
}
