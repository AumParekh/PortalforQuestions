import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'node:path';

const CONTENT_DIR = path.resolve(__dirname, '../content');

function listContentFiles(dir: string, prefix = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return listContentFiles(path.join(dir, entry.name), rel);
    return entry.name.endsWith('.json') ? [rel] : [];
  });
}

// Serves ../content at /content in dev and copies it into dist/content on build,
// plus a generated manifest.json so the app can discover subject and mock files.
function contentPlugin(): Plugin {
  return {
    name: 'frm-content',
    configureServer(server) {
      server.middlewares.use('/content', (req, res, next) => {
        let url: string;
        try {
          url = decodeURIComponent((req.url ?? '/').split('?')[0]);
        } catch {
          next();
          return;
        }
        if (url === '/manifest.json') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(listContentFiles(CONTENT_DIR)));
          return;
        }
        const file = path.join(CONTENT_DIR, url);
        if (!file.startsWith(CONTENT_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      const files = listContentFiles(CONTENT_DIR);
      for (const rel of files) {
        this.emitFile({
          type: 'asset',
          fileName: `content/${rel}`,
          source: fs.readFileSync(path.join(CONTENT_DIR, rel)),
        });
      }
      this.emitFile({ type: 'asset', fileName: 'content/manifest.json', source: JSON.stringify(files) });
    },
  };
}

const YEAR = 60 * 60 * 24 * 365;

// Installable PWA with full offline use. Must come AFTER contentPlugin: in build mode
// vite-plugin-pwa generates the service worker once the bundle (including the emitted
// content/*.json assets) has been written to dist, then globs dist for the precache.
const pwa = VitePWA({
  registerType: 'autoUpdate',
  injectRegister: 'auto', // injects registerSW.js into index.html; no src import needed
  includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
  manifest: {
    id: '/',
    name: 'FRM Part II Study',
    short_name: 'FRM Study',
    description: 'FRM Part II question bank, flashcards and mocks — works offline.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: '#0F172A',
    background_color: '#0F172A',
    icons: [
      { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    // App shell + every content bank (subjects, content/manifest.json, and nested
    // content/flashcards|games|mocks/*.json) are precached for full offline use.
    globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff,woff2}', 'content/**/*.json'],
    maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/content\//],
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: true,
    runtimeCaching: [
      {
        // Safety net for any content file not in the precache manifest.
        urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/content/'),
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'frm-content', cacheableResponse: { statuses: [0, 200] } },
      },
      {
        urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'google-fonts-stylesheets',
          expiration: { maxEntries: 10, maxAgeSeconds: YEAR },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      {
        urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'google-fonts-webfonts',
          expiration: { maxEntries: 40, maxAgeSeconds: YEAR },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
    ],
  },
});

export default defineConfig({
  base: '/',
  plugins: [react(), contentPlugin(), pwa],
  build: { outDir: 'dist', assetsDir: 'assets' },
});
