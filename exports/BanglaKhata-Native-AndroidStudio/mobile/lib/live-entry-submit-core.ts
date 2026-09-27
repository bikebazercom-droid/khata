import type { LedgerEntry, LedgerEntryInput } from '@workspace/api-client-react';

export type LiveEntrySubmission = {
  partyId: string;
  businessId: string;
  clientRequestId: string;
  data: LedgerEntryInput;
  imageUri?: string;
};

export type LiveEntrySubmissionServices = {
  canReachServer(): Promise<boolean>;
  uploadBill(imageUri: string, businessId: string): Promise<string>;
  createEntry(partyId: string, data: LedgerEntryInput, businessId: string): Promise<LedgerEntry>;
};

/**
 * Submit only to the authenticated server. This function has no local storage
 * dependency: on failure, callers keep the unsaved form in memory for retry.
 */
export async function submitEntryDirectly(
  submission: LiveEntrySubmission,
  services: LiveEntrySubmissionServices,
): Promise<LedgerEntry> {
  if (!(await services.canReachServer())) {
    throw new Error('ইন্টারনেট সংযোগ নেই। এন্ট্রি সার্ভারে জমা হয়নি এবং ডিভাইসে সংরক্ষণ করা হয়নি।');
  }

  const billImage = submission.imageUri
    ? await services.uploadBill(submission.imageUri, submission.businessId)
    : undefined;
  return services.createEntry(
    submission.partyId,
    {
      ...submission.data,
      clientRequestId: submission.clientRequestId,
      ...(billImage ? { billImage } : {}),
    },
    submission.businessId,
  );
}