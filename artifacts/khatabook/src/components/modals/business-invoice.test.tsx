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
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
    Element.prototype.scrollIntoView ??= vi.fn();
  });

  it('keeps the full-width entry form active while editing invoice details', () => {
    render(<BusinessInvoice />);
    fireEvent.change(screen.getByTestId('input-invoice-item-amount-1'), { target: { value: '100' } });
    fireEvent.click(screen.getByTestId('checkbox-invoice-item-taxed-1'));
    fireEvent.change(screen.getByTestId('input-invoice-taxRate'), { target: { value: '10' } });
    expect(screen.getByTestId('input-invoice-item-amount-1')).toHaveValue(100);
    expect(screen.getByTestId('checkbox-invoice-item-taxed-1')).toBeChecked();
    expect(screen.queryByTestId('printable-invoice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-invoice-mobile-view')).not.toBeInTheDocument();
  });

  it('hides generated invoice number and due date fields and searches currencies by country name', () => {
    render(<BusinessInvoice />);
    expect(screen.queryByTestId('input-invoice-number')).not.toBeInTheDocument();
    expect(screen.queryByTestId('input-invoice-due')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('select-invoice-currency'));
    fireEvent.change(screen.getByTestId('input-invoice-currency-search'), { target: { value: 'Dubai' } });
    expect(screen.getByTestId('currency-option-AED')).toBeInTheDocument();
    expect(screen.queryByTestId('currency-option-USD')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('currency-option-AED'));
    expect(screen.getByTestId('select-invoice-currency')).toHaveTextContent('AED');
    expect(screen.getByText('Metal / unit rate (د.إ AED)')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('input-invoice-item-amount-1'), { target: { value: '100' } });
    fireEvent.change(screen.getByTestId('input-invoice-metalRate'), { target: { value: '447/g' } });
    expect(screen.queryByTestId('printable-invoice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-invoice-mobile-view')).not.toBeInTheDocument();
    expect(screen.queryByText(/Payment due date/)).not.toBeInTheDocument();
    expect(screen.getByText('Metal / unit rate (د.إ AED)')).toBeInTheDocument();
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
      expect(screen.getByTestId('input-invoice-customer')).toHaveValue('A customer');
      expect(screen.getByTestId('input-invoice-item-description-1')).toHaveValue('Rice');
      expect(screen.getByTestId('select-invoice-customer-id-type')).toHaveValue('nid');
      expect(screen.getByTestId('input-invoice-customerIdNumber')).toHaveValue('');
    } finally {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  });

  it('opens a saved invoice as a dedicated preview and allows returning to edit', () => {
    const historyRecord = {
      id: 'Business:INV-SAVED', type: 'Business' as const, number: 'INV-SAVED', date: '2026-10-17',
      customerName: 'A. Customer', customerPhone: '+971 50 123 4567', total: 100, currency: 'AED',
      itemCount: 1, savedAt: '2026-10-17T00:00:00.000Z',
      payload: {
        invoiceData: {
          company: 'Sample Shop', address: 'Main road', phone: '', website: '', logo: '', email: '', trn: '', locationUrl: '',
          customer: 'A. Customer', customerAddress: 'Dubai, UAE', customerPhone: '+971 50 123 4567',
          customerIdType: 'passport', customerIdNumber: 'A98765432', number: 'INV-SAVED', date: '2026-10-17',
          currency: 'AED', taxRate: '0', comments: '', paymentTerms: 'Cash', metalRate: '', placeOfSupply: '',
        },
        lines: [{ id: 1, description: 'Gold chain', amount: '100', taxed: false }],
      },
    };
    render(<BusinessInvoice historyRecord={historyRecord} viewOnly />);
    expect(screen.getByTestId('input-invoice-customer').closest('.hidden')).not.toBeNull();
    expect(screen.getByText('A. Customer')).toBeInTheDocument();
    expect(screen.getByText('Phone: +971 50 123 4567')).toBeInTheDocument();
    expect(screen.getByText('Passport No: A98765432')).toBeInTheDocument();
    expect(screen.getByText('Address: Dubai, UAE')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-invoice-preview-edit'));
    expect(screen.getByTestId('input-invoice-customer')).toHaveValue('A. Customer');
    expect(screen.getByTestId('input-invoice-customer').closest('.hidden')).toBeNull();
  });

  it('exports using the fixed A4-width container and zero-scroll canvas', async () => {
    pdfCapture.options = null;
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:invoice');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<BusinessInvoice />);
    fireEvent.change(screen.getByTestId('input-invoice-customer'), { target: { value: 'Export Customer' } });
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

  it('keeps seller profile fields out of the invoice creation form', () => {
    render(<BusinessInvoice />);
    expect(screen.queryByTestId('input-invoice-company')).not.toBeInTheDocument();
    expect(screen.queryByTestId('input-invoice-logo-upload')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-invoice-save-profile')).not.toBeInTheDocument();
  });

  it('saves an invoice into searchable history', () => {
    const onGenerated = vi.fn();
    render(<BusinessInvoice onGenerated={onGenerated} />);
    fireEvent.change(screen.getByTestId('input-invoice-customer'), { target: { value: 'History Customer' } });
    const generateButton = screen.getByRole('button', { name: 'Generate Invoice' });
    expect(generateButton.closest('header')).toBeNull();
    expect(generateButton).toHaveClass('w-full');
    fireEvent.click(generateButton);
    expect(onGenerated).toHaveBeenCalledOnce();
    const history = JSON.parse(localStorage.getItem('banglakhata_invoice_history_v1:default') || '[]');
    expect(history[0]).toMatchObject({ type: 'Business', customerName: 'History Customer', currency: 'BDT', itemCount: 1 });
    expect(history[0].payload.invoiceData.number).toMatch(/^INV-/);
  });
});
