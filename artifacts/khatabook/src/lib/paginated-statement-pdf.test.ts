import { describe, expect, it } from 'vitest';
import { groupStatementRowsForPagination } from './paginated-statement-pdf';

function row(kind: string): HTMLTableRowElement {
  const element = document.createElement('tr');
  element.dataset.pdfKind = kind;
  return element;
}

describe('statement PDF pagination units', () => {
  it('keeps a date heading with its first entry and the final total with the last entry', () => {
    const rows = [
      row('day'),
      row('entry'),
      row('entry'),
      row('total'),
    ];

    const units = groupStatementRowsForPagination(rows);

    expect(units.map((unit) => unit.map((item) => item.dataset.pdfKind))).toEqual([
      ['day', 'entry'],
      ['entry', 'total'],
    ]);
  });

  it('keeps an empty-state row as a complete pagination unit', () => {
    const emptyRow = row('empty');

    expect(groupStatementRowsForPagination([emptyRow])).toEqual([[emptyRow]]);
  });
});
