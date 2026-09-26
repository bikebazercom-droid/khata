/** Minimal file surface so PDF checks can be tested without a native runtime. */
type PdfFile = {
  exists: boolean;
  size: number;
  open(): { readBytes(length: number): Uint8Array; close(): void };
};

export function assertPdfFile(file: PdfFile): void {
  if (!file.exists || file.size < 5) {
    throw new Error('The report PDF is missing or empty.');
  }
  const handle = file.open();
  try {
    const header = handle.readBytes(5);
    if (header.length !== 5 || ![37, 80, 68, 70, 45].every((byte, i) => header[i] === byte)) {
      throw new Error('The report file is not a PDF.');
    }
  } finally {
    handle.close();
  }
}

export function reportPdfName(partyId: string, partyName: string): string {
  // ASCII-only names collapsed Bengali party names to the same underscores.
  const name = partyName.replace(/[^\p{L}\p{M}\p{N}_-]/gu, '_').slice(0, 60) || 'report';
  const id = partyId.replace(/[^a-z0-9_-]/gi, '_');
  return `${id}_${name}_report.pdf`;
}

type SharingApi = {
  isAvailableAsync(): Promise<boolean>;
  shareAsync(uri: string, options: {
    mimeType: string;
    UTI: string;
    dialogTitle: string;
  }): Promise<void>;
};

export async function shareReportPdf(
  uri: string,
  file: PdfFile,
  sharing: SharingApi,
): Promise<'unavailable' | 'dismissed'> {
  if (!await sharing.isAvailableAsync()) return 'unavailable';
  // Recheck at share time: the alert's action can run after generation.
  assertPdfFile(file);
  await sharing.shareAsync(uri, {
    mimeType: 'application/pdf', // Android ACTION_SEND
    UTI: 'com.adobe.pdf',        // iOS activity sheet
    dialogTitle: 'শেয়ার করুন — WhatsApp, SMS, ইত্যাদি',
  });
  // Expo resolves on both completion and cancellation. Never claim delivery.
  return 'dismissed';
}

// SDK 54's legacy copyAsync converts a file:// destination with toFile();
// the modern File.copy also uses javaFile.copyRecursively. Neither can copy
// a private file to SAF. Legacy SAF writing requires a whole base64 string.
// Bound it BEFORE reading (10 MiB PDF => ~14 MiB base64, plus bridge copies).
export const MAX_FOLDER_PDF_BYTES = 10 * 1024 * 1024;

type FolderApi = {
  requestDirectoryPermissionsAsync(): Promise<{ granted: boolean; directoryUri?: string }>;
  createFileAsync(directory: string, name: string, mime: string): Promise<string>;
  readAsStringAsync(uri: string, options: { encoding: 'base64' }): Promise<string>;
  writeAsStringAsync(uri: string, data: string, options: { encoding: 'base64' }): Promise<void>;
  deleteAsync(uri: string, options: { idempotent: boolean }): Promise<void>;
  getInfoAsync(uri: string): Promise<{ exists: boolean }>;
};

export class FolderPdfError extends Error {
  readonly cleanupFailed: boolean;
  constructor(message: string, cleanupFailed = false) {
    super(message);
    this.name = 'FolderPdfError';
    this.cleanupFailed = cleanupFailed;
  }
}

/** Only creates a new external document; never moves/deletes the private PDF. */
export async function saveReportPdfToFolder(
  platform: string, uri: string, file: PdfFile,
  partyId: string, partyName: string, api: FolderApi,
): Promise<'unsupported' | 'not-granted' | 'saved'> {
  if (platform !== 'android') return 'unsupported';
  assertPdfFile(file);
  if (!Number.isFinite(file.size) || file.size > MAX_FOLDER_PDF_BYTES) {
    throw new FolderPdfError('ফোল্ডারে সেভ করার সীমা ১০ MiB। তারিখের পরিসর ছোট করুন অথবা “শেয়ার করুন” ব্যবহার করুন।');
  }
  let destination: string | undefined;
  try {
    const permission = await api.requestDirectoryPermissionsAsync();
    // Android returns granted:false for both cancel and a declined grant.
    if (!permission.granted) return 'not-granted';
    if (!permission.directoryUri) throw new Error('Missing folder URI');
    assertPdfFile(file);
    if (!Number.isFinite(file.size) || file.size > MAX_FOLDER_PDF_BYTES) {
      throw new FolderPdfError('ফোল্ডারে সেভ করার সীমা ১০ MiB। ছোট রিপোর্ট তৈরি করুন বা শেয়ার করুন।');
    }
    const data = await api.readAsStringAsync(uri, { encoding: 'base64' });
    // Read before creating so a read failure cannot leave an empty document.
    // SAF adds the extension from the MIME type; the provider may suffix duplicates.
    destination = await api.createFileAsync(
      permission.directoryUri, reportPdfName(partyId, partyName).replace(/\.pdf$/, ''), 'application/pdf',
    );
    await api.writeAsStringAsync(destination, data, { encoding: 'base64' });
    return 'saved';
  } catch (error) {
    let cleanupFailed = false;
    if (destination) {
      try {
        await api.deleteAsync(destination, { idempotent: true });
        // Legacy native delete ignores DocumentFile.delete()'s boolean result.
        cleanupFailed = (await api.getInfoAsync(destination)).exists;
      } catch {
        cleanupFailed = true;
      }
    }
    if (error instanceof FolderPdfError && !destination) throw error;
    throw new FolderPdfError(
      'ফোল্ডারে PDF সেভ হয়নি। ফাঁকা জায়গা, ফোল্ডারের লেখার অনুমতি ও ফাইল সেবার সংযোগ পরীক্ষা করে আবার চেষ্টা করুন। অ্যাপের নিজস্ব কপিটি অক্ষত আছে।'
      + (cleanupFailed ? ' নির্বাচিত ফোল্ডারে অসম্পূর্ণ ফাইল থাকতে পারে; Files অ্যাপ দিয়ে সেটি মুছুন।' : ''),
      cleanupFailed,
    );
  }
}