import { File, Paths } from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export const NATIVE_FILE_EXPORT_MESSAGE = 'banglakhata:file-export';
export const NATIVE_FILE_EXPORT_RESULT_EVENT = 'banglakhata-file-export-result';

export type NativeFileExportRequest = {
  type: typeof NATIVE_FILE_EXPORT_MESSAGE;
  requestId: string;
  fileName: string;
  mimeType: string;
  title: string;
  base64: string;
  shareText?: string;
};

export type NativeFileExportResult = {
  type: typeof NATIVE_FILE_EXPORT_MESSAGE;
  requestId: string;
  ok: boolean;
  copiedText?: boolean;
  error?: string;
};

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'text/csv']);

export function parseNativeFileExportRequest(rawMessage: string): NativeFileExportRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  if (value.type !== NATIVE_FILE_EXPORT_MESSAGE || typeof value.requestId !== 'string') return null;

  return {
    type: NATIVE_FILE_EXPORT_MESSAGE,
    requestId: value.requestId,
    fileName: typeof value.fileName === 'string' ? value.fileName : '',
    mimeType: typeof value.mimeType === 'string' ? value.mimeType : '',
    title: typeof value.title === 'string' ? value.title : '',
    base64: typeof value.base64 === 'string' ? value.base64 : '',
    ...(typeof value.shareText === 'string' ? { shareText: value.shareText } : {}),
  };
}

function safeFileName(fileName: string, mimeType: string): string {
  const extension = mimeType === 'application/pdf' ? '.pdf' : '.csv';
  const safeBase = fileName
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .trim()
    .replace(/^\.+/, '');

  if (!safeBase) throw new Error('ফাইলের নাম সঠিক নয়।');
  if (safeBase.toLowerCase().endsWith(extension)) return safeBase;

  const withoutExtension = safeBase.replace(/\.[^.]*$/, '');
  return `${withoutExtension || 'banglakhata-export'}${extension}`;
}

export async function shareNativeWebViewFile(
  request: NativeFileExportRequest,
): Promise<{ copiedText: boolean }> {
  if (Platform.OS === 'web') {
    throw new Error('এই ফাইল শেয়ারিং সুবিধা শুধু Android ও iOS-এ পাওয়া যায়।');
  }
  if (!request.requestId || !request.fileName || !request.title) {
    throw new Error('ফাইলের তথ্য অসম্পূর্ণ।');
  }
  if (!ALLOWED_MIME_TYPES.has(request.mimeType)) {
    throw new Error('এই ধরনের ফাইল শেয়ার করা যাবে না।');
  }
  if (!request.base64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.base64)) {
    throw new Error('ফাইলের ডেটা পড়া যায়নি।');
  }
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('এই ডিভাইসে ফাইল শেয়ার করা যাচ্ছে না।');
  }

  const file = new File(Paths.cache, safeFileName(request.fileName, request.mimeType));
  file.create({ overwrite: true });
  file.write(request.base64, { encoding: 'base64' });

  let copiedText = false;
  if (request.shareText) {
    try {
      await Clipboard.setStringAsync(request.shareText);
      copiedText = true;
    } catch {
      // Sharing the report must still work if the clipboard is unavailable.
    }
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: request.mimeType,
    ...(request.mimeType === 'application/pdf' ? { UTI: 'com.adobe.pdf' } : {}),
    dialogTitle: request.title,
  });

  return { copiedText };
}