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

const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/rtf': 'rtf',
  'application/zip': 'zip',
  'application/octet-stream': 'bin',
};
const ALLOWED_MIME_TYPES = new Set(Object.keys(MIME_EXTENSIONS));
const IOS_UTI_BY_MIME: Record<string, string> = {
  'application/pdf': 'com.adobe.pdf',
  'image/jpeg': 'public.jpeg',
  'image/png': 'public.png',
  'image/gif': 'com.compuserve.gif',
  'image/webp': 'org.webmproject.webp',
};

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
  const extension = `.${MIME_EXTENSIONS[mimeType]}`;
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
    ...(IOS_UTI_BY_MIME[request.mimeType] ? { UTI: IOS_UTI_BY_MIME[request.mimeType] } : {}),
    dialogTitle: request.title,
  });

  return { copiedText };
}