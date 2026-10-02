import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BengaliCalendarModal } from '../components/modals/bengali-calendar-modal';
import { formatBengaliDateInput } from '../lib/bengali-date';

describe('BengaliCalendarModal', () => {
  it('shows a localized selected date and commits only after confirmation', () => {
    const onConfirm = vi.fn();
    const selectedDate = new Date(2026, 9, 2);

    render(
      <BengaliCalendarModal
        value={selectedDate}
        ariaLabel="আরম্ভের তারিখ নির্বাচন করুন"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'আরম্ভের তারিখ নির্বাচন করুন' })).toBeTruthy();
    expect(screen.getByText(/শুক্র/).textContent).toContain('অক্টো.');
    expect(formatBengaliDateInput(selectedDate)).toBe('২ অক্টো. ২০২৬');

    fireEvent.click(screen.getByRole('button', { name: '৩ অক্টোবর ২০২৬' }));
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'ঠিক আছে' }));
    expect(onConfirm).toHaveBeenCalledWith(new Date(2026, 9, 3));
  });

  it('cancels without committing the draft and clears through the clear action', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const onClear = vi.fn();

    const { unmount } = render(
      <BengaliCalendarModal
        value={new Date(2026, 9, 2)}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '৩ অক্টোবর ২০২৬' }));
    fireEvent.click(screen.getByRole('button', { name: 'বাতিল করুন' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();

    unmount();
    render(
      <BengaliCalendarModal
        value={new Date(2026, 9, 2)}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'সরিয়ে দিন' }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});