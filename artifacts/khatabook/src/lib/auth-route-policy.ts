export function isPublicAuthRoute(path: string): boolean {
  return /^\/(?:sign-in|sign-up)(?:\/|$)/.test(path);
}

export function shouldUseOfflineIdentityFallback(path: string): boolean {
  return !isPublicAuthRoute(path);
}

export function authenticatedLandingPath(role: string | undefined): string {
  return role === 'staff' ? '/' : '/dashboard';
}
