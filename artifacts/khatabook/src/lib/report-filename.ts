export type PortableReportKind = 'report' | 'statement';
export type PortableReportAudience = 'customer' | 'supplier';

/**
 * Uses ASCII-only metadata so browsers, Android share providers, and document
 * pickers don't reinterpret Bengali UTF-8 filenames using a legacy encoding.
 */
export function buildPortablePdfFilename(
  kind: PortableReportKind,
  audience?: PortableReportAudience,
  date = new Date(),
): string {
  const role = audience
    ? `_${audience === 'customer' ? 'Customer' : 'Supplier'}`
    : '';
  const documentType = kind === 'statement' ? 'Statement' : 'Report';
  const dateStamp = date.toISOString().slice(0, 10);
  return `BanglaKhata${role}_${documentType}_${dateStamp}.pdf`;
}
