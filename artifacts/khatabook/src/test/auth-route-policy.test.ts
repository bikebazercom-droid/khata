import { describe, expect, it } from 'vitest';
import { isPublicAuthRoute, shouldUseOfflineIdentityFallback } from '../lib/auth-route-policy';

describe('public authentication routing', () => {
  it('keeps sign-in and sign-up routes available during connectivity failures', () => {
    for (const path of ['/sign-in', '/sign-in/verify', '/sign-up', '/sign-up/continue']) {
      expect(isPublicAuthRoute(path)).toBe(true);
    }
  });

  it('does not exempt protected or unrelated routes from connectivity gating', () => {
    for (const path of ['/', '/dashboard', '/party/123', '/support', '/sign-in-help']) {
      expect(isPublicAuthRoute(path)).toBe(false);
    }
  });

  it('does not use a saved offline identity to redirect away from authentication routes', () => {
    expect(shouldUseOfflineIdentityFallback('/sign-in')).toBe(false);
    expect(shouldUseOfflineIdentityFallback('/sign-in/verify')).toBe(false);
    expect(shouldUseOfflineIdentityFallback('/sign-up')).toBe(false);
    expect(shouldUseOfflineIdentityFallback('/dashboard')).toBe(true);
  });
});
