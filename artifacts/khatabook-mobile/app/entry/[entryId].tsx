import React from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useListLedgerEntries } from '@workspace/api-client-react';
import { LoadingState, Notice, Page } from '@/components/Kit';
import { LedgerEntryForm } from '@/components/LedgerEntryForm';
import { errorMessage, type LedgerRecord } from '@/lib/domain';

export default function EntryDetailScreen() {
  const { entryId, partyId } = useLocalSearchParams<{ entryId: string; partyId: string }>();
  const entriesQuery = useListLedgerEntries(partyId);
  if (entriesQuery.isLoading) return <Page><LoadingState label="লেনদেন লোড হচ্ছে…" /></Page>;
  if (entriesQuery.isError) return <Page><Notice message={errorMessage(entriesQuery.error, 'লেনদেন লোড করা যায়নি।')} onRetry={() => { void entriesQuery.refetch(); }} /></Page>;
  const entry = (entriesQuery.data as LedgerRecord[] | undefined)?.find((item) => item.id === entryId);
  if (!entry) return <Page><Notice message="এই লেনদেনটি পাওয়া যায়নি।" onRetry={() => router.back()} /></Page>;
  return <LedgerEntryForm mode="edit" partyId={partyId} entry={entry} />;
}