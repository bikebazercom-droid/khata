import type { MeResponse } from './phoneAuth';

const KEY = 'dkhata_offline_identity_v2';
export type OfflineIdentity = Pick<MeResponse, 'userId' | 'businessId' | 'authMethod'> & {
  role: 'owner' | 'staff';
  adjustmentPartyIds: string[];
  permittedBusinessIds: string[];
};

// A record of the last successful server verification, never a login session.
export function readOfflineIdentity(): OfflineIdentity | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null') as OfflineIdentity | null;
    return value && typeof value.userId === 'string' && !!value.userId &&
      typeof value.businessId === 'string' && !!value.businessId &&
      (value.role === 'owner' || value.role === 'staff') &&
      (value.authMethod === 'clerk' || value.authMethod === 'phone') &&
      Array.isArray(value.adjustmentPartyIds) && Array.isArray(value.permittedBusinessIds) ? value : null;
  } catch { return null; }
}

export function writeOfflineIdentity(me: MeResponse): void {
  if (!me.userId || !me.businessId || (me.role !== 'owner' && me.role !== 'staff')) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({
      userId: me.userId, businessId: me.businessId, role: me.role,
      authMethod: me.authMethod, adjustmentPartyIds: (me as MeResponse & { adjustmentPartyIds?: string[] }).adjustmentPartyIds ?? [],
      permittedBusinessIds: readOfflineIdentity()?.userId === me.userId && readOfflineIdentity()?.role === me.role
        ? readOfflineIdentity()!.permittedBusinessIds : [me.businessId],
    }));
  } catch { /* disabled storage */ }
}

export function allowOfflineBusinesses(actor: string, ids: string[]): void {
  const identity = readOfflineIdentity();
  if (!identity || identity.userId !== actor) return;
  try { localStorage.setItem(KEY, JSON.stringify({ ...identity, permittedBusinessIds: ids })); } catch { /* ignore */ }
}

export function clearOfflineIdentity(): void {
  try { localStorage.removeItem(KEY); } catch { /* disabled storage */ }
}