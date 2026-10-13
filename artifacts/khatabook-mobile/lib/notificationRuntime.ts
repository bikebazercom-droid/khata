export function canUseNativeNotifications(
  platform: string,
  isDevelopment: boolean,
): boolean {
  return platform !== 'web' && !isDevelopment;
}
