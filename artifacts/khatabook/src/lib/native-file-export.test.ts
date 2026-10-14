import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FILE_EXPORT_RESULT_EVENT,
  shareGeneratedFileWithNative,
} from '@/lib/native-file-export';

afterEach(() => {
  delete (window as Window & { ReactNativeWebView?: unknown }).ReactNativeWebView;
});

describe('native file export bridge', () => {
  it('uses the Expo bridge for generated files and returns the native result', async () => {
    const csvText = '\uFEFFতারিখ,পার্টির নাম\r\n২০২৬-১০-১৪,বাংলা ✓\r\n';
    const bridge = {
      postMessage: vi.fn((rawMessage: string) => {
        const request = JSON.parse(rawMessage) as { requestId: string };
        window.dispatchEvent(new CustomEvent(FILE_EXPORT_RESULT_EVENT, {
          detail: {
            type: 'banglakhata:file-export',
            requestId: request.requestId,
            ok: true,
            copiedText: true,
          },
        }));
      }),
    };
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: bridge,
    });

    const result = await shareGeneratedFileWithNative(
      new Blob([csvText], { type: 'text/csv;charset=utf-8' }),
      {
        fileName: 'লেনদেন.csv',
        mimeType: 'text/csv',
        title: 'লেনদেনের রিপোর্ট',
        shareText: 'রিমাইন্ডার',
      },
    );

    expect(result).toEqual({ copiedText: true });
    expect(bridge.postMessage).toHaveBeenCalledOnce();
    const request = JSON.parse(bridge.postMessage.mock.calls[0][0]) as {
      fileName: string;
      mimeType: string;
      base64: string;
      shareText: string;
    };
    const encodedBytes = new Uint8Array(await new Blob([csvText]).arrayBuffer());
    const encodedBinary = Array.from(encodedBytes, (byte) => String.fromCharCode(byte)).join('');
    expect(request).toMatchObject({
      fileName: 'লেনদেন.csv',
      mimeType: 'text/csv',
      base64: window.btoa(encodedBinary),
      shareText: 'রিমাইন্ডার',
    });
  });

  it('returns null in a normal browser so browser downloads remain in control', async () => {
    await expect(
      shareGeneratedFileWithNative(new Blob(['ledger']), {
        fileName: 'ledger.csv',
        mimeType: 'text/csv',
        title: 'Ledger',
      }),
    ).resolves.toBeNull();
  });

  it('rejects a native export error instead of reporting a false success', async () => {
    const bridge = {
      postMessage: vi.fn((rawMessage: string) => {
        const request = JSON.parse(rawMessage) as { requestId: string };
        window.dispatchEvent(new CustomEvent(FILE_EXPORT_RESULT_EVENT, {
          detail: {
            type: 'banglakhata:file-export',
            requestId: request.requestId,
            ok: false,
            error: 'Export failed',
          },
        }));
      }),
    };
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: bridge,
    });

    await expect(
      shareGeneratedFileWithNative(new Blob(['ledger']), {
        fileName: 'ledger.pdf',
        mimeType: 'application/pdf',
        title: 'Ledger',
      }),
    ).rejects.toThrow('Export failed');
  });
});