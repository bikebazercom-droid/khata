// Shared by the generated worker and policy tests. No API, auth, object, or
// third-party responses are ever put into CacheStorage.
export function isShellRequest(url, origin, base, assets) {
  const parsed = new URL(url);
  return parsed.origin === origin && parsed.pathname.startsWith(base) &&
    assets.includes(parsed.pathname);
}

export function isAppNavigation(url, origin, base) {
  const parsed = new URL(url);
  if (parsed.origin !== origin || !parsed.pathname.startsWith(base)) return false;
  const route = parsed.pathname.slice(base.length);
  return route === '' || route === 'index.html' ||
    route === 'sign-in' || route === 'sign-up' ||
    route === 'access' || route === 'reports' || route === 'staff-deployment' ||
    /^party\/[^/]+(?:\/(?:entry\/[^/]+|profile|report))?$/.test(route);
}