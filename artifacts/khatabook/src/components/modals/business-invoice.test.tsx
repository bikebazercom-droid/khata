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
});
