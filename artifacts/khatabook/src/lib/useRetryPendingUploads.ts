/**
 * Background retry service for bill photo uploads that failed while offline.
 *
 * Call this hook once near the app root (inside auth context so API requests
 * are authenticated). It:
 *   1. Immediately retries any pending uploads found in localStorage on mount
 *      (handles the case where the app was reloaded after coming back online).
 *   2. Listens for the browser `online` event and retries when connectivity
 *      is restored.
 *
 * Retry flow per pending record:
 *   a. Re-upload the base64 data URL to cloud storage via `uploadBillImage`.
 *   b. On success: PATCH /api/parties/:partyId/ledger-entries/:entryId with
 *      the new objectPath, then invalidate the relevant React Query caches so
 *      the UI reflects the attached photo automatically.
 *   c. Clear the record from localStorage.
 *   d. On failure: leave the record in place — it will be retried on the next
 *      `online` event or app reload.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListLedgerEntriesQueryKey,
} from '@workspace/api-client-react';
import { toast } from 'sonner';
import { businessScopedQueryKey } from './businessQueryKey';
import { getPendingUploads, removePendingUpload } from './pendingUploads';
import { uploadBillImage } from './billImageStorage';
import { isNetworkWriteAuthorized } from './useAuthConnectivity';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * PATCH a ledger entry's billImage field via a direct fetch.
 * We bypass the generated client because this endpoint was added after
 * codegen was last run — a raw fetch is simpler than re-running the full
 * code-gen pipeline.
 */
async function patchEntryBillImage(
  partyId: string,
  entryId: string,
  objectPath: string,
  businessId: string | null,
): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/parties/${partyId}/ledger-entries/${entryId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(businessId ? { 'X-Business-Id': businessId } : {}),
      },
      body: JSON.stringify({ billImage: objectPath }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function useRetryPendingUploads(enabled: boolean): void {
  const queryClient = useQueryClient();
  // Guard against concurrent retry runs (e.g. rapid online/offline flapping).
  const isRetryingRef = useRef(false);

  const retryAll = useCallback(async () => {
    if (isRetryingRef.current) return;
    const pending = getPendingUploads();
    if (pending.length === 0) return;

    isRetryingRef.current = true;
    let successCount = 0;

    try {
      for (const record of pending) {
        if (!isNetworkWriteAuthorized()) break;
        // Re-upload to cloud storage.
        const uploadResult = await uploadBillImage(record.base64);
        if (!uploadResult.ok) {
          // Still offline or transient error — leave record, abort the loop.
          break;
        }

        // Patch the entry on the server.
        if (!isNetworkWriteAuthorized()) break;
        const patched = await patchEntryBillImage(
          record.partyId,
          record.entryId,
          uploadResult.objectPath,
          record.businessId,
        );
        if (!patched) {
          // Server-side error — leave record, try again next time.
          break;
        }

        // Success: clean up and refresh the ledger cache for this party.
        removePendingUpload(record.entryId);
        queryClient.invalidateQueries({
          queryKey: businessScopedQueryKey(
            getListLedgerEntriesQueryKey(record.partyId),
            record.businessId,
          ),
        });
        successCount++;
      }
    } finally {
      isRetryingRef.current = false;
    }

    if (successCount > 0) {
      toast.success(
        successCount === 1
          ? 'বিল ছবি সংযুক্ত হয়েছে'
          : `${successCount}টি বিল ছবি সংযুক্ত হয়েছে`,
        {
          description: 'ইন্টারনেট সংযোগ ফিরে আসায় বিলের ছবি স্বয়ংক্রিয়ভাবে আপলোড হয়েছে।',
          duration: 5000,
        }
      );
    }
  }, [queryClient]);

  useEffect(() => {
    if (!enabled) return;

    // Attempt immediately in case we're already online and there are stale records.
    void retryAll();

    const handleOnline = () => {
      void retryAll();
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [enabled, retryAll]);
}
