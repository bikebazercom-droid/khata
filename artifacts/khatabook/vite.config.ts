import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const isBuild = process.argv.includes('build');

const rawPort = process.env.PORT;
if (!rawPort && !isBuild) {
  throw new Error('PORT environment variable is required but was not provided.');
}
const port = Number(rawPort ?? '3000');
if (!isBuild && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;
if (!basePath && !isBuild) {
  throw new Error('BASE_PATH environment variable is required but was not provided.');
}

function offlineShell() {
  return {
    name: 'offline-shell',
    apply: 'build' as const,
    async closeBundle() {
      const dir = path.resolve(import.meta.dirname, 'dist/public');
      const sharp = (await import('sharp')).default;
      await sharp(path.resolve(import.meta.dirname, 'public/icon-192.png'))
        .resize(512, 512).png().toFile(path.join(dir, 'icon-512.png'));
      async function files(folder: string): Promise<string[]> {
        const result: string[] = [];
        for (const entry of await readdir(path.join(dir, folder), { withFileTypes: true })) {
          const relative = path.posix.join(folder, entry.name);
          if (entry.isDirectory()) result.push(...await files(relative));
          else if (relative === 'index.html' || relative === 'manifest.webmanifest' ||
            relative === 'logo.svg' || relative === 'logo-icon.svg' || relative === 'icon-192.png' || relative === 'icon-512.png' ||
            relative.startsWith('assets/') || relative.startsWith('fonts/')) result.push(relative);
        }
        return result;
      }
      const assets = (await files('')).sort();
      const content = await Promise.all(assets.map((name) => readFile(path.join(dir, name))));
      const hash = createHash('sha256');
      assets.forEach((name, i) => { hash.update(name); hash.update(content[i]); });
      const version = hash.digest('hex').slice(0, 16);
      const base = (basePath || '/').replace(/\/?$/, '/');
      const urls = assets.map((name) => base + name);
      const policy = await readFile(path.resolve(import.meta.dirname, 'sw-policy.js'), 'utf8');
      const script = `
${policy.replace(/^export /gm, '')}
const BASE = ${JSON.stringify(base)};
const ASSETS = ${JSON.stringify(urls)};
const SHELL = BASE + 'index.html';
const CACHE_PREFIX = 'banglakhata-shell:' + BASE + ':';
const CACHE = CACHE_PREFIX + ${JSON.stringify(version)};
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      // All-or-nothing: never activate a worker with mismatched HTML and JS.
      await cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
      // Do not skipWaiting: existing tabs may still need their old hashed
      // dynamic chunks. Activate only when those tabs have closed.
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !isAppNavigation(request.url, self.location.origin, BASE) && !isShellRequest(request.url, self.location.origin, BASE, ASSETS)) return;
  if (request.mode === 'navigate') {
    if (!isAppNavigation(request.url, self.location.origin, BASE)) return;
    event.respondWith(fetch(request).catch(async () => {
      const cached = await caches.open(CACHE).then(cache => cache.match(SHELL));
      return cached || Response.error();
    }));
  } else if (isShellRequest(request.url, self.location.origin, BASE, ASSETS)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(request)).then(cached => cached || fetch(request)));
  }
});
`;
      await writeFile(path.join(dir, 'sw.js'), script);
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    offlineShell(),
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
