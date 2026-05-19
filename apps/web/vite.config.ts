import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    // Vite 5.4+ blocks unknown Host headers by default to prevent DNS rebinding.
    // Behind Caddy + Cloudflare Tunnel the incoming Host is the public domain,
    // not localhost, so explicitly allow what we know.
    // 'all' is the documented way to disable the check entirely; we use a list
    // so the protection still applies in dev.
    allowedHosts: [
      'localhost',
      '.phnet.me',
      // Add more public hostnames here if you deploy under different domains
    ],
    watch: {
      // WSL/Docker bind-mount HMR — use polling because inotify doesn't always fire
      usePolling: true,
      interval: 500,
    },
  },
});
