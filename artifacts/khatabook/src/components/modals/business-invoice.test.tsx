import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BusinessInvoice } from './business-invoice';

const pdfCapture = vi.hoisted(() => ({
  options: null as null | Record<string, unknown>,
  elementId: '',
  width: '',
  height: '',
  padding: '',
  boxSizing: '',
  overflow: '',
  fail: false,
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
        pdfCapture.height = element.style.height;
        pdfCapture.padding = element.style.padding;
        pdfCapture.boxSizing = element.style.boxSizing;
        pdfCapture.overflow = element.style.overflow;
        return worker;
      },
      async outputPdf() {
        if (pdfCapture.fail) throw new Error('Simulated renderer failure');
        return new Blob(['pdf'], { type: 'application/pdf' });
      },
    };
    return worker;
  },
}));

describe('business invoice', () => {
  const originalClipboard = navigator.clipboard;
  const originalShare = navigator.share;
  const originalCanShare = navigator.canShare;

  beforeEach(() => {
    pdfCapture.fail = false;
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

  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard });
    else delete (navigator as unknown as Record<string, unknown>).clipboard;
    if (originalShare) Object.defineProperty(navigator, 'share', { configurable: true, value: originalShare });
    else delete (navigator as unknown as Record<string, unknown>).share;
    if (originalCanShare) Object.defineProperty(navigator, 'canShare', { configurable: true, value: originalCanShare });
    else delete (navigator as unknown as Record<string, unknown>).canShare;
    vi.restoreAllMocks();
  });

  it('keeps the full-width entry form active while editing invoice details', () => {
    render(<BusinessInvoice />);
    expect(screen.getByTestId('grid-invoice-customer-fields')).toHaveClass('grid', 'md:grid-cols-2');
    expect(screen.getByTestId('grid-invoice-reference-fields')).toHaveClass('grid', 'md:grid-cols-2');
    expect(screen.queryByTestId('button-invoice-share')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-invoice-download')).not.toBeInTheDocument();
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
    expect(screen.queryByTestId('input-invoice-metalRate')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('select-invoice-currency'));
    fireEvent.change(screen.getByTestId('input-invoice-currency-search'), { target: { value: 'Dubai' } });
    const currencyPopover = screen.getByTestId('invoice-currency-popover');
    expect(currencyPopover).toHaveClass('bg-white', 'z-[100]');
    const aedOption = screen.getByTestId('currency-option-AED');
    expect(aedOption).toBeInTheDocument();
    expect(aedOption.querySelector('span.text-xs.text-slate-500')).toHaveTextContent('AED');
    expect(aedOption).toHaveTextContent('United Arab Emirates Dirham');
    expect(screen.queryByTestId('currency-option-USD')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('currency-option-AED'));
    expect(screen.getByTestId('select-invoice-currency')).toHaveTextContent('AED');

    fireEvent.change(screen.getByTestId('input-invoice-item-amount-1'), { target: { value: '100' } });
    expect(screen.queryByTestId('printable-invoice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-invoice-mobile-view')).not.toBeInTheDocument();
    expect(screen.queryByText(/Payment due date/)).not.toBeInTheDocument();
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
    expect(screen.getByTestId('button-invoice-share')).toBeInTheDocument();
    expect(screen.getByTestId('button-invoice-download')).toBeInTheDocument();
    expect(screen.getByTestId('input-invoice-customer').closest('.hidden')).not.toBeNull();
    expect(screen.getByText('A. Customer')).toBeInTheDocument();
    expect(screen.getByText('Phone: +971 50 123 4567')).toBeInTheDocument();
    expect(screen.getByText('Passport No: A98765432')).toBeInTheDocument();
    expect(screen.getByText('Address: Dubai, UAE')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-invoice-preview-edit'));
    expect(screen.queryByTestId('button-invoice-share')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-invoice-download')).not.toBeInTheDocument();
    expect(screen.getByTestId('input-invoice-customer')).toHaveValue('A. Customer');
    expect(screen.getByTestId('input-invoice-customer').closest('.hidden')).toBeNull();
  });

  it('exports using the fixed A4-width container and zero-scroll canvas', async () => {
    pdfCapture.options = null;
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:invoice');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<BusinessInvoice viewOnly />);
    fireEvent.change(screen.getByTestId('input-invoice-customer'), { target: { value: 'Export Customer' } });
    fireEvent.click(screen.getByTestId('button-invoice-download'));

    await waitFor(() => expect(pdfCapture.options).not.toBeNull());
    expect(pdfCapture.elementId).toBe('printable-invoice');
    expect(pdfCapture.width).toBe('210mm');
    expect(pdfCapture.height).toBe('296mm');
    expect(pdfCapture.padding).toBe('32px');
    expect(pdfCapture.boxSizing).toBe('border-box');
    expect(pdfCapture.overflow).toBe('hidden');
    const options = pdfCapture.options as Record<string, unknown> | null;
    expect(options?.margin).toBe(0);
    expect(options?.html2canvas).toMatchObject({ windowWidth: 794, scrollX: 0, scrollY: 0, scale: 2 });
    expect((options?.html2canvas as { onclone?: unknown }).onclone).toEqual(expect.any(Function));

    createObjectUrl.mockRestore();
    click.mockRestore();
  });

  it('copies the invoice link when browser PDF sharing is rejected', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const share = vi.fn().mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    render(<BusinessInvoice viewOnly />);
    fireEvent.change(screen.getByTestId('input-invoice-customer'), { target: { value: 'Share Customer' } });
    fireEvent.click(screen.getByTestId('button-invoice-share'));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(share).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain('#invoice=');
  });

  it('opens the browser print dialog when the PDF renderer fails', async () => {
    pdfCapture.fail = true;
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<BusinessInvoice viewOnly />);
    fireEvent.change(screen.getByTestId('input-invoice-customer'), { target: { value: 'Print Customer' } });
    fireEvent.click(screen.getByTestId('button-invoice-download'));

    await waitFor(() => expect(print).toHaveBeenCalledOnce());
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
