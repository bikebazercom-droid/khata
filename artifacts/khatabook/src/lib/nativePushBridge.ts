export const NATIVE_PUSH_TOKEN_EVENT = 'banglakhata-native-push-token';
export const NATIVE_PUSH_STATUS_EVENT = 'banglakhata-native-push-status';
export const OWNER_PUSH_REGISTRATION_EVENT = 'banglakhata-owner-push-registration';
export const OPEN_NOTIFICATION_EVENT = 'banglakhata-open-notification';
export const STORED_OWNER_PUSH_TOKEN_KEY = 'banglakhata_owner_push_token';

type NativeWebViewBridge = {
  postMessage: (message: string) => void;
};

function getBridge(): NativeWebViewBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { ReactNativeWebView?: NativeWebViewBridge }).ReactNativeWebView;
}

export function isInsideNativeWebView(): boolean {
  return Boolean(getBridge());
}

export function postNativePushMessage(type: 'banglakhata-web-ready' | 'banglakhata-enable-push'): boolean {
  const bridge = getBridge();
  if (!bridge) return false;
  try {
    bridge.postMessage(JSON.stringify({ type }));
    return true;
  } catch {
    return false;
  }
}
