import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
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

export default defineConfig({
  base: '/',
  plugins: [react(), contentPlugin()],
  build: { outDir: 'dist', assetsDir: 'assets' },
});
