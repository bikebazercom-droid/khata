/** Public HTTPS origin for the live API, configured in public-build.json. */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/+$/, '');