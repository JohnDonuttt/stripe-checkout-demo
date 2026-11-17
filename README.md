# stripe-checkout-demo

[![CI](https://github.com/JohnDonuttt/stripe-checkout-demo/actions/workflows/ci.yml/badge.svg)](https://github.com/JohnDonuttt/stripe-checkout-demo/actions/workflows/ci.yml)

A small shop (three products, a cart, a checkout button) wired to Stripe Checkout the way I'd do it for a real business. The UI is deliberately simple. The interesting part is the server:

- Prices live on the server. The browser sends product IDs and quantities, nothing else.
- Webhooks are verified against the raw request body with `stripe.webhooks.constructEvent`.
- Orders are fulfilled by the webhook, never by the success redirect.
- Session creation and webhook handling are both idempotent.

Node 22, Express 5, TypeScript, SQLite (better-sqlite3) on the server. Vue 3 and Vite on the client.

## Running it

You need a Stripe account (test mode is fine) and the [Stripe CLI](https://docs.stripe.com/stripe-cli).

```sh
npm install
cp .env.example .env          # add your sk_test_ key
stripe listen --forward-to localhost:4242/api/webhooks/stripe
```

`stripe listen` prints a `whsec_...` signing secret. Put it in `.env` as `STRIPE_WEBHOOK_SECRET`, then in two more terminals:

```sh
npm run dev:server            # API on :4242
npm run dev:client            # shop on :5173, proxies /api to the server
```

Open http://localhost:5173, add a few things, check out with `4242 4242 4242 4242` (any future expiry, any CVC). The success page shows "Payment received, preparing your order" until the webhook lands, then "Fulfilled".

For a single-process build: set `APP_URL=http://localhost:4242`, then `npm run build && npm start`. Express serves the built client.

```sh
npm test                      # vitest, no network or Stripe account needed
npm run typecheck
```

## API

| Method | Path | |
|---|---|---|
| GET | `/api/products` | Catalogue for display |
| POST | `/api/checkout` | `{ items: [{ productId, quantity }] }`, optional `Idempotency-Key` header. Returns the Checkout URL |
| POST | `/api/webhooks/stripe` | Stripe only. Signature checked |
| GET | `/api/orders/:sessionId` | Order status, polled by the success page |

## Design notes

**Server-side pricing.** Anything the browser sends can be edited, so a checkout endpoint that accepts `price` or `amount` lets people set their own price. Here the client sends `{ productId, quantity }`, the server looks each product up in `server/src/catalog.ts`, checks the quantity against a per-product limit (after merging duplicate lines, so you can't split a line to get around it), and builds the Stripe `line_items` itself. Extra fields in the request are ignored, and there's a test for exactly that. The prices the shop page shows come from `GET /api/products`, so there's one source of truth.

**Fulfil on the webhook, not the redirect.** The success URL proves nothing. Anyone can type `/success?session_id=...`, and a real customer can close the tab before the redirect happens. Stripe's `checkout.session.completed` webhook is signed, and Stripe keeps retrying it (for up to three days in live mode) until we answer 2xx, so that's where the order gets marked fulfilled. The success page just polls `GET /api/orders/:sessionId` until the status changes.

Card payments arrive as `completed` with `payment_status: paid` and are fulfilled straight away. Delayed methods such as bank debits arrive as `unpaid`; the order waits in `awaiting_payment` until `async_payment_succeeded` or `async_payment_failed`. Before fulfilling, the handler also checks that the amount Stripe collected matches the amount we priced, and holds the order as `needs_review` if it doesn't.

**Raw body for signatures.** Stripe signs the exact bytes it sent. If `express.json()` parses the body first, re-serialising it won't match, so the webhook route is registered before the JSON parser with `express.raw()`. A missing or wrong signature gets a 400 and touches nothing.

**Idempotency, twice.**

1. *Creating sessions.* The client makes one key per checkout attempt and sends it as `Idempotency-Key`. The server combines it with a hash of the priced cart and passes that to Stripe, so a double click or a retried request returns the same Checkout Session rather than a second one. If the cart changes, the hash changes, and it's a new attempt.
2. *Handling webhooks.* Stripe delivers at least once, so the same event can arrive twice. Each event ID is inserted into `processed_events` in the same SQLite transaction as the order update. A duplicate is acknowledged and skipped. If the handler throws, the transaction rolls back, Stripe gets a 500 and retries cleanly. Separately, `fulfilled` is a terminal state, so a different event about the same payment (or one arriving out of order) can't fulfil an order twice or undo it.

If the server crashes after creating a session but before saving the order, the webhook rebuilds the order from the cart stored in the session's metadata and re-prices it from the catalogue.

## What it leaves out

Things a real shop would add: auth and customer accounts, stock reservation, receipt emails (the fulfilment step is where they'd go, with their own idempotency), rate limiting on `/api/checkout`, and a proper database instead of a local SQLite file. Stripe Tax and shipping rates would slot into the session params.

## License

MIT
