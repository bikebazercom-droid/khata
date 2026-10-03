import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Calculator } from '@/components/Calculator';

afterEach(cleanup);

describe('Calculator', () => {
  it('exposes the amount display and docked keypad separately and marks calculator input', () => {
    const onAmountChange = vi.fn();
    const onInteraction = vi.fn();

    render(
      <Calculator onAmountChange={onAmountChange} onInteraction={onInteraction}>
        {({ display, keypad }) => (
          <>
            <div data-testid="amount-display">{display}</div>
            <div data-testid="bottom-keypad">{keypad}</div>
          </>
        )}
      </Calculator>,
    );

    expect(screen.getByTestId('amount-display')).toBeTruthy();
    expect(screen.getByTestId('bottom-keypad')).toBeTruthy();
    expect(onInteraction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('calculator-key-7'));

    expect(onInteraction).toHaveBeenCalled();
    expect(onAmountChange).toHaveBeenLastCalledWith(7);
    expect((screen.getByTestId('calculator-expression') as HTMLInputElement).value).toBe('7');
  });

  it('reveals the metadata flow when the amount is entered directly', () => {
    const onAmountChange = vi.fn();
    const onInteraction = vi.fn();

    render(<Calculator onAmountChange={onAmountChange} onInteraction={onInteraction} />);

    fireEvent.change(screen.getByTestId('calculator-expression'), { target: { value: '125' } });

    expect(onInteraction).toHaveBeenCalled();
    expect(onAmountChange).toHaveBeenLastCalledWith(125);
  });

  it('keeps percent and equals in the reference keypad grid', () => {
    render(<Calculator onAmountChange={vi.fn()} />);

    const equalsKey = screen.getByTestId('calculator-key-equals');
    const plusKey = screen.getByTestId('calculator-key-+');

    expect(screen.getByTestId('calculator-key-%')).toBeTruthy();
    expect(equalsKey.parentElement).toBe(plusKey.parentElement);
  });
});