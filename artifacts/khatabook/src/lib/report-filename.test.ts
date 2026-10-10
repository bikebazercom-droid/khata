import { describe, expect, it } from 'vitest';
import { buildPortablePdfFilename } from './report-filename';

describe('buildPortablePdfFilename', () => {
  const fixedDate = new Date('2026-10-10T12:00:00.000Z');

  it('builds an ASCII customer report filename', () => {
    const filename = buildPortablePdfFilename('report', 'customer', fixedDate);

    expect(filename).toBe('BanglaKhata_Customer_Report_2026-10-10.pdf');
    expect(filename).toMatch(/^[\x20-\x7E]+$/);
  });

  it('builds an ASCII supplier statement filename without party-name encoding', () => {
    const filename = buildPortablePdfFilename('statement', 'supplier', fixedDate);

    expect(filename).toBe('BanglaKhata_Supplier_Statement_2026-10-10.pdf');
    expect(filename).toMatch(/^[\x20-\x7E]+$/);
  });
});
