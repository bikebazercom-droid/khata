import { afterEach, describe, expect, it, vi } from 'vitest';

const soundMocks = vi.hoisted(() => ({
  playTransactionSuccessSound: vi.fn(),
}));

vi.mock('@/lib/transaction-success-sound', () => soundMocks);

import { notifyEntrySaved } from './entry-saved-feedback';

afterEach(() => {
  soundMocks.playTransactionSuccessSound.mockClear();
});

describe('notifyEntrySaved', () => {
  it('plays the success sound when the save-success feedback is triggered', () => {
    notifyEntrySaved();

    expect(soundMocks.playTransactionSuccessSound).toHaveBeenCalledOnce();
  });
});