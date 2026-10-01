import { lazy, type ComponentType } from 'react';

const RECOVERY_PARAM = '__banglakhata_chunk_retry';
const RECOVERY_KEY_PREFIX = 'banglakhata:chunk-recovery:';

export function isLazyChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk .* failed|unable to preload css|chunkloaderror/i.test(message);
}

function clearRecoveryState(): void {
  try {
    sessionStorage.removeItem(RECOVERY_KEY_PREFIX + window.location.pathname);
  } catch {
    // Recovery is best-effort when browser storage is unavailable.
  }

  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has(RECOVERY_PARAM)) {
      url.searchParams.delete(RECOVERY_PARAM);
      window.history.replaceState(window.history.state, '', url);
    }
  } catch {
    // URL cleanup is best-effort; it must not interfere with rendering.
  }
}

function reloadOnceForStaleChunk(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.onLine) {
    return false;
  }

  const key = RECOVERY_KEY_PREFIX + window.location.pathname;
  try {
    if (sessionStorage.getItem(key) === '1') return false;
    sessionStorage.setItem(key, '1');
    const url = new URL(window.location.href);
    url.searchParams.set(RECOVERY_PARAM, String(Date.now()));
    window.location.replace(url.toString());
    return true;
  } catch {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Ignore unavailable storage.
    }
    return false;
  }
}

/**
 * Recover once when a deployment leaves the current page pointing at a chunk
 * that is no longer available. Other import errors are rethrown to the normal
 * React error boundary, with no reload loop.
 */
export function lazyWithChunkRecovery<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
) {
  return lazy<T>(async () => {
    try {
      const module = await loader();
      clearRecoveryState();
      return module;
    } catch (error) {
      if (isLazyChunkLoadError(error) && reloadOnceForStaleChunk()) {
        return new Promise<never>(() => {});
      }
      throw error;
    }
  });
}