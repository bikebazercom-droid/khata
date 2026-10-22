import { isPublicAuthRoute } from './auth-route-policy';

export const PENDING_SHELL_RELOAD_KEY = 'banglakhata:pending-shell-reload';

export function handleShellVersionMessage(
  message: unknown,
  path: string,
  currentVersion: string | null,
  reload: () => void,
): string | null {
  const update = message as { type?: unknown; version?: unknown } | null;
  if (
    update?.type !== 'banglakhata-shell-version' ||
    typeof update.version !== 'string' ||
    !update.version ||
    update.version === currentVersion
  ) return null;

  if (!deferShellReloadDuringAuth(path, update.version)) reload();
  return update.version;
}

export function deferShellReloadDuringAuth(path: string, version: string): boolean {
  if (!isPublicAuthRoute(path)) return false;

  try {
    window.sessionStorage.setItem(PENDING_SHELL_RELOAD_KEY, version);
  } catch {
    // Keep the sign-in form stable even when browser storage is unavailable.
  }
  return true;
}

export function applyPendingShellReload(path: string, reload: () => void): boolean {
  if (isPublicAuthRoute(path)) return false;

  try {
    if (!window.sessionStorage.getItem(PENDING_SHELL_RELOAD_KEY)) return false;
    window.sessionStorage.removeItem(PENDING_SHELL_RELOAD_KEY);
    reload();
    return true;
  } catch {
    return false;
  }
}
