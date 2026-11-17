import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import Stripe from 'stripe';
import { CATALOG } from './catalog.js';
import { CartError, priceCart, toStripeLineItems } from './pricing.js';
import type { OrderStore } from './store.js';
import { encodeCart, handleStripeEvent, type Logger } from './webhooks.js';

export interface AppOptions {
  stripe: Stripe;
  store: OrderStore;
  webhookSecret: string;
  appUrl: string; // where Stripe redirects back to
  clientDist?: string; // serve the built client from the same origin
  log?: Logger;
}

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{1,250}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

export const consoleLogger: Logger = {
  info: (message, meta) => console.info(message, meta ?? ''),
  warn: (message, meta) => console.warn(message, meta ?? ''),
  error: (message, meta) => console.error(message, meta ?? ''),
};

export function createApp(options: AppOptions): express.Express {
  const { stripe, store, webhookSecret, appUrl, clientDist, log = consoleLogger } = options;
  const app = express();
  app.disable('x-powered-by');

  // The webhook route must see the exact bytes Stripe signed, so it gets a
  // raw body parser and is registered before express.json() runs.
  app.post(
    '/api/webhooks/stripe',
    express.raw({ type: 'application/json', limit: '1mb' }),
    (req: Request, res: Response) => {
      const signature = req.header('stripe-signature');
      if (!signature || !Buffer.isBuffer(req.body)) {
        res.status(400).json({ error: 'Missing signature or body' });
        return;
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
      } catch (err) {
        log.warn('Rejected webhook with bad signature', { reason: (err as Error).message });
        res.status(400).json({ error: 'Invalid signature' });
        return;
      }

      // If the handler throws, this returns a 500 and Stripe retries later.
      const outcome = store.processEventOnce(event.id, event.type, () =>
        handleStripeEvent(event, store, log),
      );
      res.json({ received: true, duplicate: outcome === 'duplicate' });
    },
  );

  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Read-only catalogue for display. Prices shown here are informational;
  // the checkout endpoint looks them up again and never accepts them back.
  app.get('/api/products', (_req, res) => {
    res.json(
      CATALOG.map(({ id, name, description, unitAmount, currency, maxQuantity }) => ({
        id,
        name,
        description,
        unitAmount,
        currency,
        maxQuantity,
      })),
    );
  });

  app.post('/api/checkout', async (req, res) => {
    const cart = priceCart((req.body as { items?: unknown } | undefined)?.items);

    // The client sends one key per checkout attempt, so a double click or a
    // network retry returns the same Checkout Session instead of a second one.
    // The cart fingerprint is part of the key: if the cart changes, it's a
    // new attempt, and Stripe won't reject the different parameters.
    const clientKey = req.header('idempotency-key');
    if (clientKey !== undefined && !IDEMPOTENCY_KEY.test(clientKey)) {
      res.status(400).json({ error: 'Invalid Idempotency-Key header' });
      return;
    }
    const cartFingerprint = createHash('sha256').update(encodeCart(cart.lines)).digest('hex').slice(0, 16);
    const idempotencyKey = `checkout-${clientKey ?? randomUUID()}-${cartFingerprint}`;

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: toStripeLineItems(cart),
        success_url: `${appUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/?checkout=cancelled`,
        // Enough to rebuild the order if our row is ever missing.
        metadata: { cart: encodeCart(cart.lines) },
      },
      { idempotencyKey },
    );

    store.createOrder({
      sessionId: session.id,
      currency: cart.currency,
      amountTotal: cart.total,
      items: cart.lines,
    });

    res.status(201).json({ sessionId: session.id, url: session.url });
  });

  app.get('/api/orders/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    if (!SESSION_ID.test(sessionId)) {
      res.status(400).json({ error: 'Invalid session id' });
      return;
    }
    const order = store.getOrder(sessionId);
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    res.set('Cache-Control', 'no-store');
    res.json({
      sessionId: order.sessionId,
      status: order.status,
      amountTotal: order.amountTotal,
      currency: order.currency,
      items: order.items,
      fulfilledAt: order.fulfilledAt,
    });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (clientDist && existsSync(join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(join(clientDist, 'index.html'));
    });
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof CartError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof Stripe.errors.StripeIdempotencyError) {
      res.status(409).json({ error: 'This checkout is already in progress.' });
      return;
    }
    if (err instanceof Stripe.errors.StripeError) {
      log.error('Stripe API error', { type: err.type, code: err.code, requestId: err.requestId });
      res.status(502).json({ error: 'Payment provider error, please try again.' });
      return;
    }
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed JSON' });
      return;
    }
    log.error('Unhandled error', { message: (err as Error).message });
    res.status(500).json({ error: 'Something went wrong' });
  };
  app.use(onError);

  return app;
}
