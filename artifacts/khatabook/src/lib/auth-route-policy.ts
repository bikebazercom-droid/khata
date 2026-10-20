export function isPublicAuthRoute(path: string): boolean {
  return /^\/(?:sign-in|sign-up)(?:\/|$)/.test(path);
}
