import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LongPressPartyName } from './long-press-party-name';

describe('LongPressPartyName', () => {
  const onClick = vi.fn();
  const onLongPress = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    onClick.mockReset();
    onLongPress.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens rename on a hold and suppresses the click that follows it', () => {
    render(
      <LongPressPartyName
        name="A long customer name that must wrap instead of truncate"
        canRename
        onClick={onClick}
        onLongPress={onLongPress}
      />,
    );
    const name = screen.getByRole('button', {
      name: 'A long customer name that must wrap instead of truncate',
    });

    fireEvent.pointerDown(name, { pointerType: 'touch', button: 0 });
    act(() => vi.advanceTimersByTime(550));
    expect(onLongPress).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(name);
    fireEvent.click(name);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps a short tap as normal navigation', () => {
    render(
      <LongPressPartyName
        name="Customer"
        canRename
        onClick={onClick}
        onLongPress={onLongPress}
      />,
    );
    const name = screen.getByRole('button', { name: 'Customer' });

    fireEvent.pointerDown(name, { pointerType: 'touch', button: 0 });
    fireEvent.pointerUp(name);
    fireEvent.click(name);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('does not start a rename hold for non-owner rows', () => {
    render(
      <LongPressPartyName
        name="Customer"
        canRename={false}
        onClick={onClick}
        onLongPress={onLongPress}
      />,
    );
    const name = screen.getByRole('button', { name: 'Customer' });

    fireEvent.pointerDown(name, { pointerType: 'touch', button: 0 });
    act(() => vi.advanceTimersByTime(550));

    expect(onClick).not.toHaveBeenCalled();
    expect(onLongPress).not.toHaveBeenCalled();
    fireEvent.click(name);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
