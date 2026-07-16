/**
 * Tiny localStorage helper that remembers whether the user was authenticated
 * on their last visit. Used only to decide whether to show the loading spinner
 * on app start — actual auth is always verified against the server.
 *
 * Stored value is just 'clerk' | 'phone'. We deliberately keep nothing
 * sensitive here — no tokens, no user IDs, no session data.
 */

const KEY = 'dkhata_auth_v1';

export type AuthMethod = 'clerk' | 'phone';

export function readAuthCache(): AuthMethod | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'clerk' || v === 'phone' ? v : null;
  } catch {
    return null;
  }
}

export function writeAuthCache(method: AuthMethod): void {
  try {
    localStorage.setItem(KEY, method);
  } catch {}
}

export function clearAuthCache(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
