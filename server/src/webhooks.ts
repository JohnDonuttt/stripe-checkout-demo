import type Stripe from 'stripe';
import { CartError, priceCart } from './pricing.js';
import type { OrderStore } from './store.js';

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// "notebook-a5:2,pen-fine:1", small enough for session metadata
export function encodeCart(lines: { productId: string; quantity: number }[]): string {
  return lines.map((l) => `${l.productId}:${l.quantity}`).join(',');
}

function decodeCart(value: string | undefined): { productId: string; quantity: number }[] {
  if (!value) return [];
  return value.split(',').map((part) => {
    const [productId = '', qty = ''] = part.split(':');
    return { productId, quantity: Number(qty) };
  });
}

/**
 * Makes sure we have a local order for this session. Normally the row was
 * written by POST /api/checkout. If the server died between creating the
 * session and saving the row, rebuild it from the session's metadata and
 * re-price it from the catalogue.
 */
function ensureOrder(store: OrderStore, session: Stripe.Checkout.Session, log: Logger): void {
  if (store.getOrder(session.id)) return;
  try {
    const cart = priceCart(decodeCart(session.metadata?.cart));
    store.createOrder({
      sessionId: session.id,
      currency: cart.currency,
      amountTotal: cart.total,
      items: cart.lines,
    });
    log.warn('Rebuilt missing order from session metadata', { sessionId: session.id });
  } catch (err) {
    if (!(err instanceof CartError)) throw err;
    // Not one of ours (for example a session made in the Dashboard).
    store.createOrder({
      sessionId: session.id,
      currency: session.currency ?? 'gbp',
      amountTotal: -1,
      items: [],
    });
    log.warn('Webhook for a session with no recognisable cart', { sessionId: session.id });
  }
}

function fulfil(store: OrderStore, session: Stripe.Checkout.Session, log: Logger): void {
  const order = store.getOrder(session.id)!;
  if (order.status === 'fulfilled') return;

  // Line items were built on the server, so the totals should always agree.
  // If they don't (a Dashboard edit, a coupon we never enabled), don't ship.
  if (session.amount_total !== order.amountTotal || session.currency !== order.currency) {
    store.setStatus(session.id, 'needs_review');
    log.error('Paid amount does not match order total', {
      sessionId: session.id,
      expected: order.amountTotal,
      received: session.amount_total,
    });
    return;
  }

  if (store.markFulfilled(session.id)) {
    // In a real shop this is where you'd reserve stock, send the receipt
    // email, or call the warehouse API. Those need their own idempotency too.
    log.info('Order fulfilled', { sessionId: session.id, amountTotal: order.amountTotal });
  }
}

export function handleStripeEvent(event: Stripe.Event, store: OrderStore, log: Logger): void {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      ensureOrder(store, session, log);
      // Cards are 'paid' here. Delayed methods (bank debits, vouchers) are
      // 'unpaid' and settle later with async_payment_succeeded/failed.
      if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
        fulfil(store, session, log);
      } else {
        store.setStatus(session.id, 'awaiting_payment');
      }
      break;
    }
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object;
      ensureOrder(store, session, log);
      fulfil(store, session, log);
      break;
    }
    case 'checkout.session.async_payment_failed': {
      const session = event.data.object;
      ensureOrder(store, session, log);
      store.setStatus(session.id, 'payment_failed');
      log.warn('Delayed payment failed', { sessionId: session.id });
      break;
    }
    case 'checkout.session.expired': {
      store.setStatus(event.data.object.id, 'expired');
      break;
    }
    default:
      // Acknowledge everything else so Stripe doesn't keep retrying it.
      break;
  }
}
