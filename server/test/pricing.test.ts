import { describe, expect, it } from 'vitest';
import { CartError, priceCart, toStripeLineItems } from '../src/pricing.js';

describe('priceCart', () => {
  it('prices from the catalogue and ignores amounts sent by the client', () => {
    const cart = priceCart([
      { productId: 'notebook-a5', quantity: 2, unitAmount: 1, price: 1, amount: 1, currency: 'usd' },
      { productId: 'pen-fine', quantity: 1, unitAmount: 0, name: 'Free pen' },
    ]);

    expect(cart.total).toBe(2 * 1400 + 350);
    expect(cart.currency).toBe('gbp');
    expect(cart.lines).toEqual([
      { productId: 'notebook-a5', name: 'A5 dot-grid notebook', quantity: 2, unitAmount: 1400, amount: 2800 },
      { productId: 'pen-fine', name: 'Fine liner pen', quantity: 1, unitAmount: 350, amount: 350 },
    ]);
  });

  it('builds Stripe line items only from server-side prices', () => {
    const items = toStripeLineItems(priceCart([{ productId: 'desk-mat', quantity: 1, unit_amount: 5 }]));
    expect(items).toEqual([
      {
        quantity: 1,
        price_data: {
          currency: 'gbp',
          unit_amount: 3200,
          product_data: { name: 'Felt desk mat', metadata: { product_id: 'desk-mat' } },
        },
      },
    ]);
  });

  it('merges duplicate lines before applying quantity limits', () => {
    const cart = priceCart([
      { productId: 'pen-fine', quantity: 2 },
      { productId: 'pen-fine', quantity: 3 },
    ]);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.quantity).toBe(5);

    expect(() =>
      priceCart([
        { productId: 'desk-mat', quantity: 2 },
        { productId: 'desk-mat', quantity: 2 },
      ]),
    ).toThrow(/at most 3/);
  });

  it.each([
    ['an empty cart', []],
    ['a non-array', { productId: 'pen-fine', quantity: 1 }],
    ['an unknown product', [{ productId: 'gold-bar', quantity: 1 }]],
    ['a zero quantity', [{ productId: 'pen-fine', quantity: 0 }]],
    ['a negative quantity', [{ productId: 'pen-fine', quantity: -2 }]],
    ['a fractional quantity', [{ productId: 'pen-fine', quantity: 1.5 }]],
    ['a string quantity', [{ productId: 'pen-fine', quantity: '2' }]],
    ['a null item', [null]],
  ])('rejects %s', (_label, input) => {
    expect(() => priceCart(input)).toThrow(CartError);
  });
});
