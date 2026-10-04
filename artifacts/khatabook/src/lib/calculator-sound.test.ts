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

describe('calculator tap sound', () => {
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

  it('preloads and replays the HTML5 audio sample in a browser', async () => {
    const { playCalculatorTapSound } = await import('./calculator-sound');
    const audio = MockAudio.instances[0];
    expect(audio).toBeDefined();
    expect(audio.preload).toBe('auto');
    expect(audio.src).toContain('/sounds/calculator-key-tap.mp3');

    audio.currentTime = 0.1;
    playCalculatorTapSound();
    playCalculatorTapSound();

    expect(audio.currentTime).toBe(0);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it('sends a sound request to the native WebView without creating browser audio', async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage },
    });

    const { playCalculatorTapSound } = await import('./calculator-sound');
    playCalculatorTapSound();

    expect(postMessage).toHaveBeenCalledWith('calculator-key-tap');
    expect(MockAudio.instances).toHaveLength(0);
  });
});