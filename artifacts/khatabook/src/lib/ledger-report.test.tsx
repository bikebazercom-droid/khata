import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LedgerReportDocument } from './ledger-report';

describe('LedgerReportDocument', () => {
  it('centers statement headings and transaction cells with middle vertical alignment', () => {
    const { container } = render(
      <LedgerReportDocument
        storeName="Shop"
        party={{ name: 'Customer', phone: '', currentBalance: 500, balanceType: 'YOU_WILL_GET' }}
        entries={[{
          id: 'entry-1',
          type: 'YOU_GAVE',
          amount: 500,
          description: 'Long transaction details',
          billReference: null,
          dueDate: '2026-10-10',
          createdAt: '2026-10-10T15:22:00.000Z',
          balanceAfter: 500,
        }]}
      />,
    );

    const headers = Array.from(container.querySelectorAll<HTMLTableCellElement>('table:not([role="presentation"]) thead th'));
    const row = container.querySelector<HTMLTableRowElement>('tr[data-entry-id="entry-1"]');
    expect(headers.length).toBeGreaterThan(0);
    expect(headers.every((cell) =>
      cell.style.textAlign === 'center'
      && cell.style.verticalAlign === 'middle'
      && cell.style.padding === '8px 6px',
    )).toBe(true);
    expect(Array.from(row?.cells ?? []).every((cell) =>
      cell.style.textAlign === 'center'
      && cell.style.verticalAlign === 'middle'
      && cell.style.paddingTop === '8px',
    )).toBe(true);
  });

  it('prints a date-only value in the statement Date column', () => {
    const { container } = render(
      <LedgerReportDocument
        storeName="Shop"
        party={{
          name: 'Customer',
          phone: '',
          currentBalance: 0,
          balanceType: 'YOU_WILL_GET',
        }}
        entries={[{
          id: 'entry-1',
          type: 'YOU_GAVE',
          amount: 500,
          description: 'Remark',
          billReference: null,
          dueDate: '2026-10-10',
          createdAt: '2026-10-10T15:22:00.000Z',
          balanceAfter: 500,
        }]}
      />,
    );

    const dateCell = container.querySelector('[data-entry-id="entry-1"] td');
    expect(dateCell?.textContent).toContain('অক্টোবর');
    expect(dateCell?.textContent).not.toMatch(/•|AM|PM|\d{1,2}:\d{2}/);
  });
});
