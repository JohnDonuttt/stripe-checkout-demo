import type Stripe from 'stripe';
import { findProduct } from './catalog.js';

export interface PricedLine {
  productId: string;
  name: string;
  quantity: number;
  unitAmount: number;
  amount: number;
}

export interface PricedCart {
  lines: PricedLine[];
  currency: 'gbp';
  total: number;
}

export class CartError extends Error {
  readonly status = 400;
}

const MAX_DISTINCT_LINES = 20;

/**
 * Turns whatever the browser sent into a priced cart.
 *
 * Only `productId` and `quantity` are read from each item. Anything else the
 * client includes (price, amount, name, currency) is ignored, because the
 * client is not a trusted source for money.
 */
export function priceCart(input: unknown): PricedCart {
  if (!Array.isArray(input) || input.length === 0) {
    throw new CartError('Cart must be a non-empty array of items.');
  }
  if (input.length > MAX_DISTINCT_LINES) {
    throw new CartError(`Cart can have at most ${MAX_DISTINCT_LINES} items.`);
  }

  // Merge duplicate product IDs so [{a,1},{a,2}] becomes {a,3} and the
  // per-product limit can't be dodged by splitting a line.
  const quantities = new Map<string, number>();
  for (const item of input) {
    if (typeof item !== 'object' || item === null) {
      throw new CartError('Each cart item must be an object.');
    }
    const { productId, quantity } = item as Record<string, unknown>;
    if (typeof productId !== 'string' || !findProduct(productId)) {
      throw new CartError(`Unknown product: ${String(productId).slice(0, 64)}`);
    }
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
      throw new CartError(`Quantity for ${productId} must be a positive whole number.`);
    }
    quantities.set(productId, (quantities.get(productId) ?? 0) + quantity);
  }

  const lines: PricedLine[] = [];
  for (const [productId, quantity] of quantities) {
    const product = findProduct(productId)!;
    if (quantity > product.maxQuantity) {
      throw new CartError(`You can order at most ${product.maxQuantity} of ${product.name}.`);
    }
    lines.push({
      productId,
      name: product.name,
      quantity,
      unitAmount: product.unitAmount,
      amount: product.unitAmount * quantity,
    });
  }

  // Stable order makes the idempotency fingerprint independent of how the
  // client happened to order its cart.
  lines.sort((a, b) => a.productId.localeCompare(b.productId));

  return {
    lines,
    currency: 'gbp',
    total: lines.reduce((sum, line) => sum + line.amount, 0),
  };
}

export function toStripeLineItems(cart: PricedCart): Stripe.Checkout.SessionCreateParams.LineItem[] {
  return cart.lines.map((line) => ({
    quantity: line.quantity,
    price_data: {
      currency: cart.currency,
      unit_amount: line.unitAmount,
      product_data: {
        name: line.name,
        metadata: { product_id: line.productId },
      },
    },
  }));
}
