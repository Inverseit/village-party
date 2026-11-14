import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Everything the backend owns (party/server.mjs).
const API = ['/state', '/events', '/api', '/start', '/stop'];

// Where the game server is running. `BACKEND=http://127.0.0.1:8801 VITE_PORT=5184 npm run dev`
// points a dev server at a test instance.
const target = process.env.BACKEND ?? 'http://127.0.0.1:8787';
const proxy = Object.fromEntries(API.map(p => [p, { target, changeOrigin: true, ws: false, timeout: 0, proxyTimeout: 0 }]));

// Two pages: the host screen (index.html, the island) and the phone controller (play.html).
// In dev, /play is served as play.html, the way the game server serves it once built.
const playRoute = { name: 'play-route', configureServer(server) {
  server.middlewares.use((req, _res, next) => { if (/^\/play\/?(\?|$)/.test(req.url)) req.url = '/play.html' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''); next(); });
} };

export default defineConfig({
  plugins: [react(), playRoute],
  cacheDir: process.env.VITE_CACHE || 'node_modules/.vite',
  server: { port: +process.env.VITE_PORT || 5183, strictPort: true, host: true, proxy },
  preview: { proxy },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200,
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), play: resolve(import.meta.dirname, 'play.html') } } },
});
