import React from 'react';
import { Alert, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetDashboardSummaryQueryKey,
  getGetPartyQueryKey,
  getListGlobalLedgerEntriesQueryKey,
  getListLedgerEntriesQueryKey,
  getListPartiesQueryKey,
  useDeleteParty,
  useGetParty,
  useListLedgerEntries,
} from '@workspace/api-client-react';
import { AppButton, Card, EmptyState, EntryRow, LoadingState, Notice, Page, PageHeader, PartyCard } from '@/components/Kit';
import { useAuth } from '@/contexts/AuthContext';
import { errorMessage, formatMoney, type LedgerRecord, type PartyRecord } from '@/lib/domain';
import { useColors } from '@/hooks/useColors';

export default function PartyDetailScreen() {
  const colors = useColors();
  const { partyId } = useLocalSearchParams<{ partyId: string }>();
  const queryClient = useQueryClient();
  const { identity } = useAuth();
  const partyQuery = useGetParty(partyId);
  const entriesQuery = useListLedgerEntries(partyId);
  const deleteParty = useDeleteParty();
  const party = partyQuery.data as PartyRecord | undefined;
  const entries = (entriesQuery.data ?? []) as LedgerRecord[];

  const removeParty = () => {
    Alert.alert(
      'হিসাবটি চিরতরে মুছবেন?',
      `${party?.name ?? 'এই পার্টি'} এবং তার সব লেনদেন স্থায়ীভাবে মুছে যাবে। এই কাজটি ফেরানো যাবে না।`,
      [
        { text: 'বাতিল', style: 'cancel' },
        {
          text: 'স্থায়ীভাবে মুছুন',
          style: 'destructive',
          onPress: () => {
            void deleteParty.mutateAsync({ partyId }).then(async () => {
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: getListPartiesQueryKey() }),
                queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
                queryClient.invalidateQueries({ queryKey: getListGlobalLedgerEntriesQueryKey({}) }),
              ]);
              router.replace('/(tabs)/parties');
            }).catch((error) => Alert.alert('মুছতে পারেনি', errorMessage(error, 'সার্ভারে আবার চেষ্টা করুন।')));
          },
        },
      ],
    );
  };

  if (partyQuery.isLoading) return <Page><LoadingState label="হিসাব লোড হচ্ছে…" /></Page>;
  if (partyQuery.isError || !party) return <Page><Notice message={errorMessage(partyQuery.error, 'এই হিসাবটি পাওয়া যায়নি।')} onRetry={() => { void partyQuery.refetch(); }} /></Page>;

  const gives = party.balanceType === 'YOU_WILL_GIVE';
  return (
    <Page onRefresh={() => { void Promise.all([partyQuery.refetch(), entriesQuery.refetch()]); }} refreshing={partyQuery.isRefetching || entriesQuery.isRefetching}>
      <PageHeader
        title={party.name}
        subtitle={party.role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'}
        onBack={() => router.back()}
        right={identity?.role === 'owner' ? <Text onPress={removeParty} style={{ color: colors.destructive, fontSize: 13, fontWeight: '700' }}>মুছুন</Text> : undefined}
      />
      {party.phone ? <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>{party.phone}</Text> : null}
      <Card style={{ backgroundColor: colors.primary, borderColor: colors.primary }}>
        <Text style={{ color: colors.primaryForeground, opacity: 0.8, fontSize: 13 }}>{party.currentBalance === 0 ? 'হিসাব সমান' : gives ? 'আপনি দেবেন' : 'আপনি পাবেন'}</Text>
        <Text style={{ color: colors.primaryForeground, fontSize: 30, fontWeight: '800' }}>{formatMoney(party.currentBalance)}</Text>
      </Card>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <AppButton title="লেনদেন লিখুন" icon="plus" onPress={() => router.push({ pathname: '/entry/new', params: { partyId } })} testID="party-add-entry" />
      </View>
      {party.dueDate ? <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>বাকি পাওয়ার তারিখ: {party.dueDate}</Text> : null}
      <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: '800', marginTop: 4 }}>লেনদেনের ইতিহাস</Text>
      {entriesQuery.isLoading ? <LoadingState label="লেনদেন লোড হচ্ছে…" /> : null}
      {entriesQuery.isError ? <Notice message={errorMessage(entriesQuery.error, 'লেনদেন লোড করা যায়নি।')} onRetry={() => { void entriesQuery.refetch(); }} /> : null}
      {entries.map((entry) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          onPress={() => router.push({ pathname: '/entry/[entryId]', params: { entryId: entry.id, partyId } })}
        />
      ))}
      {entriesQuery.isSuccess && entries.length === 0 ? <EmptyState title="এখনও কোনো লেনদেন নেই" description="এই হিসাবের প্রথম এন্ট্রি যোগ করুন।" icon="file-text" /> : null}
    </Page>
  );
}