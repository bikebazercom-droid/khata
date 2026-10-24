import { describe, expect, it } from 'vitest';
import { hasVerifiedPhoneSession } from '../lib/verifiedPhoneSession';

describe('verified phone session', () => {
  it('accepts a server-verified phone session without waiting for Clerk', () => {
    expect(hasVerifiedPhoneSession({
      authMethod: 'phone',
      userId: 'owner-1',
    })).toBe(true);
  });

  it('rejects a phone session after an authoritative 401 or 403', () => {
    const phoneSession = { authMethod: 'phone', userId: 'owner-1' };
    expect(hasVerifiedPhoneSession(phoneSession, 401)).toBe(false);
    expect(hasVerifiedPhoneSession(phoneSession, 403)).toBe(false);
  });

  it('does not treat Clerk identities or incomplete responses as phone sessions', () => {
    expect(hasVerifiedPhoneSession({ authMethod: 'firebase', userId: 'user-1' })).toBe(false);
    expect(hasVerifiedPhoneSession({ authMethod: 'phone' })).toBe(false);
    expect(hasVerifiedPhoneSession(undefined)).toBe(false);
  });
});
