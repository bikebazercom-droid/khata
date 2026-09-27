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
  it('requires atomic asset prefetch before activation and removes only old shell versions', () => {
    const build = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(build).toContain('await cache.addAll(ASSETS.map');
    expect(build).not.toContain('await self.skipWaiting()');
    expect(build).toContain('await caches.delete(CACHE)');
    expect(build).toContain('name.startsWith(CACHE_PREFIX) && name !== CACHE');
    expect(build).not.toContain('caches.delete("banglakhata-entry-outbox")');
  });
});