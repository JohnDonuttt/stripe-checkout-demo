<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { getProducts, startCheckout, type Product } from '../api';
import { cart } from '../cart';
import { money } from '../format';
import ProductArt from '../components/ProductArt.vue';

const products = ref<Product[]>([]);
const loadError = ref('');
const checkoutError = ref('');
const redirecting = ref(false);
const cancelled = new URLSearchParams(window.location.search).get('checkout') === 'cancelled';

// One key per checkout attempt. Retrying the same cart reuses it, so the
// server hands back the same Stripe session instead of creating another.
let attemptKey: string | null = null;
watch(cart.items, () => (attemptKey = null), { deep: true });

onMounted(async () => {
  try {
    products.value = await getProducts();
    // Drop anything in a saved cart that the shop no longer sells.
    const known = new Set(products.value.map((p) => p.id));
    for (const id of Object.keys(cart.quantities)) if (!known.has(id)) cart.set(id, 0);
  } catch {
    loadError.value = 'Could not load products. Is the API running on port 4242?';
  }
});

const lines = computed(() =>
  products.value
    .filter((p) => cart.quantities[p.id])
    .map((p) => ({ product: p, quantity: cart.quantities[p.id]! })),
);

// Display only. The server prices the order again from its own catalogue.
const estimatedTotal = computed(() =>
  lines.value.reduce((sum, l) => sum + l.product.unitAmount * l.quantity, 0),
);

function add(p: Product) {
  cart.set(p.id, Math.min((cart.quantities[p.id] ?? 0) + 1, p.maxQuantity));
}

async function checkout() {
  checkoutError.value = '';
  redirecting.value = true;
  attemptKey ??= crypto.randomUUID();
  try {
    const { url } = await startCheckout(cart.items.value, attemptKey);
    window.location.assign(url);
  } catch (err) {
    checkoutError.value = err instanceof Error ? err.message : 'Checkout failed.';
    redirecting.value = false;
  }
}
</script>

<template>
  <p v-if="cancelled" class="notice">Checkout cancelled. Your cart is still here.</p>
  <p v-if="loadError" class="notice notice--error">{{ loadError }}</p>

  <div class="store">
    <section aria-labelledby="products-heading">
      <h1 id="products-heading" class="page-title">Desk goods</h1>
      <ul class="grid">
        <li v-for="p in products" :key="p.id" class="card">
          <ProductArt :product-id="p.id" />
          <div class="card-body">
            <div class="card-head">
              <h2>{{ p.name }}</h2>
              <span class="price">{{ money(p.unitAmount, p.currency) }}</span>
            </div>
            <p class="muted">{{ p.description }}</p>
            <button
              class="button button--secondary"
              :disabled="(cart.quantities[p.id] ?? 0) >= p.maxQuantity"
              @click="add(p)"
            >
              {{ (cart.quantities[p.id] ?? 0) >= p.maxQuantity ? 'Limit reached' : 'Add to cart' }}
            </button>
          </div>
        </li>
      </ul>
    </section>

    <aside class="cart" aria-labelledby="cart-heading">
      <h2 id="cart-heading">Cart <span v-if="cart.count.value" class="muted">({{ cart.count.value }})</span></h2>
      <p v-if="!lines.length" class="muted">Nothing here yet.</p>
      <ul v-else class="cart-lines">
        <li v-for="{ product, quantity } in lines" :key="product.id" class="cart-line">
          <div>
            <div>{{ product.name }}</div>
            <div class="muted small">{{ money(product.unitAmount * quantity, product.currency) }}</div>
          </div>
          <div class="stepper" role="group" :aria-label="`Quantity of ${product.name}`">
            <button aria-label="Remove one" @click="cart.set(product.id, quantity - 1)">&minus;</button>
            <span aria-live="polite">{{ quantity }}</span>
            <button
              aria-label="Add one"
              :disabled="quantity >= product.maxQuantity"
              @click="cart.set(product.id, quantity + 1)"
            >
              +
            </button>
          </div>
        </li>
      </ul>
      <div v-if="lines.length" class="cart-total">
        <span>Total</span>
        <strong>{{ money(estimatedTotal) }}</strong>
      </div>
      <button class="button" :disabled="!lines.length || redirecting" @click="checkout">
        {{ redirecting ? 'Opening Stripe…' : 'Checkout' }}
      </button>
      <p v-if="checkoutError" class="error small" role="alert">{{ checkoutError }}</p>
      <p class="muted small">Prices are confirmed by the server before you pay.</p>
    </aside>
  </div>
</template>
