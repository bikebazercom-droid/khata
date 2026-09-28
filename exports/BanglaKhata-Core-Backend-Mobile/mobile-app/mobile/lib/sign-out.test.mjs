import assert from 'node:assert/strict';
import { test } from 'node:test';
import { revokeAndClearMobileSessions } from './sign-out.ts';

test('a failed phone revocation leaves the stored credential available to retry', async () => {
  let storedToken = 'copied-phone-token';
  let revokeFails = true;
  const run = () => revokeAndClearMobileSessions({
    isClerkSignedIn: false,
    readPhoneToken: async () => storedToken,
    revokePhone: async () => { if (revokeFails) throw Object.assign(new Error('DB unavailable'), { status: 500 }); },
    getClerkToken: async () => null,
    revokeClerk: async () => {},
    signOutClerk: async () => {},
    deletePhoneToken: async () => { storedToken = null; },
  });
  await assert.rejects(run(), { status: 500 });
  assert.equal(storedToken, 'copied-phone-token');
  revokeFails = false;
  await run();
  assert.equal(storedToken, null);
});

test('a failed Clerk SDK sign-out retains the local token, and a revoked-session retry succeeds', async () => {
  let storedToken = 'phone-token';
  let sdkFails = true;
  let revoked = false;
  const run = () => revokeAndClearMobileSessions({
    isClerkSignedIn: true,
    readPhoneToken: async () => storedToken,
    revokePhone: async () => {},
    getClerkToken: async () => 'clerk-token',
    revokeClerk: async () => {
      if (revoked) throw Object.assign(new Error('Already revoked'), { status: 401 });
      revoked = true;
    },
    signOutClerk: async () => { if (sdkFails) throw new Error('Clerk unavailable'); },
    deletePhoneToken: async () => { storedToken = null; },
  });
  await assert.rejects(run(), /Clerk unavailable/);
  assert.equal(storedToken, 'phone-token');
  sdkFails = false;
  await run();
  assert.equal(storedToken, null);
});