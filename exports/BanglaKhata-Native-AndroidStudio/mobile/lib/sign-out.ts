type SignOutActions = {
  isClerkSignedIn: boolean;
  readPhoneToken: () => Promise<string | null>;
  revokePhone: (token: string) => Promise<void>;
  getClerkToken: () => Promise<string | null>;
  revokeClerk: (token: string) => Promise<void>;
  signOutClerk: () => Promise<void>;
  deletePhoneToken: () => Promise<void>;
};

/** Never discard a credential until its server-side revocation succeeds. */
export async function revokeAndClearMobileSessions(actions: SignOutActions): Promise<void> {
  const phoneToken = await actions.readPhoneToken();
  if (phoneToken) await actions.revokePhone(phoneToken);

  if (actions.isClerkSignedIn) {
    const clerkToken = await actions.getClerkToken();
    if (!clerkToken) throw new Error('Clerk session token unavailable');
    try {
      await actions.revokeClerk(clerkToken);
    } catch (error) {
      // The first attempt can revoke the server session before the Clerk SDK
      // fails. A 401 means that same bearer token is already unusable.
      if ((error as { status?: number })?.status !== 401) throw error;
    }
    await actions.signOutClerk();
  }

  await actions.deletePhoneToken();
}