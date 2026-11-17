<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ApiError, getOrder, type Order } from '../api';
import { cart } from '../cart';
import { money } from '../format';

const props = defineProps<{ sessionId: string }>();

const order = ref<Order | null>(null);
const error = ref('');
const gaveUp = ref(false);

const FINAL = new Set(['fulfilled', 'payment_failed', 'expired', 'needs_review']);
const MAX_WAIT_MS = 2 * 60_000;

// Landing here proves nothing: anyone can open /success?session_id=...
// The order only counts once the webhook has marked it, so poll for that.
let timer: ReturnType<typeof setTimeout> | undefined;
const started = Date.now();
let delay = 1000;

async function poll() {
  try {
    order.value = await getOrder(props.sessionId);
    error.value = '';
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
      error.value = 'We could not find that order.';
      return;
    }
    error.value = 'Having trouble reaching the server. Still trying…';
  }
  if (order.value && FINAL.has(order.value.status)) {
    if (order.value.status === 'fulfilled') cart.clear();
    return;
  }
  if (Date.now() - started > MAX_WAIT_MS) {
    gaveUp.value = true;
    return;
  }
  delay = Math.min(delay * 1.5, 5000);
  timer = setTimeout(poll, delay);
}

onMounted(poll);
onBeforeUnmount(() => clearTimeout(timer));

const view = computed(() => {
  switch (order.value?.status) {
    case 'fulfilled':
      return { tone: 'done', title: 'Fulfilled', body: 'Your order is confirmed and on its way.' };
    case 'awaiting_payment':
      return {
        tone: 'wait',
        title: 'Waiting for your bank',
        body: 'This payment method takes a little while to clear. We will fulfil the order once it does.',
      };
    case 'payment_failed':
      return { tone: 'bad', title: 'Payment failed', body: 'Your bank declined the payment. You have not been charged.' };
    case 'expired':
      return { tone: 'bad', title: 'Checkout expired', body: 'This checkout timed out before payment.' };
    case 'needs_review':
      return { tone: 'wait', title: 'Checking your order', body: 'Something did not add up, so a person will check it.' };
    default:
      return {
        tone: 'wait',
        title: 'Payment received, preparing your order',
        body: 'Waiting for Stripe to confirm the payment with our server.',
      };
  }
});
</script>

<template>
  <section class="status-card" :class="`status-card--${view.tone}`" aria-live="polite">
    <div v-if="error && !order" class="status-head">
      <h1>{{ error }}</h1>
      <a href="/" class="button button--secondary">Back to the shop</a>
    </div>
    <template v-else>
      <div class="status-head">
        <span class="status-icon" aria-hidden="true">
          <svg v-if="view.tone === 'done'" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          <svg v-else-if="view.tone === 'bad'" viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" /></svg>
          <span v-else class="spinner"></span>
        </span>
        <div>
          <h1>{{ view.title }}</h1>
          <p class="muted">{{ view.body }}</p>
        </div>
      </div>

      <ol class="steps">
        <li class="steps-item steps-item--done">Payment submitted</li>
        <li class="steps-item" :class="{ 'steps-item--done': order?.status === 'fulfilled' }">
          Confirmed by webhook
        </li>
        <li class="steps-item" :class="{ 'steps-item--done': order?.status === 'fulfilled' }">Fulfilled</li>
      </ol>

      <div v-if="order && order.items.length" class="summary">
        <div v-for="item in order.items" :key="item.productId" class="summary-line">
          <span>{{ item.quantity }} × {{ item.name }}</span>
          <span>{{ money(item.amount, order.currency) }}</span>
        </div>
        <div class="summary-line summary-total">
          <span>Total</span>
          <span>{{ money(order.amountTotal, order.currency) }}</span>
        </div>
      </div>

      <p v-if="error" class="error small">{{ error }}</p>
      <p v-if="gaveUp" class="muted small">
        This is taking longer than usual. Is <code>stripe listen</code> running? Refresh to check again.
      </p>
      <a href="/" class="button button--secondary">Back to the shop</a>
    </template>
  </section>
</template>
