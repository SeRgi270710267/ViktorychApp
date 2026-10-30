# Store, gifts, stickers and payments

The store works **without any payment keys**. Until the owner adds them:

- Every item shows its price. The money button says **Coming soon** and the store shows a note.
- Items that have a Viktorych price can be bought or gifted with Viktorychs. Viktorychs are earned only through real effort and **can never be bought**.
- The free starter sticker pack works for everyone.
- The owner can grant Viktorychs and test items from **Store → Owner tools** (`#/store/owner`).
- The purchase terms page is at `#/store/terms`.

No card data ever reaches the app or the Worker. Stripe Checkout collects it. D1 stores only orders and entitlements, keyed by internal ids and the provider's payment reference.

## Turning on card, Apple Pay and Google Pay payments (Stripe)

1. Register the business first. Payments for digital goods need a registered seller, a VAT setup where it applies, and a published refund policy. Don't take live payments before that.
2. Create a Stripe account and finish its business verification.
3. In the Stripe Dashboard, go to **Settings → Payment methods** and turn on **Cards**, **Apple Pay** and **Google Pay**. Checkout shows Apple Pay and Google Pay on its own on supported devices.
4. Go to **Developers → API keys** and copy the **Secret key**. Use a test key (`sk_test_…`) first.
5. Go to **Developers → Webhooks** and select **Add endpoint**.
   - Endpoint URL: `https://<your accounts Worker host>/v1/pay/webhook/stripe`. This is the same host the app already uses for accounts.
   - Events:
     - `checkout.session.completed`
     - `checkout.session.async_payment_succeeded`
     - `checkout.session.async_payment_failed`
     - `checkout.session.expired`
     - `charge.refunded`
   - Save it, then copy the **Signing secret** (`whsec_…`).
6. Add both values as Worker secrets. Run these from the `worker/` folder; each command asks for the value:

   ```sh
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

7. Open the store. The money buttons now say **Pay €…**. Buy something with a Stripe test card, then check that the order changes to *Delivered* under **My purchases**.
8. After the business registration is done and test mode works, swap in the live secret key and the live webhook signing secret.

### Kill switch

To turn money payments off without deleting the keys, set the Worker variable `PAYMENTS` to `off` (in the dashboard or with `npx wrangler secret put PAYMENTS`). Viktorych purchases keep working.

## Rules the Worker enforces

- Items only. There is no cash-out, resale or trading, and Viktorychs are never sold.
- A gift paid with money stays wrapped until the recipient opens it. The buyer can ask for a refund of an unopened gift within 14 days, and the Worker refunds it through the provider. Once a gift is opened, it can't be refunded.
- Items bought for yourself, and sticker packs, are delivered right away. Checkout asks the buyer to agree that the right to cancel ends at delivery.
- Viktorych spends are final.
- Gifting is rate-limited per sender and per recipient. You can't gift someone who blocked you, or who only accepts gifts from followers or a list you're not on.
- Limited editions are reserved during checkout. The edition is released if the checkout expires, so it is never oversold.
- Webhooks are verified with the signing secret (HMAC-SHA256, 5-minute tolerance) and fulfilled idempotently, so a repeated event delivers only once.

## YooKassa

`worker/src/payments.js` has a YooKassa adapter stub, and it is never enabled. Adding it later means filling in `createCheckout`, `refund`, `verify` and `parse` with the same shape as the Stripe adapter.
