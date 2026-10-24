export type AuthMeQueryKey = readonly ['auth-me', string | undefined];
export type AuthRouteMeQueryKey = readonly ['auth-me', string | undefined, 'route-check', number];

/**
 * Keep normal auth-me observers on the same key. A missing identity ID is the
 * normal case for phone-OTP sessions and must still match the OTP cache seed.
 * Sign-in routes use authRouteMeQueryKey so a prior session cannot redirect
 * the user away before the server validates the current session.
 */
export function authMeQueryKey(identityId?: string | null): AuthMeQueryKey {
  return ['auth-me', identityId ?? undefined];
}

/**
 * Public sign-in routes must validate the current server session instead of
 * inheriting a successful /me result cached by the previous app session.
 */
export function authRouteMeQueryKey(
  identityId: string | null | undefined,
  requestId: number,
): AuthRouteMeQueryKey {
  return ['auth-me', identityId ?? undefined, 'route-check', requestId];
}