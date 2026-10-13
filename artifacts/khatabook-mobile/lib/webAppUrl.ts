/**
 * Resolve the website loaded by the Expo shell.
 *
 * Expo build variables can be missing or contain placeholder values, so the
 * production website is always available as the final fallback.
 */
const PRODUCTION_WEB_APP_URL = 'https://banglakhata.com/';

export function resolveWebAppUrl(
  configuredUrl?: string,
  deploymentDomain?: string,
): string {
  const candidates = [
    { value: configuredUrl?.trim(), explicit: true },
    { value: deploymentDomain?.trim(), explicit: false },
  ];

  for (const candidate of candidates) {
    if (!candidate.value) continue;
    const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(candidate.value)
      ? candidate.value
      : `https://${candidate.value}`;

    try {
      const url = new URL(normalized);
      if (
        url.protocol !== 'https:'
        || !url.hostname
        || ['undefined', 'null', 'none'].includes(url.hostname.toLowerCase())
        || url.username
        || url.password
      ) {
        continue;
      }

      if (!candidate.explicit) {
        url.pathname = '/';
        url.search = '';
        url.hash = '';
      }

      return url.toString();
    } catch {
      // Try the deployment-domain fallback if an explicit URL is malformed.
    }
  }

  return PRODUCTION_WEB_APP_URL;
}

export function resolveWebAppStartUrl(
  webAppUrl: string,
  hasNativeSession: boolean,
): string | null {
  try {
    const url = new URL(webAppUrl);
    const basePath = url.pathname.replace(/\/+$/, "");
    url.pathname = `${basePath}${hasNativeSession ? "/dashboard" : "/sign-in"}`;
    return url.toString();
  } catch {
    return null;
  }
}

export function getWebAppUrl(): string {
  return resolveWebAppUrl(
    process.env.EXPO_PUBLIC_WEB_APP_URL,
    process.env.EXPO_PUBLIC_DOMAIN,
  );
}