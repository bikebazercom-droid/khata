const TRANSACTION_SUCCESS_MESSAGE = 'transaction-success';

type ReactNativeWebViewBridge = {
  postMessage: (message: string) => void;
};

function getReactNativeWebViewBridge() {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { ReactNativeWebView?: ReactNativeWebViewBridge }).ReactNativeWebView;
}

function createBrowserAudio() {
  if (typeof Audio === 'undefined') return null;

  const audio = new Audio(`${import.meta.env.BASE_URL}sounds/transaction-success.mp3`);
  audio.preload = 'auto';
  audio.volume = 0.55;
  return audio;
}

// Preload in browsers; native WebViews use Expo Audio through the message bridge.
let browserAudio = getReactNativeWebViewBridge() ? null : createBrowserAudio();

export function playTransactionSuccessSound() {
  const nativeBridge = getReactNativeWebViewBridge();
  if (nativeBridge) {
    try {
      nativeBridge.postMessage(TRANSACTION_SUCCESS_MESSAGE);
    } catch {
      // Sound is optional; never let it interrupt saving an entry.
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
    // Sound is optional; never let it interrupt saving an entry.
  }
}