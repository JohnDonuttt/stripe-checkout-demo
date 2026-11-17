import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    // Same-origin API calls in dev; the server owns everything under /api.
    proxy: { '/api': 'http://localhost:4242' },
  },
});
