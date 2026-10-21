export type AuthMeQueryKey = readonly ['auth-me', string | undefined];
export type AuthRouteMeQueryKey = readonly ['auth-me', string | undefined, 'route-check', number];

/**
 * Keep every auth-me observer on the same key. A missing Clerk ID is the
 * normal case for phone-OTP sessions and must still match the OTP cache seed.
 */
export function authMeQueryKey(clerkUserId?: string | null): AuthMeQueryKey {
  return ['auth-me', clerkUserId ?? undefined];
}

/**
 * Public sign-in routes must validate the current server session instead of
 * inheriting a successful /me result cached by the previous app session.
 */
export function authRouteMeQueryKey(
  clerkUserId: string | null | undefined,
  requestId: number,
): AuthRouteMeQueryKey {
  return ['auth-me', clerkUserId ?? undefined, 'route-check', requestId];
}