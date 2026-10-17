import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GoldInvoice } from './gold-invoice';

vi.mock('@/lib/i18n', () => ({ useLanguage: () => ({ lang: 'en' }) }));

describe('gold invoice', () => {
  beforeEach(() => {
    localStorage.clear();
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
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

    fireEvent.change(screen.getByTestId('input-gold-vat-rate'), { target: { value: '10' } });
    expect(screen.getByTestId('text-gold-total')).toHaveTextContent('49,027.41');
  });

  it('searches currency by country alias and updates currency labels', () => {
    render(<GoldInvoice />);
    fireEvent.click(screen.getByTestId('button-gold-currency'));
    fireEvent.change(screen.getByTestId('input-gold-currency-search'), { target: { value: 'Bangladesh' } });
    fireEvent.click(screen.getByTestId('option-gold-currency-BDT'));

    expect(screen.getByTestId('button-gold-currency')).toHaveTextContent('BDT');
    expect(screen.getByText(/Metal rate \/ gram \(৳ BDT\/g\)/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByTestId('button-gold-save-history'));
    expect(screen.getByRole('button', { name: 'Generate Invoice' })).toBeInTheDocument();
    expect(onGenerated).toHaveBeenCalledOnce();
    const history = JSON.parse(localStorage.getItem('banglakhata_invoice_history_v1:default') || '[]');
    expect(history[0]).toMatchObject({ type: 'Gold', customerName: 'Gold Customer', currency: 'AED', itemCount: 1 });
    expect(history[0].payload.data.number).toMatch(/^GOLD-/);
    expect(history[0].payload.lines[0].grossUnit).toBe('g');
  });
});
