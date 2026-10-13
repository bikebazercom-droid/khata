import { describe, expect, it } from 'vitest';
import { resolveWebAppStartUrl, resolveWebAppUrl } from './webAppUrl';

describe('resolveWebAppUrl', () => {
  it('uses an explicit website URL when configured', () => {
    expect(resolveWebAppUrl('https://ledger.example.com/mobile', 'dev.example.com'))
      .toBe('https://ledger.example.com/mobile');
  });

  it('loads the website root on the configured Replit domain', () => {
    expect(resolveWebAppUrl(undefined, 'dev.example.com'))
      .toBe('https://dev.example.com/');
  });

  it('normalizes a URL-form deployment domain', () => {
    expect(resolveWebAppUrl(undefined, 'https://dev.example.com/khatabook'))
      .toBe('https://dev.example.com/');
  });

  it('falls back to the deployment domain when the explicit URL is an undefined placeholder', () => {
    expect(resolveWebAppUrl('undefined', 'banglakhata.com'))
      .toBe('https://banglakhata.com/');
  });

  it('uses the production website when the explicit URL is an undefined placeholder and no domain is set', () => {
    expect(resolveWebAppUrl('undefined')).toBe('https://banglakhata.com/');
  });

  it('uses the production website when values are missing, malformed, insecure, or credential-bearing', () => {
    const fallback = 'https://banglakhata.com/';
    expect(resolveWebAppUrl()).toBe(fallback);
    expect(resolveWebAppUrl('not a URL', undefined)).toBe(fallback);
    expect(resolveWebAppUrl('http://ledger.example.com', undefined)).toBe(fallback);
    expect(resolveWebAppUrl('https://user:password@ledger.example.com', undefined)).toBe(fallback);
    expect(resolveWebAppUrl('javascript:alert(1)', undefined)).toBe(fallback);
    expect(resolveWebAppUrl('https://null/', 'none')).toBe(fallback);
  });
});

describe('resolveWebAppStartUrl', () => {
  it('opens the protected dashboard when the native shell has a persisted session', () => {
    expect(resolveWebAppStartUrl('https://ledger.example.com/mobile/', true))
      .toBe('https://ledger.example.com/mobile/dashboard');
  });

  it('opens the app sign-in route instead of the public marketing page without a session', () => {
    expect(resolveWebAppStartUrl('https://ledger.example.com/', false))
      .toBe('https://ledger.example.com/sign-in');
  });

  it('preserves a configured app base path when opening sign-in', () => {
    expect(resolveWebAppStartUrl('https://ledger.example.com/mobile/', false))
      .toBe('https://ledger.example.com/mobile/sign-in');
  });
});