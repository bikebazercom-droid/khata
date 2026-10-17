import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BusinessInvoice } from './business-invoice';

const pdfCapture = vi.hoisted(() => ({
  options: null as null | Record<string, unknown>,
  elementId: '',
  width: '',
  padding: '',
  boxSizing: '',
  overflow: '',
}));

vi.mock('@/lib/i18n', () => ({ useLanguage: () => ({ lang: 'en' }) }));
vi.mock('html2pdf.js', () => ({
  default: () => {
    const worker = {
      set(options: Record<string, unknown>) {
        pdfCapture.options = options;
        return worker;
      },
      from(element: HTMLElement) {
        pdfCapture.elementId = element.id;
        pdfCapture.width = element.style.width;
        pdfCapture.padding = element.style.padding;
        pdfCapture.boxSizing = element.style.boxSizing;
        pdfCapture.overflow = element.style.overflow;
        return worker;
      },
      async outputPdf() {
        return new Blob(['pdf'], { type: 'application/pdf' });
      },
    };
    return worker;
  },
}));

describe('business invoice', () => {
  beforeEach(() => {
    localStorage.removeItem('selected_business_id');
    localStorage.removeItem('banglakhata_business_invoice_profile_v1:default');
  });

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

  it('exports using the fixed A4-width container and zero-scroll canvas', async () => {
    pdfCapture.options = null;
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:invoice');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<BusinessInvoice />);
    fireEvent.click(screen.getByTestId('button-invoice-download'));

    await waitFor(() => expect(pdfCapture.options).not.toBeNull());
    expect(pdfCapture.elementId).toBe('printable-invoice');
    expect(pdfCapture.width).toBe('794px');
    expect(pdfCapture.padding).toBe('32px');
    expect(pdfCapture.boxSizing).toBe('border-box');
    expect(pdfCapture.overflow).toBe('hidden');
    const options = pdfCapture.options as Record<string, unknown> | null;
    expect(options?.margin).toEqual([10, 10, 10, 10]);
    expect(options?.html2canvas).toMatchObject({ windowWidth: 794, scrollX: 0, scrollY: 0, scale: 2 });

    createObjectUrl.mockRestore();
    click.mockRestore();
  });

  it('saves the business profile and reuses it on the next invoice', () => {
    const first = render(<BusinessInvoice />);
    fireEvent.change(screen.getByTestId('input-invoice-company'), { target: { value: 'New Shop' } });
    fireEvent.change(screen.getByTestId('input-invoice-email'), { target: { value: 'shop@example.com' } });
    fireEvent.click(screen.getByTestId('button-invoice-save-profile'));
    expect(JSON.parse(localStorage.getItem('banglakhata_business_invoice_profile_v1:default') || '{}')).toMatchObject({
      company: 'New Shop',
      email: 'shop@example.com',
    });
    first.unmount();

    render(<BusinessInvoice />);
    expect(screen.getByText('Business Details Saved')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-invoice-mobile-view'));
    expect(screen.getAllByText('New Shop')).toHaveLength(2);
  });
});
