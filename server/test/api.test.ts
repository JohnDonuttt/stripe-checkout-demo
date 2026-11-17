import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { OrderStore } from '../src/store.js';
import type { Logger } from '../src/webhooks.js';

const WEBHOOK_SECRET = 'whsec_test_secret';
const SESSION_ID = 'cs_test_a1b2c3';

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

let stripe: Stripe;
let store: OrderStore;
let server: Server;
let baseUrl: string;
let createSession: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  // A real Stripe client, so signature checks use the SDK's own code. No
  // request leaves the machine: the one network call is replaced below.
  stripe = new Stripe('sk_test_not_a_real_key');
  createSession = vi.fn(async () => ({ id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3' }));
  vi.spyOn(stripe.checkout.sessions, 'create').mockImplementation(createSession as never);

  store = new OrderStore(':memory:');
  const app = createApp({ stripe, store, webhookSecret: WEBHOOK_SECRET, appUrl: 'http://shop.test', log: silent });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  store.close();
  vi.restoreAllMocks();
});

function checkout(items: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ items }),
  });
}

function sessionEvent(
  id: string,
  type: string,
  session: Partial<Stripe.Checkout.Session> = {},
): string {
  return JSON.stringify({
    id,
    object: 'event',
    type,
    api_version: '2025-01-01',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: SESSION_ID,
        object: 'checkout.session',
        amount_total: 3150,
        currency: 'gbp',
        payment_status: 'paid',
        metadata: { cart: 'notebook-a5:2,pen-fine:1' },
        ...session,
      },
    },
  });
}

function sendWebhook(payload: string, signature?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== undefined) headers['stripe-signature'] = signature;
  return fetch(`${baseUrl}/api/webhooks/stripe`, { method: 'POST', headers, body: payload });
}

function signed(payload: string, secret = WEBHOOK_SECRET) {
  return sendWebhook(payload, stripe.webhooks.generateTestHeaderString({ payload, secret }));
}

async function orderStatus() {
  const res = await fetch(`${baseUrl}/api/orders/${SESSION_ID}`);
  return (await res.json()) as { status: string; fulfilledAt: string | null; amountTotal: number };
}

describe('POST /api/checkout', () => {
  it('sends Stripe server-side prices, whatever the client claims', async () => {
    const res = await checkout([
      { productId: 'notebook-a5', quantity: 2, unitAmount: 1, price: 0.01 },
      { productId: 'pen-fine', quantity: 1, amount: 0 },
    ]);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ sessionId: SESSION_ID, url: expect.stringContaining('checkout.stripe.com') });

    const [params, requestOptions] = createSession.mock.calls[0] as [
      Stripe.Checkout.SessionCreateParams,
      Stripe.RequestOptions,
    ];
    expect(params.mode).toBe('payment');
    expect(params.line_items?.map((l) => [l.quantity, l.price_data?.unit_amount])).toEqual([
      [2, 1400],
      [1, 350],
    ]);
    expect(params.success_url).toBe('http://shop.test/success?session_id={CHECKOUT_SESSION_ID}');
    expect(params.cancel_url).toBe('http://shop.test/?checkout=cancelled');
    expect(requestOptions.idempotencyKey).toMatch(/^checkout-/);

    const order = await orderStatus();
    expect(order).toMatchObject({ status: 'pending', amountTotal: 3150 });
  });

  it('derives a stable idempotency key from the client key and the cart', async () => {
    const headers = { 'idempotency-key': 'attempt-1234567890' };
    await checkout([{ productId: 'pen-fine', quantity: 1 }], headers);
    await checkout([{ productId: 'pen-fine', quantity: 1 }], headers);
    await checkout([{ productId: 'pen-fine', quantity: 2 }], headers);

    const keys = createSession.mock.calls.map((call) => (call[1] as Stripe.RequestOptions).idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('rejects unknown products without calling Stripe', async () => {
    const res = await checkout([{ productId: 'gold-bar', quantity: 1, unitAmount: 1 }]);
    expect(res.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/stripe', () => {
  beforeEach(async () => {
    await checkout([
      { productId: 'notebook-a5', quantity: 2 },
      { productId: 'pen-fine', quantity: 1 },
    ]);
  });

  it('returns 400 for a missing signature', async () => {
    const res = await sendWebhook(sessionEvent('evt_1', 'checkout.session.completed'));
    expect(res.status).toBe(400);
    expect((await orderStatus()).status).toBe('pending');
  });

  it('returns 400 for a signature made with the wrong secret', async () => {
    const res = await signed(sessionEvent('evt_1', 'checkout.session.completed'), 'whsec_attacker');
    expect(res.status).toBe(400);
    expect((await orderStatus()).status).toBe('pending');
  });

  it('returns 400 when the body was changed after signing', async () => {
    const payload = sessionEvent('evt_1', 'checkout.session.completed');
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    const res = await sendWebhook(payload.replace('"amount_total":3150', '"amount_total":1'), header);
    expect(res.status).toBe(400);
  });

  it('fulfils the order on a valid checkout.session.completed', async () => {
    const res = await signed(sessionEvent('evt_1', 'checkout.session.completed'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: false });

    const order = await orderStatus();
    expect(order.status).toBe('fulfilled');
    expect(order.fulfilledAt).toEqual(expect.any(String));
  });

  it('treats a redelivered event as a no-op', async () => {
    const payload = sessionEvent('evt_1', 'checkout.session.completed');
    await signed(payload);
    const first = await orderStatus();

    const again = await signed(payload);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ received: true, duplicate: true });

    const second = await orderStatus();
    expect(second.fulfilledAt).toBe(first.fulfilledAt);
  });

  it('does not fulfil twice when a different event reports the same payment', async () => {
    await signed(sessionEvent('evt_1', 'checkout.session.completed'));
    const first = await orderStatus();
    await signed(sessionEvent('evt_2', 'checkout.session.async_payment_succeeded'));
    expect((await orderStatus()).fulfilledAt).toBe(first.fulfilledAt);
  });

  it('waits for async_payment_succeeded when the payment is delayed', async () => {
    await signed(sessionEvent('evt_1', 'checkout.session.completed', { payment_status: 'unpaid' }));
    expect((await orderStatus()).status).toBe('awaiting_payment');

    await signed(sessionEvent('evt_2', 'checkout.session.async_payment_succeeded'));
    expect((await orderStatus()).status).toBe('fulfilled');
  });

  it('marks the order failed on async_payment_failed', async () => {
    await signed(sessionEvent('evt_1', 'checkout.session.completed', { payment_status: 'unpaid' }));
    await signed(sessionEvent('evt_2', 'checkout.session.async_payment_failed', { payment_status: 'unpaid' }));
    expect((await orderStatus()).status).toBe('payment_failed');
  });

  it('holds the order for review if the paid amount does not match', async () => {
    await signed(sessionEvent('evt_1', 'checkout.session.completed', { amount_total: 100 }));
    const order = await orderStatus();
    expect(order.status).toBe('needs_review');
    expect(order.fulfilledAt).toBeNull();
  });

  it('rebuilds a missing order from session metadata and re-prices it', async () => {
    const otherSession = 'cs_test_missing';
    const payload = sessionEvent('evt_1', 'checkout.session.completed', {
      id: otherSession,
      amount_total: 1400,
      metadata: { cart: 'notebook-a5:1' },
    });
    await signed(payload);
    const res = await fetch(`${baseUrl}/api/orders/${otherSession}`);
    expect(await res.json()).toMatchObject({ status: 'fulfilled', amountTotal: 1400 });
  });

  it('acknowledges event types it does not handle', async () => {
    const res = await signed(JSON.stringify({ id: 'evt_x', object: 'event', type: 'customer.created', data: { object: {} } }));
    expect(res.status).toBe(200);
  });
});

describe('GET /api/orders/:sessionId', () => {
  it('rejects malformed ids and 404s unknown ones', async () => {
    expect((await fetch(`${baseUrl}/api/orders/not-a-session`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/orders/cs_test_unknown`)).status).toBe(404);
  });
});
