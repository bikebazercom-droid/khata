import type { MeResponse } from './phoneAuth';

export type OfflineIdentity = MeResponse & {
  adjustmentPartyIds?: string[];
};

const OFFLINE_IDENTITY_KEY = 'banglakhata.offline-identity.v1';
const LOCAL_LOGOUT_PENDING_KEY = 'banglakhata.local-logout-pending.v1';

function isOfflineIdentity(value: unknown): value is OfflineIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const identity = value as Record<string, unknown>;
  return typeof identity.userId === 'string' &&
    typeof identity.businessId === 'string' &&
    (identity.role === 'owner' || identity.role === 'staff') &&
    (identity.authMethod === 'clerk' || identity.authMethod === 'phone');
}

/** Identity metadata only; session credentials remain with Clerk or the httpOnly cookie. */
export function readOfflineIdentity(): OfflineIdentity | null {
  try {
    const raw = localStorage.getItem(OFFLINE_IDENTITY_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isOfflineIdentity(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveOfflineIdentity(identity: OfflineIdentity): boolean {
  if (!isOfflineIdentity(identity)) return false;
  try {
    localStorage.setItem(OFFLINE_IDENTITY_KEY, JSON.stringify(identity));
    return true;
  } catch {
    return false;
  }
}

export function clearOfflineIdentity(): void {
  try {
    localStorage.removeItem(OFFLINE_IDENTITY_KEY);
  } catch {
    // The server-side logout remains authoritative if browser storage is blocked.
  }
}

export function markLocalLogoutPending(): void {
  try {
    localStorage.setItem(LOCAL_LOGOUT_PENDING_KEY, '1');
  } catch {
    // Offline identity and query data are still cleared locally by the caller.
  }
}

export function isLocalLogoutPending(): boolean {
  try {
    return localStorage.getItem(LOCAL_LOGOUT_PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearLocalLogoutPending(): void {
  try {
    localStorage.removeItem(LOCAL_LOGOUT_PENDING_KEY);
  } catch {
    // The server-side logout remains authoritative if browser storage is blocked.
  }
}
