import { useCallback } from 'react';
import { useAudioPlayer } from 'expo-audio';

export function useTransactionSuccessSound() {
  const player = useAudioPlayer(
    require('../assets/audio/transaction-success.mp3'),
    { downloadFirst: true },
  );

  return useCallback(() => {
    try {
      try {
        player.currentTime = 0;
      } catch {
        // Playback should still be attempted if the initial seek is unavailable.
      }
      player.play();
    } catch {
      // Audio is optional and must not block a successful save.
    }
  }, [player]);
}