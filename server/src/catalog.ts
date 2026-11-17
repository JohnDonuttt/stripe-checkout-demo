// The product catalogue lives on the server and nowhere else. The browser
// gets a read-only copy for display, but every amount that reaches Stripe
// comes from this file.

export interface Product {
  id: string;
  name: string;
  description: string;
  unitAmount: number; // pence
  currency: 'gbp';
  maxQuantity: number; // per order
}

export const CATALOG: readonly Product[] = Object.freeze([
  {
    id: 'notebook-a5',
    name: 'A5 dot-grid notebook',
    description: '192 pages of 100gsm paper, lay-flat binding.',
    unitAmount: 1400,
    currency: 'gbp',
    maxQuantity: 10,
  },
  {
    id: 'pen-fine',
    name: 'Fine liner pen',
    description: '0.4mm archival ink that does not bleed through.',
    unitAmount: 350,
    currency: 'gbp',
    maxQuantity: 20,
  },
  {
    id: 'desk-mat',
    name: 'Felt desk mat',
    description: '80 x 30cm wool felt with a non-slip base.',
    unitAmount: 3200,
    currency: 'gbp',
    maxQuantity: 3,
  },
]);

const byId = new Map(CATALOG.map((p) => [p.id, p]));

export function findProduct(id: string): Product | undefined {
  return byId.get(id);
}
