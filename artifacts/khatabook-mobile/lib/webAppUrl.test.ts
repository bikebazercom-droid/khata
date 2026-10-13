import { describe, expect, it } from 'vitest';
import { getWebAppUrl, resolveWebAppStartUrl, resolveWebAppUrl } from './webAppUrl';

describe('resolveWebAppUrl', () => {
  it('always returns the hardcoded production site without build-time variables', () => {
    expect(resolveWebAppUrl()).toBe('https://banglakhata.com');
    expect(getWebAppUrl()).toBe('https://banglakhata.com');
  });

  it('always provides a valid absolute HTTPS URL for native WebView loading', () => {
    for (const url of [resolveWebAppStartUrl(true), resolveWebAppStartUrl(false)]) {
      expect(url).toMatch(/^https:\/\/banglakhata\.com\/(dashboard|sign-in)$/);
      expect(new URL(url).protocol).toBe('https:');
      expect(new URL(url).hostname).toBe('banglakhata.com');
    }
  });
});

describe('resolveWebAppStartUrl', () => {
  it('opens the protected dashboard when the native shell has a persisted session', () => {
    expect(resolveWebAppStartUrl(true))
      .toBe('https://banglakhata.com/dashboard');
  });

  it('opens the app sign-in route instead of the public marketing page without a session', () => {
    expect(resolveWebAppStartUrl(false))
      .toBe('https://banglakhata.com/sign-in');
  });
});