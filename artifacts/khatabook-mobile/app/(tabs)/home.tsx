import React from 'react';
import { Image, Text, View } from 'react-native';
import { router } from 'expo-router';
import { getGetDashboardSummaryQueryKey, getListGlobalLedgerEntriesQueryKey, useGetDashboardSummary, useListGlobalLedgerEntries } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { AppButton, Card, EmptyState, EntryRow, LoadingState, Page, PageHeader, SectionTitle, StatCard, Notice } from '@/components/Kit';
import { useAuth } from '@/contexts/AuthContext';
import { errorMessage, type GlobalLedgerRecord } from '@/lib/domain';
import { useColors } from '@/hooks/useColors';

export default function HomeScreen() {
  const colors = useColors();
  const { identity, refreshIdentity } = useAuth();
  const queryClient = useQueryClient();
  const summary = useGetDashboardSummary();
  const recent = useListGlobalLedgerEntries({});
  const refresh = () => {
    void Promise.all([
      summary.refetch(),
      recent.refetch(),
      refreshIdentity(),
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListGlobalLedgerEntriesQueryKey({}) }),
    ]);
  };

  return (
    <Page onRefresh={refresh} refreshing={summary.isRefetching || recent.isRefetching}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Image source={require('../../assets/images/brand-icon.png')} style={{ width: 42, height: 42, borderRadius: 12 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>স্বাগতম</Text>
          <Text style={{ color: colors.foreground, fontSize: 20, fontWeight: '800' }} numberOfLines={1}>{identity?.businessName || 'বাংলাখাতা'}</Text>
        </View>
      </View>

      {summary.isLoading ? <LoadingState label="হিসাবের সারাংশ লোড হচ্ছে…" /> : null}
      {summary.isError ? <Notice message={errorMessage(summary.error, 'সারাংশ লোড করা যায়নি।')} onRetry={() => { void summary.refetch(); }} /> : null}

      {summary.data ? (
        <>
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <StatCard label="আপনি পাবেন" amount={summary.data.youWillGet} tone="success" />
            <StatCard label="আপনি দেবেন" amount={summary.data.youWillGive} tone="warning" />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Card style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>কাস্টমার</Text>
              <Text style={{ color: colors.foreground, fontSize: 22, fontWeight: '800' }}>{summary.data.customerCount}</Text>
            </Card>
            <Card style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>সাপ্লায়ার</Text>
              <Text style={{ color: colors.foreground, fontSize: 22, fontWeight: '800' }}>{summary.data.supplierCount}</Text>
            </Card>
          </View>
        </>
      ) : null}

      <View style={{ gap: 10 }}>
        <AppButton title="নতুন হিসাব যোগ করুন" icon="plus" variant="accent" onPress={() => router.push('/party/new')} testID="home-add-party" />
        <AppButton title="লেনদেন লিখুন" icon="repeat" variant="primary" onPress={() => router.push('/entry/new')} testID="home-add-entry" />
        <AppButton title="হিসাবের PDF রিপোর্ট" icon="file-text" variant="secondary" onPress={() => router.push('/reports')} testID="home-open-reports" />
      </View>

      <SectionTitle title="সাম্প্রতিক লেনদেন" action="সব দেখুন" onAction={() => router.push('/(tabs)/activity')} />
      {recent.isLoading ? <LoadingState label="লেনদেন লোড হচ্ছে…" /> : null}
      {recent.isError ? <Notice message={errorMessage(recent.error, 'লেনদেন লোড করা যায়নি।')} onRetry={() => { void recent.refetch(); }} /> : null}
      {recent.data?.length ? (
        <Card style={{ paddingVertical: 4 }}>
          {recent.data.slice(0, 5).map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry as GlobalLedgerRecord}
              partyName={(entry as GlobalLedgerRecord).partyName}
              onPress={() => router.push({ pathname: '/entry/[entryId]', params: { entryId: entry.id, partyId: (entry as GlobalLedgerRecord).partyId } })}
            />
          ))}
        </Card>
      ) : recent.isSuccess ? <EmptyState title="এখনও কোনো লেনদেন নেই" description="একটি হিসাব খুলে প্রথম লেনদেনটি লিখুন।" icon="file-text" /> : null}
    </Page>
  );
}