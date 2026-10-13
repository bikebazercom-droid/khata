/**
 * The mobile shell is tied to the production website. Do not derive this from
 * Expo build variables: cloud builds can substitute missing values as the
 * literal hostname "undefined".
 */
const PRODUCTION_WEB_APP_URL = 'https://banglakhata.com';

export function resolveWebAppUrl(): string {
  return PRODUCTION_WEB_APP_URL;
}

export function resolveWebAppStartUrl(hasNativeSession: boolean): string {
  const route = hasNativeSession ? 'dashboard' : 'sign-in';
  return `${PRODUCTION_WEB_APP_URL}/${route}`;
}

export function getWebAppUrl(): string {
  return resolveWebAppUrl();
}