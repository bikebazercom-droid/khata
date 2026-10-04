import { cleanup, renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const audioMocks = vi.hoisted(() => ({
  player: {
    currentTime: 1,
    play: vi.fn(),
  },
}));

vi.mock('expo-audio', () => ({
  useAudioPlayer: () => audioMocks.player,
}));

import { useTransactionSuccessSound } from '@/lib/useTransactionSuccessSound';

afterEach(cleanup);

describe('useTransactionSuccessSound', () => {
  it('restarts and plays the chime through the native audio player', () => {
    const { result } = renderHook(() => useTransactionSuccessSound());

    act(() => {
      result.current();
    });

    expect(audioMocks.player.currentTime).toBe(0);
    expect(audioMocks.player.play).toHaveBeenCalledOnce();
  });
});