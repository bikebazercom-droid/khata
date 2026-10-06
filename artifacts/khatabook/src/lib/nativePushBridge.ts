export const NATIVE_PUSH_TOKEN_EVENT = 'banglakhata-native-push-token';
export const NATIVE_PUSH_STATUS_EVENT = 'banglakhata-native-push-status';
export const OWNER_PUSH_REGISTRATION_EVENT = 'banglakhata-owner-push-registration';
export const OPEN_NOTIFICATION_EVENT = 'banglakhata-open-notification';
export const STORED_OWNER_PUSH_TOKEN_KEY = 'banglakhata_owner_push_token';
export const NATIVE_AUTH_READY_MESSAGE = 'banglakhata-native-auth-ready';
export const NATIVE_AUTH_REJECTED_MESSAGE = 'banglakhata-native-auth-rejected';
export const NATIVE_AUTH_LOGOUT_MESSAGE = 'banglakhata-native-auth-logout';

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

export function postNativeAuthMessage(
  type: typeof NATIVE_AUTH_READY_MESSAGE | typeof NATIVE_AUTH_REJECTED_MESSAGE | typeof NATIVE_AUTH_LOGOUT_MESSAGE,
): boolean {
  const bridge = getBridge();
  if (!bridge) return false;
  try {
    bridge.postMessage(JSON.stringify({ type }));
    return true;
  } catch {
    return false;
  }
}
