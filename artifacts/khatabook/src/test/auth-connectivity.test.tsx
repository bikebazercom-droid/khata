import { act, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { isNetworkWriteAuthorized, markServerReauthenticated, revokeNetworkWrites, useAuthConnectivity } from '../lib/useAuthConnectivity';

const healthy = { status: 'ok' };
function online() { Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); }

describe('cold auth connectivity gate', () => {
  beforeEach(() => {
    revokeNetworkWrites();
    localStorage.clear();
    online();
    vi.useFakeTimers();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('keeps cached data available when the server probe fails transiently', async () => {
    const oldSnapshot = JSON.stringify({ ts: 1, entries: { '["/api/parties"]': [{ id: 'old-party' }] } });
    const oldIdentity = JSON.stringify({ userId: 'old-actor', businessId: 'old-business' });
    localStorage.setItem('dkhata_offline_view_v2:old', oldSnapshot);
    localStorage.setItem('dkhata_offline_identity_v2', oldIdentity);
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const clear = vi.fn();
    const { result, unmount } = renderHook(() => useAuthConnectivity(clear));
    expect(result.current.phase).toBe('probing'); // no Clerk, SSE, or mutations mounted
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.phase).toBe('offline');
    expect(fetchMock).toHaveBeenCalledWith('/api/healthz', expect.objectContaining({
      cache: 'no-store',
    }));
    expect(isNetworkWriteAuthorized()).toBe(false);
    expect(clear).not.toHaveBeenCalled();
    expect(localStorage.getItem('dkhata_offline_view_v2:old')).toBe(oldSnapshot);
    expect(localStorage.getItem('dkhata_offline_identity_v2')).toBe(oldIdentity);
    unmount();
  });

  it('trusts a successful server probe when WebView reports navigator.onLine=false', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => healthy });
    vi.stubGlobal('fetch', fetchMock);
    const { result, unmount } = renderHook(() => useAuthConnectivity(vi.fn()));
    expect(result.current.phase).toBe('probing');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledWith('/api/healthz', expect.objectContaining({
      cache: 'no-store',
    }));
    expect(result.current.phase).toBe('online');
    unmount();
  });

  it('keeps legacy local data untouched when the API is healthy without an auth session', async () => {
    const oldSnapshot = JSON.stringify({ ts: 1, entries: { '["/api/parties"]': [{ id: 'old-party' }] } });
    const oldIdentity = JSON.stringify({ userId: 'old-actor', businessId: 'old-business' });
    localStorage.setItem('dkhata_offline_view_v2:old', oldSnapshot);
    localStorage.setItem('dkhata_offline_identity_v2', oldIdentity);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => healthy }));
    const clear = vi.fn();
    const { result, unmount } = renderHook(() => useAuthConnectivity(clear));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.phase).toBe('online'); // auth/session state is handled after connectivity
    expect(localStorage.getItem('dkhata_offline_view_v2:old')).toBe(oldSnapshot);
    expect(localStorage.getItem('dkhata_offline_identity_v2')).toBe(oldIdentity);
    expect(isNetworkWriteAuthorized()).toBe(false);
    unmount();
  });

  it('requires a successful new server probe before reconnecting and times out stalled Clerk bootstrap', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue({
      ok: true, json: async () => healthy,
    });
    vi.stubGlobal('fetch', fetch);
    const clear = vi.fn();
    const { result, unmount } = renderHook(() => useAuthConnectivity(clear));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.phase).toBe('offline');
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(result.current.phase).toBe('online');
    expect(isNetworkWriteAuthorized()).toBe(false); // /me probe alone cannot replay drafts
    expect(localStorage.getItem('dkhata_offline_identity_v2')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(8001); });
    expect(result.current.phase).toBe('offline'); // Clerk CDN cannot strand a splash forever
    expect(isNetworkWriteAuthorized()).toBe(false);
    unmount();
  });

  it('allows writes only after a fresh server session and revokes immediately on failure', () => {
    expect(isNetworkWriteAuthorized()).toBe(false);
    markServerReauthenticated();
    expect(isNetworkWriteAuthorized()).toBe(true);
    revokeNetworkWrites();
    expect(isNetworkWriteAuthorized()).toBe(false);
  });
});