import { describe, expect, it } from 'vitest';
import { isValidWorkerIdentity, nextWorkerStatus, toggleAccessId, workerStatusLabel } from './ownerAccess';

describe('owner staff access helpers', () => {
  it('validates the same email and Bangladesh phone formats as the website', () => {
    expect(isValidWorkerIdentity(' staff@example.com ')).toBe(true);
    expect(isValidWorkerIdentity('01712345678')).toBe(true);
    expect(isValidWorkerIdentity('+8801712345678')).toBe(true);
    expect(isValidWorkerIdentity('staff@example')).toBe(false);
    expect(isValidWorkerIdentity('01112345678')).toBe(false);
  });

  it('toggles a permission list without changing the independent permission list', () => {
    const partyAccess = ['party-a'];
    const adjustments = ['party-b'];
    const nextPartyAccess = toggleAccessId(partyAccess, 'party-b');

    expect(nextPartyAccess).toEqual(['party-a', 'party-b']);
    expect(adjustments).toEqual(['party-b']);
    expect(toggleAccessId(nextPartyAccess, 'party-a')).toEqual(['party-b']);
  });

  it('maps active and pending accounts to suspension, and suspended accounts to activation', () => {
    expect(nextWorkerStatus('active')).toBe('suspended');
    expect(nextWorkerStatus('pending')).toBe('suspended');
    expect(nextWorkerStatus('suspended')).toBe('active');
    expect(workerStatusLabel('pending')).toBe('পেন্ডিং');
  });
});