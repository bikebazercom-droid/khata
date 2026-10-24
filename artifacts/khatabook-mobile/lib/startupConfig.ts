type MobileStartupEnvironment = {
  apiDomain?: string | null;
};

function resolveApiBaseUrl(apiDomain?: string | null): string | null {
  const value = apiDomain?.trim();
  if (!value) return null;

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function resolveMobileStartupConfig(environment: MobileStartupEnvironment) {
  return {
    apiBaseUrl: resolveApiBaseUrl(environment.apiDomain),
  };
}
