import { describe, expect, it, vi } from 'vitest';
import { createNativePhoneFetchScript } from './nativePhoneFetch';

function page() {
  const fetch = vi.fn().mockResolvedValue(new Response('{}'));
  const window = { fetch, location: { href: 'https://example.test/party/1', origin: 'https://example.test' } };
  const install = (token: string | null) => {
    new Function('window', createNativePhoneFetchScript(token))(window);
  };
  return { window, fetch, install };
}

describe('phone requests after returning to the WebView', () => {
  it('authenticates a new entry POST without relying on a cookie', async () => {
    const p = page();
    p.install('saved-phone-session');
    const body = JSON.stringify({ amount: 100 });
    await p.window.fetch('/api/parties/1/entries', {
      method: 'POST', body, headers: { 'content-type': 'application/json' },
    });
    const [, options] = p.fetch.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.body).toBe(body);
    expect(options.headers.get('authorization')).toBe('Bearer saved-phone-session');
    expect(options.headers.get('x-banglakhata-native-session')).toBe('1');
    expect(options.headers.get('content-type')).toBe('application/json');
  });

  it('never sends the credential to external URLs, static files, or Google exchanges', async () => {
    const p = page();
    p.install('saved-phone-session');
    for (const url of [
      'https://external.test/api/entries', '/assets/icon.png',
      '/api/auth/firebase/session', '/api/auth/supabase/session',
      '/api/auth/phone/send-otp', '/api/auth/phone/verify-otp',
    ]) {
      await p.window.fetch(url);
      expect(p.fetch.mock.lastCall![1].headers.has('authorization')).toBe(false);
    }
  });

  it('keeps the credential across ordinary requests and replaces it without wrapping twice', async () => {
    const p = page();
    p.install('first-session');
    await p.window.fetch('/api/auth/me');
    // Represents new activity after backgrounding; no page or storage reset.
    await p.window.fetch('/api/parties/1/entries', { method: 'POST' });
    expect(p.fetch.mock.lastCall![1].headers.get('authorization')).toBe('Bearer first-session');
    p.install('second-session');
    await p.window.fetch(new Request('https://example.test/api/auth/me'));
    expect(p.fetch).toHaveBeenCalledTimes(3);
    expect(p.fetch.mock.lastCall![1].headers.get('authorization')).toBe('Bearer second-session');
  });

  it('clears the in-memory credential on logout and respects explicit credentials', async () => {
    const p = page();
    p.install('saved-phone-session');
    await p.window.fetch('/api/auth/me', { headers: { Authorization: 'Bearer explicit-token' } });
    expect(p.fetch.mock.lastCall![1].headers.get('authorization')).toBe('Bearer explicit-token');
    await p.window.fetch('/api/auth/me', { credentials: 'omit' });
    expect(p.fetch.mock.lastCall![1].headers.has('authorization')).toBe(false);
    p.install(null);
    await p.window.fetch('/api/auth/me');
    expect(p.fetch.mock.lastCall![1].headers.has('authorization')).toBe(false);
  });
});
