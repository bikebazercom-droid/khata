import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system/legacy';
import { createLedgerEntry, requestUploadUrl } from '@workspace/api-client-react';
import { submitEntryDirectly, type LiveEntrySubmission } from './live-entry-submit-core';

export function submitLiveLedgerEntry(submission: LiveEntrySubmission) {
  return submitEntryDirectly(submission, {
    async canReachServer() {
      const state = await NetInfo.fetch();
      return state.isConnected !== false && state.isInternetReachable !== false;
    },
    async uploadBill(imageUri, businessId) {
      const file = await FileSystem.getInfoAsync(imageUri);
      if (!file.exists || !file.size) throw new Error('বিলের ছবিটি পড়া যাচ্ছে না।');
      const blob = await (await fetch(imageUri)).blob();
      if (!blob.size) throw new Error('বিলের ছবিটি খালি।');
      const contentType = blob.type || 'image/jpeg';
      const signed = await requestUploadUrl(
        { name: 'bill.jpg', size: blob.size, contentType },
        { headers: { 'x-business-id': businessId } },
      );
      const uploaded = await fetch(signed.uploadURL, {
        method: 'PUT',
        body: blob,
        headers: {
          'Content-Type': contentType,
          ...(signed.uploadToken ? { Authorization: `Bearer ${signed.uploadToken}` } : {}),
        },
      });
      if (!uploaded.ok) throw new Error(`বিলের ছবি আপলোড হয়নি (${uploaded.status})।`);
      return signed.objectPath;
    },
    createEntry(partyId, data, businessId) {
      return createLedgerEntry(partyId, data, { headers: { 'x-business-id': businessId } });
    },
  });
}