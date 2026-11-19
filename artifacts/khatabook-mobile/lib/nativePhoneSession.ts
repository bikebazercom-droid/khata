export const NATIVE_PHONE_SESSION_SAVED_EVENT = 'banglakhata-native-phone-session-saved';
export const NATIVE_SESSION_STORAGE_SCRIPT = 'window.__BKH_NATIVE_SESSION_STORAGE__ = true; true;';

/** Only the app's own website may write a phone session to native secure storage. */
export async function saveWebViewPhoneSession(
  rawMessage: string,
  sourceUrl: string,
  webAppUrl: string,
  acceptSession: (session: { token: string }) => Promise<void>,
): Promise<{ requestId: string; ok: boolean } | null> {
  let message: { type?: unknown; requestId?: unknown; token?: unknown };
  try {
    if (new URL(sourceUrl).origin !== new URL(webAppUrl).origin) return null;
    message = JSON.parse(rawMessage);
  } catch {
    return null;
  }
  if (
    !message || message.type !== 'banglakhata-native-phone-session'
    || typeof message.requestId !== 'string' || message.requestId.length > 100
    || typeof message.token !== 'string' || !message.token || message.token.length > 8192
  ) return null;
  try {
    await acceptSession({ token: message.token });
    return { requestId: message.requestId, ok: true };
  } catch {
    return { requestId: message.requestId, ok: false };
  }
}
