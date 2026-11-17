<script setup lang="ts">
import StorePage from './pages/StorePage.vue';
import SuccessPage from './pages/SuccessPage.vue';

// Two pages don't need a router.
const sessionId =
  window.location.pathname === '/success'
    ? new URLSearchParams(window.location.search).get('session_id')
    : null;
</script>

<template>
  <header class="masthead">
    <a href="/" class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      Fieldnote Supply
    </a>
    <span class="test-badge">Stripe test mode</span>
  </header>
  <main>
    <SuccessPage v-if="sessionId" :session-id="sessionId" />
    <StorePage v-else />
  </main>
  <footer class="footer">
    Demo shop. Pay with card 4242 4242 4242 4242, any future date, any CVC.
  </footer>
</template>
