import { computed, reactive, watch } from 'vue';

const STORAGE_KEY = 'cart.v1';

function load(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (parsed && typeof parsed === 'object') {
      return Object.fromEntries(
        Object.entries(parsed).filter(([, qty]) => Number.isInteger(qty) && (qty as number) > 0),
      ) as Record<string, number>;
    }
  } catch {
    // Corrupt or unavailable storage: start empty.
  }
  return {};
}

// productId -> quantity. No prices on purpose.
const quantities = reactive<Record<string, number>>(load());

watch(quantities, (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Private mode etc. The cart still works for this page view.
  }
});

export const cart = {
  quantities,
  count: computed(() => Object.values(quantities).reduce((a, b) => a + b, 0)),
  items: computed(() =>
    Object.entries(quantities).map(([productId, quantity]) => ({ productId, quantity })),
  ),
  set(productId: string, quantity: number) {
    if (quantity <= 0) delete quantities[productId];
    else quantities[productId] = quantity;
  },
  clear() {
    for (const key of Object.keys(quantities)) delete quantities[key];
  },
};
