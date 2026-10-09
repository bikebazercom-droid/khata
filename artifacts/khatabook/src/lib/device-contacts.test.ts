/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canSelectDeviceContacts,
  selectDeviceContacts,
} from './device-contacts';

afterEach(() => {
  Reflect.deleteProperty(window, 'ReactNativeWebView');
  Reflect.deleteProperty(navigator, 'contacts');
});

describe('device contact selection', () => {
  it('collects all batches returned by the native WebView bridge', async () => {
    const postMessage = vi.fn((rawMessage: string) => {
      const request = JSON.parse(rawMessage) as { requestId: string };
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('banglakhata-native-contacts-result', {
          detail: {
            requestId: request.requestId,
            ok: true,
            complete: false,
            contacts: [{ id: '1', name: 'Abul', phone: '01710000000' }],
          },
        }));
        window.dispatchEvent(new CustomEvent('banglakhata-native-contacts-result', {
          detail: {
            requestId: request.requestId,
            ok: true,
            complete: true,
            contacts: [{ id: '2', name: 'রহিম', phone: '' }],
          },
        }));
      }, 0);
    });
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage },
    });

    expect(canSelectDeviceContacts()).toBe(true);
    await expect(selectDeviceContacts()).resolves.toEqual([
      { id: '1', name: 'Abul', phone: '01710000000' },
      { id: '2', name: 'রহিম', phone: '' },
    ]);
    expect(postMessage).toHaveBeenCalledOnce();
  });

  it('explains when a browser has no supported contact picker', async () => {
    expect(canSelectDeviceContacts()).toBe(false);
    await expect(selectDeviceContacts()).rejects.toThrow('নাম দিয়ে ম্যানুয়ালি যোগ করুন');
  });
});
