<script setup lang="ts">
defineProps<{ productId: string }>();
</script>

<template>
  <div class="art" :class="`art--${productId}`" aria-hidden="true">
    <svg v-if="productId === 'notebook-a5'" viewBox="0 0 120 90">
      <rect x="38" y="12" width="46" height="66" rx="3" fill="currentColor" />
      <rect x="76" y="12" width="4" height="66" fill="var(--art-accent)" />
      <g fill="var(--art-accent)" opacity=".55">
        <circle cx="48" cy="26" r="1.4" /><circle cx="56" cy="26" r="1.4" /><circle cx="64" cy="26" r="1.4" />
        <circle cx="48" cy="34" r="1.4" /><circle cx="56" cy="34" r="1.4" /><circle cx="64" cy="34" r="1.4" />
      </g>
    </svg>
    <svg v-else-if="productId === 'pen-fine'" viewBox="0 0 120 90">
      <g transform="rotate(-35 60 45)">
        <rect x="22" y="40" width="64" height="10" rx="2" fill="currentColor" />
        <rect x="70" y="40" width="4" height="10" fill="var(--art-accent)" />
        <path d="M86 40 L98 45 L86 50 Z" fill="var(--art-accent)" />
      </g>
    </svg>
    <svg v-else viewBox="0 0 120 90">
      <rect x="14" y="30" width="92" height="34" rx="6" fill="currentColor" />
      <rect x="14" y="60" width="92" height="4" rx="2" fill="var(--art-accent)" opacity=".6" />
    </svg>
  </div>
</template>

<style scoped>
.art {
  aspect-ratio: 4 / 3;
  border-radius: var(--radius);
  display: grid;
  place-items: center;
}
.art svg {
  width: 72%;
}
.art--notebook-a5 {
  background: #e7dfcf;
  color: #234e3c;
  --art-accent: #f4efe4;
}
.art--pen-fine {
  background: #dfe5ea;
  color: #1d2a38;
  --art-accent: #c8553d;
}
.art--desk-mat {
  background: #ebe1db;
  color: #6b6159;
  --art-accent: #3b342f;
}
</style>
