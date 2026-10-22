import { describe, expect, it } from 'vitest';
import { resolveClerkClientEnvironment } from '../lib/clerkEnvironment';

describe('Clerk client environment', () => {
  it('uses the explicit external production key and bypasses the Replit proxy', () => {
    expect(resolveClerkClientEnvironment({
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_external',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_replit',
      VITE_CLERK_PROXY_URL: '/api/__clerk',
    })).toEqual({
      publishableKey: 'pk_live_external',
      proxyUrl: undefined,
    });
  });

  it('keeps the Vite key and configured proxy when no external key is set', () => {
    expect(resolveClerkClientEnvironment({
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_replit',
      VITE_CLERK_PROXY_URL: '/api/__clerk',
    })).toEqual({
      publishableKey: 'pk_test_replit',
      proxyUrl: '/api/__clerk',
    });
  });
});
