import React, { useState } from 'react';
import { router } from 'expo-router';
import { useListGlobalLedgerEntries } from '@workspace/api-client-react';
import { AppButton, EmptyState, EntryRow, Field, LoadingState, Notice, Page, PageHeader } from '@/components/Kit';
import { errorMessage, type GlobalLedgerRecord } from '@/lib/domain';

export default function ActivityScreen() {
  const [search, setSearch] = useState('');
  const entries = useListGlobalLedgerEntries({ search: search.trim() || undefined });

  return (
    <Page onRefresh={() => { void entries.refetch(); }} refreshing={entries.isRefetching}>
      <PageHeader title="লেনদেন" subtitle="সব হিসাবের সাম্প্রতিক এন্ট্রি" right={<AppButton title="নতুন" icon="plus" compact onPress={() => router.push('/entry/new')} testID="activity-add-entry" />} />
      <Field label="খুঁজুন" value={search} onChangeText={setSearch} placeholder="পার্টি, ফোন বা বিবরণ" testID="activity-search" />
      {entries.isLoading ? <LoadingState label="লেনদেন লোড হচ্ছে…" /> : null}
      {entries.isError ? <Notice message={errorMessage(entries.error, 'লেনদেন লোড করা যায়নি।')} onRetry={() => { void entries.refetch(); }} /> : null}
      {entries.data?.map((entry) => {
        const item = entry as GlobalLedgerRecord;
        return (
          <EntryRow
            key={item.id}
            entry={item}
            partyName={item.partyName}
            onPress={() => router.push({ pathname: '/entry/[entryId]', params: { entryId: item.id, partyId: item.partyId } })}
          />
        );
      })}
      {entries.isSuccess && entries.data?.length === 0 ? <EmptyState title="কোনো লেনদেন পাওয়া যায়নি" description="অন্য শব্দ দিয়ে খুঁজুন অথবা নতুন লেনদেন লিখুন।" icon="activity" /> : null}
    </Page>
  );
}