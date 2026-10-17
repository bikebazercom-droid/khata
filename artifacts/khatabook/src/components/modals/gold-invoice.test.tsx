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
    expect(screen.getByTestId('text-gold-line-total-1')).toHaveTextContent('1,185.04');
    expect(screen.getAllByTestId('text-gold-total')[0]).toHaveTextContent('1,244.29');
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
});
