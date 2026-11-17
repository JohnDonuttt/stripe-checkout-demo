import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { PricedLine } from './pricing.js';

export type OrderStatus =
  | 'pending' // Checkout Session created, no webhook yet
  | 'awaiting_payment' // completed with a delayed payment method (e.g. bank debit)
  | 'fulfilled'
  | 'payment_failed'
  | 'expired'
  | 'needs_review'; // paid amount didn't match what we priced; a person should look

export interface Order {
  sessionId: string;
  status: OrderStatus;
  currency: string;
  amountTotal: number;
  items: PricedLine[];
  createdAt: string;
  updatedAt: string;
  fulfilledAt: string | null;
}

interface OrderRow {
  session_id: string;
  status: OrderStatus;
  currency: string;
  amount_total: number;
  items_json: string;
  created_at: string;
  updated_at: string;
  fulfilled_at: string | null;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS orders (
    session_id   TEXT PRIMARY KEY,
    status       TEXT NOT NULL,
    currency     TEXT NOT NULL,
    amount_total INTEGER NOT NULL,
    items_json   TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    fulfilled_at TEXT
  );
  CREATE TABLE IF NOT EXISTS processed_events (
    event_id     TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    processed_at TEXT NOT NULL
  );
`;

function toOrder(row: OrderRow): Order {
  return {
    sessionId: row.session_id,
    status: row.status,
    currency: row.currency,
    amountTotal: row.amount_total,
    items: JSON.parse(row.items_json) as PricedLine[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fulfilledAt: row.fulfilled_at,
  };
}

export class OrderStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  createOrder(order: { sessionId: string; currency: string; amountTotal: number; items: PricedLine[] }): void {
    const now = new Date().toISOString();
    // INSERT OR IGNORE: an idempotent retry of POST /api/checkout returns the
    // same session, and the order for it already exists.
    this.db
      .prepare(
        `INSERT OR IGNORE INTO orders
           (session_id, status, currency, amount_total, items_json, created_at, updated_at)
         VALUES (?, 'pending', ?, ?, ?, ?, ?)`,
      )
      .run(order.sessionId, order.currency, order.amountTotal, JSON.stringify(order.items), now, now);
  }

  getOrder(sessionId: string): Order | undefined {
    const row = this.db.prepare('SELECT * FROM orders WHERE session_id = ?').get(sessionId) as
      | OrderRow
      | undefined;
    return row ? toOrder(row) : undefined;
  }

  /**
   * Moves an order to a new status unless it is already fulfilled.
   * Fulfilment is terminal: a late or out-of-order event can't undo it.
   * Returns true when a row changed.
   */
  setStatus(sessionId: string, status: Exclude<OrderStatus, 'fulfilled'>): boolean {
    const result = this.db
      .prepare(
        `UPDATE orders SET status = ?, updated_at = ?
         WHERE session_id = ? AND status NOT IN ('fulfilled', ?)`,
      )
      .run(status, new Date().toISOString(), sessionId, status);
    return result.changes > 0;
  }

  markFulfilled(sessionId: string): boolean {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE orders SET status = 'fulfilled', fulfilled_at = ?, updated_at = ?
         WHERE session_id = ? AND status != 'fulfilled'`,
      )
      .run(now, now, sessionId);
    return result.changes > 0;
  }

  /**
   * Runs `handler` for a webhook event exactly once.
   *
   * The event ID is recorded in the same transaction as the handler's writes.
   * If the handler throws, nothing is recorded and Stripe's retry gets a clean
   * second attempt. If the event was already processed, the handler is skipped.
   */
  processEventOnce(eventId: string, type: string, handler: () => void): 'processed' | 'duplicate' {
    const run = this.db.transaction((): 'processed' | 'duplicate' => {
      const inserted = this.db
        .prepare('INSERT OR IGNORE INTO processed_events (event_id, type, processed_at) VALUES (?, ?, ?)')
        .run(eventId, type, new Date().toISOString());
      if (inserted.changes === 0) return 'duplicate';
      handler();
      return 'processed';
    });
    // IMMEDIATE takes the write lock up front, so two deliveries of the same
    // event racing each other can't both see "not processed yet".
    return run.immediate();
  }

  close(): void {
    this.db.close();
  }
}
