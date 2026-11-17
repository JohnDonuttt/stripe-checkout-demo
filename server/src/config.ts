function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. Copy .env.example to .env and fill it in.`);
  return value;
}

export function loadConfig() {
  const stripeSecretKey = required('STRIPE_SECRET_KEY');
  if (stripeSecretKey.startsWith('sk_live_')) {
    throw new Error('Refusing to start with a live Stripe key. This project is meant for test mode.');
  }
  return {
    stripeSecretKey,
    webhookSecret: required('STRIPE_WEBHOOK_SECRET'),
    appUrl: (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/+$/, ''),
    port: Number(process.env.PORT ?? 4242),
    databasePath: process.env.DATABASE_PATH ?? './data/orders.db',
  };
}
