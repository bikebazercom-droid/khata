import { describe, expect, it } from 'vitest';
import { isAppNavigation, isShellRequest } from '../../sw-policy.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('service worker network exclusion and scope', () => {
  const origin = 'https://example.test';
  const base = '/khatabook/';
  const assets = ['/khatabook/index.html', '/khatabook/assets/index-v2.js'];
  it('only serves own versioned shell assets', () => {
    expect(isShellRequest(origin + assets[1], origin, base, assets)).toBe(true);
    for (const url of ['/api/auth/me', '/khatabook/api/auth/me', '/khatabook/objects/a', '/admin/', '/khatabook/assets/missing.js']) {
      expect(isShellRequest(origin + url, origin, base, assets)).toBe(false);
    }
    expect(isShellRequest('https://auth.example.test/khatabook/assets/index-v2.js', origin, base, assets)).toBe(false);
  });
  it('falls back for app navigation but not auth, admin, API, other artifacts', () => {
    for (const route of ['', 'party/123', 'party/123/report', 'reports', 'sign-in', 'sign-up']) {
      expect(isAppNavigation(origin + base + route, origin, base)).toBe(true);
    }
    for (const route of ['api/auth/me', 'admin', 'mobile', 'objects/a', 'sign-in/sso-callback']) {
      expect(isAppNavigation(origin + base + route, origin, base)).toBe(false);
    }
    expect(isAppNavigation(origin + '/admin/', origin, base)).toBe(false);
  });
  it('requires atomic asset prefetch, promptly activates updated workers, and removes only old shell versions', () => {
    const build = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(build).toContain('await cache.addAll(ASSETS.map');
    expect(build).toContain('await self.skipWaiting()');
    expect(build).toContain("fetch(new Request(request, { cache: 'no-store' }))");
    expect(build).toContain("entryFileNames: 'assets/[name]-[hash].js'");
    expect(build).toContain("assetFileNames: 'assets/[name]-[hash][extname]'");
    expect(build).toContain('await caches.delete(CACHE)');
    expect(build).toContain('name.startsWith(CACHE_PREFIX) && name !== CACHE');
    expect(build).not.toContain('caches.delete("banglakhata-entry-outbox")');
  });

  it('checks for a fresh worker after registration and reloads only for a new shell version', () => {
    const registration = readFileSync(join(process.cwd(), 'src/lib/registerServiceWorker.ts'), 'utf8');
    const main = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8');
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    const build = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(registration).toContain('registration.update()');
    expect(build).toContain("type: 'banglakhata-shell-version'");
    expect(main).toContain("addEventListener('message'");
    expect(main).toContain("message?.type !== 'banglakhata-shell-version'");
    expect(main).toContain('deferShellReloadDuringAuth');
    expect(main).toContain('window.location.reload()');
    expect(main).toContain('reloadedShellVersion');
    expect(app).toContain('applyPendingShellReload');
    expect(main).not.toContain("addEventListener('controllerchange'");
  });
});