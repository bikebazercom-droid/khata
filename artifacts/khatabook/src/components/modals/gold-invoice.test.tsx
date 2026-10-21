import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GoldInvoice } from './gold-invoice';

const pdfCapture = vi.hoisted(() => ({ elementId: '', elementStyle: null as null | { width: string; height: string }, options: null as null | Record<string, unknown>, fail: false }));

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
        pdfCapture.elementStyle = { width: element.style.width, height: element.style.height };
        return worker;
      },
      async outputPdf() {
        if (pdfCapture.fail) throw new Error('Simulated renderer failure');
        return new Blob(['gold-invoice-pdf'], { type: 'application/pdf' });
      },
    };
    return worker;
  },
}));

describe('gold invoice', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const originalClipboard = navigator.clipboard;
  const originalShare = navigator.share;
  const originalCanShare = navigator.canShare;

  beforeEach(() => {
    localStorage.clear();
    pdfCapture.elementId = '';
    pdfCapture.elementStyle = null;
    pdfCapture.options = null;
    pdfCapture.fail = false;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:gold-invoice') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
  });

  afterEach(() => {
    for (const [key, original] of Object.entries({
      createObjectURL: originalCreateObjectURL,
      revokeObjectURL: originalRevokeObjectURL,
    })) {
      if (original) Object.defineProperty(URL, key, { configurable: true, value: original });
      else delete (URL as unknown as Record<string, unknown>)[key];
    }
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard });
    else delete (navigator as unknown as Record<string, unknown>).clipboard;
    if (originalShare) Object.defineProperty(navigator, 'share', { configurable: true, value: originalShare });
    else delete (navigator as unknown as Record<string, unknown>).share;
    if (originalCanShare) Object.defineProperty(navigator, 'canShare', { configurable: true, value: originalCanShare });
    else delete (navigator as unknown as Record<string, unknown>).canShare;
    vi.restoreAllMocks();
  });

  it('converts Vori to grams using 11.664 and calculates purity, making charge, and VAT', () => {
    render(<GoldInvoice />);
    fireEvent.change(screen.getByTestId('input-gold-gross-1'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('select-gold-weight-unit-1'), { target: { value: 'vori' } });
    fireEvent.change(screen.getByTestId('input-gold-purity-1'), { target: { value: '0.916' } });
    fireEvent.change(screen.getByTestId('input-gold-metal-rate'), { target: { value: '100' } });
    fireEvent.change(screen.getByTestId('input-gold-making-rate-1'), { target: { value: '10' } });

    expect(screen.getByTestId('text-gold-pure-1')).toHaveTextContent('10.684 g');
    expect(screen.getByTestId('text-gold-gross-total')).toHaveTextContent('11.664 g');
    expect(screen.getByTestId('text-gold-line-total-1')).toHaveTextContent('AED');
    expect(screen.getByTestId('text-gold-line-total-1')).toHaveTextContent('1,283.04');
    expect(screen.getAllByTestId('text-gold-total')[0]).toHaveTextContent('1,347.19');
  });

  it('values gold by gross weight and applies the editable VAT rate', () => {
    render(<GoldInvoice />);
    fireEvent.change(screen.getByTestId('input-gold-gross-1'), { target: { value: '99.71' } });
    fireEvent.change(screen.getByTestId('input-gold-metal-rate'), { target: { value: '447' } });

    expect(screen.getByTestId('text-gold-pure-1')).toHaveTextContent('91.334 g');
    expect(screen.getByTestId('text-gold-line-total-1')).toHaveTextContent('44,570.37');
    expect(screen.getByTestId('input-gold-vat-rate')).toHaveValue(5);
    expect(screen.getByTestId('text-gold-total')).toHaveTextContent('46,798.89');
    expect(screen.getByText(/Gold value \(99\.71g gross ×/i)).toBeInTheDocument();

    const vatRateInput = screen.getByTestId('input-gold-vat-rate');
    fireEvent.change(vatRateInput, { target: { value: '3' } });
    expect(screen.getByTestId('text-gold-vat')).toHaveTextContent('1,337.11');
    expect(screen.getByTestId('text-gold-total')).toHaveTextContent('45,907.48');

    fireEvent.change(vatRateInput, { target: { value: '10' } });
    expect(screen.getByTestId('text-gold-total')).toHaveTextContent('49,027.41');

    fireEvent.change(vatRateInput, { target: { value: '0' } });
    expect(screen.getByTestId('text-gold-vat')).toHaveTextContent('0.00');
    expect(screen.getByTestId('text-gold-total')).toHaveTextContent('44,570.37');

    fireEvent.change(vatRateInput, { target: { value: '' } });
    expect((vatRateInput as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('text-gold-vat')).toHaveTextContent('0.00');
    expect(screen.getByTestId('text-gold-total')).toHaveTextContent('44,570.37');
  });

  it('searches currency by country alias and updates currency labels', () => {
    render(<GoldInvoice />);
    fireEvent.click(screen.getByTestId('button-gold-currency'));
    fireEvent.change(screen.getByTestId('input-gold-currency-search'), { target: { value: 'Bangladesh' } });
    fireEvent.click(screen.getByTestId('option-gold-currency-BDT'));

    expect(screen.getByTestId('button-gold-currency')).toHaveTextContent('BDT');
    expect(screen.getByText(/Metal rate \/ gram \(৳ BDT\/g\)/)).toBeInTheDocument();
  });

  it('uses the saved Business Profile stamp in the invoice and omits the duplicate uploader', () => {
    const stamp = 'data:image/png;base64,c3RhbXA=';
    localStorage.setItem('banglakhata_gold_invoice_stamp_v1:default', stamp);
    render(<GoldInvoice viewOnly />);

    expect(screen.getByTestId('button-gold-share')).toBeInTheDocument();
    expect(screen.getByTestId('button-gold-download')).toBeInTheDocument();
    expect(screen.queryByTestId('button-gold-upload-stamp')).not.toBeInTheDocument();
    expect(screen.queryByTestId('input-gold-stamp')).not.toBeInTheDocument();
    expect(screen.getByTestId('gold-company-stamp')).toHaveAttribute('src', stamp);
  });

  it('prints seven numbered item rows when the invoice has fewer items', () => {
    render(<GoldInvoice viewOnly />);

    const getRows = () => screen.getAllByTestId('gold-printable-item-row');
    expect(getRows()).toHaveLength(7);
    expect(getRows().map((row) => row.querySelector('td')?.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(getRows().map((row) => row.querySelectorAll('td').length)).toEqual([8, 8, 8, 8, 8, 8, 8]);
    expect(screen.getByTestId('gold-printable-customer-grid').children).toHaveLength(16);
    expect(screen.getByTestId('gold-printable-payment-box')).toHaveClass('justify-center', 'min-h-[64px]');
  });

  it('keeps party-copy metadata labels and values in separate wrapping columns', () => {
    render(<GoldInvoice viewOnly />);

    const taxQr = screen.getByTestId('gold-printable-tax-qr');
    expect(taxQr).toHaveClass('flex', 'flex-col', 'items-center');
    expect(taxQr).toHaveTextContent('TAX INVOICE');
    expect(taxQr.querySelector('svg')).toBeInTheDocument();
    const tableHeaders = [...screen.getByTestId('gold-printable-items-table').querySelectorAll('thead th')].map((cell) => cell.textContent);
    expect(tableHeaders).toEqual([
      'S.No', 'Stock Description', 'Gross Wt.', 'Purity', 'Pure Wt.',
      'Making Rate', 'Making Amt. (AED)', 'Total (AED)',
    ]);
    expect(screen.getByTestId('gold-printable-total-row')).toHaveTextContent('Total (1 Item)');
    expect(screen.getByTestId('text-gold-printable-total-label')).toHaveTextContent('Total Amount Including VAT (AED)');
    const rows = screen.getAllByTestId('gold-header-meta-row');
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row).toHaveClass('grid', 'min-w-0', 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]');
      expect(row.children[0]).toHaveClass('min-w-0', 'break-words');
      expect(row.children[1]).toHaveClass('min-w-0', 'break-words', 'text-right');
    }
    expect(screen.getByText('Total Amount Before VAT (AED)')).toBeInTheDocument();
    expect(screen.getByText('Total VAT Amount (5%)')).toBeInTheDocument();
    expect(screen.getByText('Round Off Discount (AED)')).toBeInTheDocument();
  });

  it('downloads a generated PDF from the fixed A4 template', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<GoldInvoice viewOnly />);
    fireEvent.change(screen.getByTestId('input-gold-customerName'), { target: { value: 'Gold Customer' } });
    fireEvent.click(screen.getByTestId('button-gold-download'));

    await waitFor(() => expect(anchorClick).toHaveBeenCalledOnce());
    expect(pdfCapture.elementId).toBe('printable-gold-invoice');
    expect(pdfCapture.options).toMatchObject({
      margin: 0,
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      html2canvas: { windowWidth: 794, scale: 2 },
    });
    expect(pdfCapture.elementStyle).toEqual({ width: '210mm', height: '297mm' });
    expect((pdfCapture.options?.html2canvas as { onclone?: unknown }).onclone).toEqual(expect.any(Function));
  });

  it('opens the browser print dialog when the PDF renderer fails', async () => {
    pdfCapture.fail = true;
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<GoldInvoice viewOnly />);
    fireEvent.change(screen.getByTestId('input-gold-customerName'), { target: { value: 'Gold Customer' } });
    fireEvent.click(screen.getByTestId('button-gold-download'));

    await waitFor(() => expect(print).toHaveBeenCalledOnce());
  });

  it('falls back to copying the invoice link if browser sharing rejects the PDF', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const share = vi.fn().mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    render(<GoldInvoice viewOnly />);
    fireEvent.change(screen.getByTestId('input-gold-customerName'), { target: { value: 'Gold Customer' } });
    fireEvent.click(screen.getByTestId('button-gold-share'));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(share).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain('#goldinvoice=');
  });

  it('stacks gold invoice fields on mobile and restores columns at tablet width', () => {
    render(<GoldInvoice />);

    expect(screen.queryByTestId('button-gold-share')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-gold-download')).not.toBeInTheDocument();
    expect(screen.getByTestId('grid-gold-customer-fields')).toHaveClass('grid-cols-1', 'md:grid-cols-2');
    expect(screen.getByTestId('grid-gold-item-fields-1')).toHaveClass('grid-cols-1', 'md:grid-cols-3');
    expect(screen.getByTestId('grid-gold-payment-fields')).toHaveClass('grid-cols-1', 'md:grid-cols-2');
  });

  it('adds and removes line items without removing the last row', () => {
    render(<GoldInvoice />);
    fireEvent.click(screen.getByTestId('button-gold-add-item'));

    expect(screen.getByTestId('input-gold-gross-2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-gold-remove-2'));
    expect(screen.queryByTestId('input-gold-gross-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('button-gold-remove-1')).toBeDisabled();
  });

  it('saves gold invoices with the full calculation payload', () => {
    const onGenerated = vi.fn();
    render(<GoldInvoice onGenerated={onGenerated} />);
    fireEvent.change(screen.getByTestId('input-gold-customerName'), { target: { value: 'Gold Customer' } });
    const generateButton = screen.getByRole('button', { name: 'Generate Invoice' });
    expect(generateButton.closest('header')).toBeNull();
    expect(generateButton).toHaveClass('w-full');
    fireEvent.click(generateButton);
    expect(onGenerated).toHaveBeenCalledOnce();
    const history = JSON.parse(localStorage.getItem('banglakhata_invoice_history_v1:default') || '[]');
    expect(history[0]).toMatchObject({ type: 'Gold', customerName: 'Gold Customer', currency: 'AED', itemCount: 1 });
    expect(history[0].payload.data.number).toMatch(/^GOLD-/);
    expect(history[0].payload.lines[0].grossUnit).toBe('g');
  });
});
