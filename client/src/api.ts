export interface Product {
  id: string;
  name: string;
  description: string;
  unitAmount: number;
  currency: string;
  maxQuantity: number;
}

export type OrderStatus =
  | 'pending'
  | 'awaiting_payment'
  | 'fulfilled'
  | 'payment_failed'
  | 'expired'
  | 'needs_review';

export interface Order {
  sessionId: string;
  status: OrderStatus;
  amountTotal: number;
  currency: string;
  items: { productId: string; name: string; quantity: number; amount: number }[];
  fulfilledAt: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

export function getProducts(): Promise<Product[]> {
  return request('/api/products');
}

// IDs and quantities only. The server decides what things cost.
export function startCheckout(
  items: { productId: string; quantity: number }[],
  idempotencyKey: string,
): Promise<{ sessionId: string; url: string }> {
  return request('/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify({ items }),
  });
}

export function getOrder(sessionId: string): Promise<Order> {
  return request(`/api/orders/${encodeURIComponent(sessionId)}`);
}
