import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { OrderStore } from './store.js';

// .env lives at the repo root; npm workspaces run this from server/.
const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
try {
  process.loadEnvFile(envFile);
} catch {
  // No .env file: rely on the real environment (CI, containers).
}

const config = loadConfig();
const stripe = new Stripe(config.stripeSecretKey, {
  maxNetworkRetries: 2,
  appInfo: { name: 'stripe-checkout-demo' },
});
const store = new OrderStore(config.databasePath);
const app = createApp({
  stripe,
  store,
  webhookSecret: config.webhookSecret,
  appUrl: config.appUrl,
  clientDist: fileURLToPath(new URL('../../client/dist', import.meta.url)),
});

const server = app.listen(config.port, () => {
  console.info(`API listening on http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
