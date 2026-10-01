export type AuthMeQueryKey = readonly ['auth-me', string | undefined];

/**
 * Keep every auth-me observer on the same key. A missing Clerk ID is the
 * normal case for phone-OTP sessions and must still match the OTP cache seed.
 */
export function authMeQueryKey(clerkUserId?: string | null): AuthMeQueryKey {
  return ['auth-me', clerkUserId ?? undefined];
}