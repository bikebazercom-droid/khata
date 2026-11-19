// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { persistNativePhoneSession } from './nativePhoneSession';
import { verifyOtp } from './phoneAuth';

const EVENT = 'banglakhata-native-phone-session-saved';

afterEach(() => {
  delete window.__BKH_NATIVE_SESSION_STORAGE__;
  delete (window as Window & { ReactNativeWebView?: unknown }).ReactNativeWebView;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function installBridge(ok: boolean) {
  window.__BKH_NATIVE_SESSION_STORAGE__ = true;
  const postMessage = vi.fn((raw: string) => {
    const message = JSON.parse(raw);
    window.dispatchEvent(new CustomEvent(EVENT, {
      detail: { requestId: message.requestId, ok },
    }));
  });
  Object.defineProperty(window, 'ReactNativeWebView', {
    configurable: true,
    value: { postMessage },
  });
  return postMessage;
}

describe('persistent phone login bridge', () => {
  it('leaves browsers and older native apps on their existing cookie flow', async () => {
    await expect(persistNativePhoneSession(undefined)).resolves.toBeUndefined();
  });

  it('sends the verified token to native storage and removes it from the returned identity', async () => {
    const postMessage = installBridge(true);
    const identity = { userId: 'owner', businessId: 'book', authMethod: 'phone' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ...identity, token: 'test-session-token',
    }), { status: 200 }));
    await expect(verifyOtp('01700000000', '123456')).resolves.toEqual(identity);
    expect(JSON.parse(postMessage.mock.calls[0][0])).toMatchObject({
      type: 'banglakhata-native-phone-session', token: 'test-session-token',
    });
  });

  it('reports storage failure rather than claiming the session was saved', async () => {
    installBridge(false);
    await expect(persistNativePhoneSession('test-token')).rejects.toThrow('সংরক্ষণ');
  });

  it('waits for the matching acknowledgement, then times out explicitly', async () => {
    vi.useFakeTimers();
    installBridge(true).mockImplementation(() => {
      window.dispatchEvent(new CustomEvent(EVENT, {
        detail: { requestId: 'another-request', ok: true },
      }));
    });
    const saved = persistNativePhoneSession('test-token');
    const assertion = expect(saved).rejects.toThrow('সময়');
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
  });
});
