/**
 * Resolve the website loaded by the Expo shell.
 *
 * Expo development/build workflows provide EXPO_PUBLIC_DOMAIN. A dedicated
 * website URL can override it when mobile and web are published on different
 * hosts.
 */
export function resolveWebAppUrl(
  configuredUrl?: string,
  deploymentDomain?: string,
): string | null {
  const explicitUrl = configuredUrl?.trim();
  const domain = deploymentDomain?.trim();
  const candidate = explicitUrl || domain;
  if (!candidate) return null;

  const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`;

  try {
    const url = new URL(normalized);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
      return null;
    }

    if (!explicitUrl) {
      url.pathname = '/';
      url.search = '';
      url.hash = '';
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function getWebAppUrl(): string | null {
  return resolveWebAppUrl(
    process.env.EXPO_PUBLIC_WEB_APP_URL,
    process.env.EXPO_PUBLIC_DOMAIN,
  );
}