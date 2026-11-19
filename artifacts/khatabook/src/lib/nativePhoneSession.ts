const SAVE_MESSAGE = 'banglakhata-native-phone-session';
const SAVED_EVENT = 'banglakhata-native-phone-session-saved';

declare global {
  interface Window {
    __BKH_NATIVE_SESSION_STORAGE__?: boolean;
  }
}

/** Keep bearer tokens out of browser storage; only the native secure store gets them. */
export async function persistNativePhoneSession(token: string | undefined): Promise<void> {
  if (typeof window === 'undefined' || !window.__BKH_NATIVE_SESSION_STORAGE__) return;
  const bridge = (window as Window & {
    ReactNativeWebView?: { postMessage: (message: string) => void };
  }).ReactNativeWebView;
  if (!bridge || !token) throw new Error('সাইন-ইন তথ্য নিরাপদে সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।');
  const requestId = crypto.randomUUID();
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      window.removeEventListener(SAVED_EVENT, onSaved);
    };
    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.requestId !== requestId) return;
      cleanup();
      if (detail.ok === true) resolve();
      else reject(new Error('সাইন-ইন তথ্য নিরাপদে সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।'));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('সাইন-ইন তথ্য সংরক্ষণের সময় শেষ হয়েছে। আবার চেষ্টা করুন।'));
    }, 10000);
    window.addEventListener(SAVED_EVENT, onSaved);
    try {
      bridge.postMessage(JSON.stringify({ type: SAVE_MESSAGE, requestId, token }));
    } catch {
      cleanup();
      reject(new Error('সাইন-ইন তথ্য নিরাপদে সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।'));
    }
  });
}
