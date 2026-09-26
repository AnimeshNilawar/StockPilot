import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    watch: {
      usePolling: true,
    },
    // The SPA calls `/api/v1` on its own origin and this forwards it to the
    // backend. Same-origin requests sidestep CORS entirely and, because nothing
    // is hardcoded to `localhost`, the app still works when it is opened through
    // 127.0.0.1, a LAN address, or a tunnel. Override the target with
    // VITE_API_PROXY_TARGET when the API is not on the default port.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
