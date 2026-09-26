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