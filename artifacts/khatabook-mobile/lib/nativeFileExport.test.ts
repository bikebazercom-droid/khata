import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  write: vi.fn(),
  isAvailableAsync: vi.fn(),
  shareAsync: vi.fn(),
  setStringAsync: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    uri: string;
    create = mocks.create;
    write = mocks.write;

    constructor(...parts: string[]) {
      this.uri = parts.join('/');
    }
  },
}));
vi.mock('expo-sharing', () => ({
  isAvailableAsync: mocks.isAvailableAsync,
  shareAsync: mocks.shareAsync,
}));
vi.mock('expo-clipboard', () => ({
  setStringAsync: mocks.setStringAsync,
}));

import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import {
  NATIVE_FILE_EXPORT_MESSAGE,
  parseNativeFileExportRequest,
  shareNativeWebViewFile,
} from '@/lib/nativeFileExport';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAvailableAsync.mockResolvedValue(true);
  mocks.shareAsync.mockResolvedValue(undefined);
  mocks.setStringAsync.mockResolvedValue(undefined);
});

describe('native WebView file export', () => {
  it('saves a generated file to cache and opens the system share sheet', async () => {
    const request = {
      type: 'banglakhata:file-export' as const,
      requestId: 'export-1',
      fileName: 'বাংলা/ledger.pdf',
      mimeType: 'application/pdf',
      title: 'হিসাবের রিপোর্ট',
      base64: 'AQID',
      shareText: 'রিমাইন্ডারের লেখা',
    };

    await expect(shareNativeWebViewFile(request)).resolves.toEqual({ copiedText: true });

    expect(mocks.create).toHaveBeenCalledWith({ overwrite: true });
    expect(mocks.write).toHaveBeenCalledWith('AQID', { encoding: 'base64' });
    expect(vi.mocked(Clipboard.setStringAsync)).toHaveBeenCalledWith('রিমাইন্ডারের লেখা');
    expect(vi.mocked(Sharing.shareAsync)).toHaveBeenCalledWith(
      'file:///cache/বাংলা_ledger.pdf',
      {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
        dialogTitle: 'হিসাবের রিপোর্ট',
      },
    );
  });

  it('shares an attached image with its image MIME type and extension', async () => {
    await expect(shareNativeWebViewFile({
      type: NATIVE_FILE_EXPORT_MESSAGE,
      requestId: 'attachment-1',
      fileName: 'attachment.jpg',
      mimeType: 'image/jpeg',
      title: 'সংযুক্ত ফাইল শেয়ার করুন',
      base64: 'AQID',
    })).resolves.toEqual({ copiedText: false });

    expect(mocks.write).toHaveBeenCalledWith('AQID', { encoding: 'base64' });
    expect(vi.mocked(Sharing.shareAsync)).toHaveBeenCalledWith(
      'file:///cache/attachment.jpg',
      { mimeType: 'image/jpeg', UTI: 'public.jpeg', dialogTitle: 'সংযুক্ত ফাইল শেয়ার করুন' },
    );
  });

  it('rejects unsupported file types before writing or sharing', async () => {
    await expect(shareNativeWebViewFile({
      type: NATIVE_FILE_EXPORT_MESSAGE,
      requestId: 'export-2',
      fileName: 'script.html',
      mimeType: 'text/html',
      title: 'File',
      base64: 'AQID',
    })).rejects.toThrow('এই ধরনের ফাইল শেয়ার করা যাবে না।');

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.shareAsync).not.toHaveBeenCalled();
  });

  it('parses only messages from the export bridge', () => {
    expect(parseNativeFileExportRequest('not-a-native-export-request')).toBeNull();
    expect(parseNativeFileExportRequest(JSON.stringify({
      type: NATIVE_FILE_EXPORT_MESSAGE,
      requestId: 'export-3',
      fileName: 'transactions.csv',
      mimeType: 'text/csv',
      title: 'Transactions',
      base64: 'AQID',
    }))).toMatchObject({
      type: NATIVE_FILE_EXPORT_MESSAGE,
      requestId: 'export-3',
      fileName: 'transactions.csv',
      mimeType: 'text/csv',
    });
  });
});