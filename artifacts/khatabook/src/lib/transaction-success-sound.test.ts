import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MockAudio {
  static instances: MockAudio[] = [];
  currentTime = 0;
  preload = '';
  volume = 1;
  play = vi.fn(() => Promise.resolve());

  constructor(public src: string) {
    MockAudio.instances.push(this);
  }
}

describe('transaction success sound', () => {
  beforeEach(() => {
    vi.resetModules();
    MockAudio.instances = [];
    vi.stubGlobal('Audio', MockAudio);
    delete (window as Window & { ReactNativeWebView?: unknown }).ReactNativeWebView;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as Window & { ReactNativeWebView?: unknown }).ReactNativeWebView;
  });

  it('preloads and replays the success chime in a browser', async () => {
    const { playTransactionSuccessSound } = await import('./transaction-success-sound');
    const audio = MockAudio.instances[0];
    expect(audio).toBeDefined();
    expect(audio.preload).toBe('auto');
    expect(audio.src).toContain('/sounds/transaction-success.mp3');

    audio.currentTime = 0.2;
    playTransactionSuccessSound();

    expect(audio.currentTime).toBe(0);
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it('routes success playback to Expo Audio inside the native WebView', async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage },
    });

    const { playTransactionSuccessSound } = await import('./transaction-success-sound');
    playTransactionSuccessSound();

    expect(postMessage).toHaveBeenCalledWith('transaction-success');
    expect(MockAudio.instances).toHaveLength(0);
  });
});