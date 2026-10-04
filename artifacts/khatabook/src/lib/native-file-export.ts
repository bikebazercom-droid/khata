const FILE_EXPORT_MESSAGE = 'banglakhata:file-export';
export const FILE_EXPORT_RESULT_EVENT = 'banglakhata-file-export-result';
const RESPONSE_TIMEOUT_MS = 60_000;

type ReactNativeWebViewBridge = {
  postMessage: (message: string) => void;
};

type NativeFileExportResult = {
  type: typeof FILE_EXPORT_MESSAGE;
  requestId: string;
  ok: boolean;
  copiedText?: boolean;
  error?: string;
};

type NativeFileExportRequest = {
  type: typeof FILE_EXPORT_MESSAGE;
  requestId: string;
  fileName: string;
  mimeType: string;
  title: string;
  base64: string;
  shareText?: string;
};

export type NativeFileShareResult = {
  copiedText: boolean;
};

export type GeneratedFileOptions = {
  fileName: string;
  mimeType: 'application/pdf' | 'text/csv';
  title: string;
  shareText?: string;
};

let requestSequence = 0;

function getNativeBridge(): ReactNativeWebViewBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { ReactNativeWebView?: ReactNativeWebViewBridge }).ReactNativeWebView ?? null;
}

function blobToBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }

    return window.btoa(binary);
  });
}

function postRequestAndWait(
  bridge: ReactNativeWebViewBridge,
  request: NativeFileExportRequest,
): Promise<NativeFileShareResult> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener(FILE_EXPORT_RESULT_EVENT, handleResult);
      window.clearTimeout(timeout);
    };

    const handleResult = (event: Event) => {
      const result = (event as CustomEvent<NativeFileExportResult>).detail;
      if (result?.type !== FILE_EXPORT_MESSAGE || result.requestId !== request.requestId) return;

      cleanup();
      if (!result.ok) {
        reject(new Error(result.error || 'ফাইল তৈরি বা শেয়ার করা যায়নি।'));
        return;
      }
      resolve({ copiedText: Boolean(result.copiedText) });
    };

    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('ফাইল শেয়ারিং সাড়া দেয়নি। আবার চেষ্টা করুন।'));
    }, RESPONSE_TIMEOUT_MS);

    window.addEventListener(FILE_EXPORT_RESULT_EVENT, handleResult);
    try {
      bridge.postMessage(JSON.stringify(request));
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/**
 * Sends a generated PDF or CSV to the Expo app's file system and system share
 * sheet. Returns null in a regular browser so callers can preserve their
 * existing browser share/download behavior.
 */
export async function shareGeneratedFileWithNative(
  blob: Blob,
  options: GeneratedFileOptions,
): Promise<NativeFileShareResult | null> {
  const bridge = getNativeBridge();
  if (!bridge) return null;

  const request: NativeFileExportRequest = {
    type: FILE_EXPORT_MESSAGE,
    requestId: `${Date.now()}-${++requestSequence}`,
    fileName: options.fileName,
    mimeType: options.mimeType,
    title: options.title,
    base64: await blobToBase64(blob),
    ...(options.shareText ? { shareText: options.shareText } : {}),
  };

  return postRequestAndWait(bridge, request);
}