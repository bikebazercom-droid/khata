const CALCULATOR_TAP_MESSAGE = 'calculator-key-tap';

type ReactNativeWebViewBridge = {
  postMessage: (message: string) => void;
};

function getReactNativeWebViewBridge() {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { ReactNativeWebView?: ReactNativeWebViewBridge }).ReactNativeWebView;
}

function createBrowserAudio() {
  if (typeof Audio === 'undefined') return null;

  const audio = new Audio(`${import.meta.env.BASE_URL}sounds/calculator-key-tap.mp3`);
  audio.preload = 'auto';
  audio.volume = 0.45;
  return audio;
}

// Constructing the HTML5 audio element early lets browsers preload the short
// sample. The native WebView handles playback through Expo Audio instead.
let browserAudio = getReactNativeWebViewBridge() ? null : createBrowserAudio();

export function playCalculatorTapSound() {
  const nativeBridge = getReactNativeWebViewBridge();
  if (nativeBridge) {
    try {
      nativeBridge.postMessage(CALCULATOR_TAP_MESSAGE);
    } catch {
      // Sound is optional; never let it interrupt calculator input.
    }
    return;
  }

  try {
    browserAudio ??= createBrowserAudio();
    if (!browserAudio) return;
    try {
      browserAudio.currentTime = 0;
    } catch {
      // Seeking may fail before the browser has loaded audio metadata.
    }
    void browserAudio.play().catch(() => {
      // Audio can be unavailable or blocked by browser settings.
    });
  } catch {
    // Sound is optional; never let it interrupt calculator input.
  }
}