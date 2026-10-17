import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BusinessInvoice } from './business-invoice';

vi.mock('@/lib/i18n', () => ({ useLanguage: () => ({ lang: 'en' }) }));

describe('business invoice', () => {
  it('calculates tax only for taxable items and updates the preview total', () => {
    render(<BusinessInvoice />);
    fireEvent.change(screen.getByTestId('input-invoice-item-amount-1'), { target: { value: '100' } });
    fireEvent.click(screen.getByTestId('checkbox-invoice-item-taxed-1'));
    fireEvent.change(screen.getByTestId('input-invoice-taxRate'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('button-invoice-mobile-view'));

    expect(screen.getByTestId('text-invoice-total')).toHaveTextContent('110');
  });

  it('adds and removes invoice rows without allowing the final row to disappear', () => {
    render(<BusinessInvoice />);
    fireEvent.click(screen.getByTestId('button-invoice-add-item'));

    expect(screen.getByTestId('input-invoice-item-description-2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-invoice-remove-2'));
    expect(screen.queryByTestId('input-invoice-item-description-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('button-invoice-remove-1')).toBeDisabled();
  });

  it('loads invoice details carried in a shared invoice link', () => {
    const invoiceData = {
      company: 'Sample shop', address: 'Main road', phone: '', website: '', logo: '',
      customer: 'A customer', customerAddress: '', customerPhone: '',
      number: 'INV-SHARED', date: '2026-10-17', due: '2026-11-16',
      currency: 'BDT', taxRate: '0', comments: '',
    };
    const bytes = new TextEncoder().encode(JSON.stringify({
      invoiceData,
      lines: [{ id: 1, description: 'Rice', amount: '125', taxed: false }],
    }));
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    const token = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    window.location.hash = `invoice=${token}`;

    try {
      render(<BusinessInvoice />);
      expect(screen.getByTestId('input-invoice-company')).toHaveValue('Sample shop');
      expect(screen.getByTestId('input-invoice-item-description-1')).toHaveValue('Rice');
    } finally {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  });
});
