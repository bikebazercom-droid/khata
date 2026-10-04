import type { QueryClient } from '@tanstack/react-query';

/**
 * Browser ledger snapshots have been retired. Keep this no-op for one-release
 * compatibility with any remaining caller while leaving all existing local
 * snapshot keys untouched.
 */
export function persistCache(_queryClient: QueryClient): () => void {
  return () => {};
}