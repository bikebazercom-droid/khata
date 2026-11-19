import { describe, expect, it, vi } from 'vitest';
import { saveWebViewPhoneSession } from './nativePhoneSession';

const raw = JSON.stringify({
  type: 'banglakhata-native-phone-session', requestId: 'request-1', token: 'test-token',
});
const site = 'https://example.com';

describe('WebView phone session secure storage', () => {
  it('acknowledges only after secure storage finishes', async () => {
    let finish!: () => void;
    const accept = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onStored = vi.fn();
    let settled = false;
    const result = saveWebViewPhoneSession(raw, `${site}/sign-in`, site, accept, onStored);
    void result.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(onStored).not.toHaveBeenCalled();
    expect(accept).toHaveBeenCalledWith({ token: 'test-token' });
    finish();
    await expect(result).resolves.toEqual({ requestId: 'request-1', ok: true });
    expect(onStored).toHaveBeenCalledWith('test-token');
  });

  it('rejects untrusted origins and malformed messages without touching storage', async () => {
    const accept = vi.fn();
    for (const [message, source] of [
      [raw, 'https://evil.example'],
      ['not-json', site],
      [JSON.stringify({ type: 'banglakhata-native-phone-session', token: '' }), site],
    ]) {
      await expect(saveWebViewPhoneSession(message, source, site, accept)).resolves.toBeNull();
    }
    expect(accept).not.toHaveBeenCalled();
  });

  it('reports secure storage failures to the web sign-in screen', async () => {
    await expect(saveWebViewPhoneSession(raw, site, site, vi.fn().mockRejectedValue(
      new Error('Storage unavailable'),
    ))).resolves.toEqual({ requestId: 'request-1', ok: false });
  });
});
