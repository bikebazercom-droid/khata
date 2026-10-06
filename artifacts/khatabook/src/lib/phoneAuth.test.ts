// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMe } from './phoneAuth';

describe('native WebView auth bootstrap', () => {
  afterEach(() => {
    delete window.__BKH_NATIVE_AUTH_BOOTSTRAP__;
    delete (window as Window & { ReactNativeWebView?: unknown }).ReactNativeWebView;
    vi.restoreAllMocks();
  });

  it('uses the verified bootstrap identity and tells the native shell the cookie exchange completed', async () => {
    const identity = {
      userId: 'owner-1',
      businessId: 'business-1',
      authMethod: 'clerk' as const,
      role: 'owner' as const,
    };
    const postMessage = vi.fn();
    const webFetch = vi.spyOn(globalThis, 'fetch');
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage },
    });
    window.__BKH_NATIVE_AUTH_BOOTSTRAP__ = Promise.resolve({
      ok: true,
      status: 200,
      data: identity,
    });

    await expect(fetchMe()).resolves.toEqual(identity);
    expect(webFetch).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({ type: 'banglakhata-native-auth-ready' }),
    );
  });

  it('rejects a revoked native session instead of falling back to a signed-out landing state', async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage },
    });
    window.__BKH_NATIVE_AUTH_BOOTSTRAP__ = Promise.resolve({
      ok: false,
      status: 401,
    });

    await expect(fetchMe()).rejects.toMatchObject({ status: 401 });
    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({ type: 'banglakhata-native-auth-rejected' }),
    );
  });
});
