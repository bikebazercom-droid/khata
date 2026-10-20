export function isPublicAuthRoute(path: string): boolean {
  return /^\/(?:sign-in|sign-up)(?:\/|$)/.test(path);
}

export function shouldUseOfflineIdentityFallback(path: string): boolean {
  return !isPublicAuthRoute(path);
}
