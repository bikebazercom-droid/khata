import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  write: vi.fn(),
  isAvailableAsync: vi.fn(),
  shareAsync: vi.fn(),
  setStringAsync: vi.fn(),
  requestDirectoryPermissionsAsync: vi.fn(),
  createFileAsync: vi.fn(),
  writeAsStringAsync: vi.fn(),
  platformOS: 'ios',
}));

vi.mock('react-native', () => ({ Platform: { get OS() { return mocks.platformOS; } } }));
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
vi.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: mocks.requestDirectoryPermissionsAsync,
    createFileAsync: mocks.createFileAsync,
    writeAsStringAsync: mocks.writeAsStringAsync,
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
  saveNativeWebViewFile,
  shareNativeWebViewFile,
} from '@/lib/nativeFileExport';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.platformOS = 'ios';
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

  it('saves a downloaded PDF to the Android folder selected by the user', async () => {
    mocks.platformOS = 'android';
    mocks.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: true, directoryUri: 'content://downloads' });
    mocks.createFileAsync.mockResolvedValue('content://downloads/invoice.pdf');
    mocks.writeAsStringAsync.mockResolvedValue(undefined);

    await expect(saveNativeWebViewFile({
      type: NATIVE_FILE_EXPORT_MESSAGE,
      requestId: 'download-1',
      action: 'download',
      fileName: 'invoice.pdf',
      mimeType: 'application/pdf',
      title: 'Invoice',
      base64: 'AQID',
    })).resolves.toEqual({ saved: true });

    expect(mocks.createFileAsync).toHaveBeenCalledWith('content://downloads', 'invoice', 'application/pdf');
    expect(mocks.writeAsStringAsync).toHaveBeenCalledWith(
      'content://downloads/invoice.pdf',
      'AQID',
      { encoding: 'base64' },
    );
  });

  it('reports a cancelled Android folder picker without throwing', async () => {
    mocks.platformOS = 'android';
    mocks.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: false });

    await expect(saveNativeWebViewFile({
      type: NATIVE_FILE_EXPORT_MESSAGE,
      requestId: 'download-2',
      action: 'download',
      fileName: 'invoice.pdf',
      mimeType: 'application/pdf',
      title: 'Invoice',
      base64: 'AQID',
    })).resolves.toEqual({ cancelled: true });

    expect(mocks.createFileAsync).not.toHaveBeenCalled();
  });

  it('opens the iOS share sheet so the user can save the PDF to Files', async () => {
    await expect(saveNativeWebViewFile({
      type: NATIVE_FILE_EXPORT_MESSAGE,
      requestId: 'download-ios-1',
      action: 'download',
      fileName: 'invoice.pdf',
      mimeType: 'application/pdf',
      title: 'Save invoice PDF',
      base64: 'AQID',
    })).resolves.toEqual({ shareSheet: true });

    expect(vi.mocked(Sharing.shareAsync)).toHaveBeenCalledWith(
      'file:///cache/invoice.pdf',
      { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Save invoice PDF' },
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
      action: 'download',
      fileName: 'transactions.csv',
      mimeType: 'text/csv',
      title: 'Transactions',
      base64: 'AQID',
    }))).toMatchObject({
      type: NATIVE_FILE_EXPORT_MESSAGE,
      requestId: 'export-3',
      action: 'download',
      fileName: 'transactions.csv',
      mimeType: 'text/csv',
    });
  });
});