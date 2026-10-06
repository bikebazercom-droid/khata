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

  it('rejects missing, malformed, insecure, or credential-bearing URLs', () => {
    expect(resolveWebAppUrl()).toBeNull();
    expect(resolveWebAppUrl('not a URL', undefined)).toBeNull();
    expect(resolveWebAppUrl('http://ledger.example.com', undefined)).toBeNull();
    expect(resolveWebAppUrl('https://user:password@ledger.example.com', undefined)).toBeNull();
    expect(resolveWebAppUrl('javascript:alert(1)', undefined)).toBeNull();
  });
});

describe('resolveWebAppStartUrl', () => {
  it('opens the protected dashboard when the native shell has a persisted session', () => {
    expect(resolveWebAppStartUrl('https://ledger.example.com/mobile/', true))
      .toBe('https://ledger.example.com/mobile/dashboard');
  });

  it('keeps the public root when the native shell has no session', () => {
    expect(resolveWebAppStartUrl('https://ledger.example.com/', false))
      .toBe('https://ledger.example.com/');
  });
});