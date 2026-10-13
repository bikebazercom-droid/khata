/**
 * The mobile shell is tied to the production website. Do not derive this from
 * Expo build variables: cloud builds can substitute missing values as the
 * literal hostname "undefined".
 */
export function resolveWebAppUrl(): string {
  return 'https://banglakhata.com';
}

export function resolveWebAppStartUrl(hasNativeSession: boolean): string {
  const route = hasNativeSession ? '/dashboard' : '/sign-in';
  return new URL(route, resolveWebAppUrl()).toString();
}

export function getWebAppUrl(): string {
  return resolveWebAppUrl();
}