import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useListParties } from '@workspace/api-client-react';
import { AppButton, EmptyState, Field, LoadingState, Notice, Page, PageHeader, PartyCard } from '@/components/Kit';
import { errorMessage, type PartyRecord } from '@/lib/domain';
import { useColors } from '@/hooks/useColors';

export default function PartiesScreen() {
  const colors = useColors();
  const [search, setSearch] = useState('');
  const parties = useListParties({ search: search.trim() || undefined });

  return (
    <Page onRefresh={() => { void parties.refetch(); }} refreshing={parties.isRefetching}>
      <PageHeader
        title="হিসাবের মানুষ"
        subtitle="কাস্টমার ও সাপ্লায়ারের বাকি"
        right={<AppButton title="নতুন" icon="plus" compact onPress={() => router.push('/party/new')} testID="parties-add" />}
      />
      <Field label="খুঁজুন" value={search} onChangeText={setSearch} placeholder="নাম বা ফোন নম্বর" testID="party-search" />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{parties.data?.length ?? 0}টি হিসাব</Text>
        {search ? <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '700' }} onPress={() => setSearch('')}>মুছুন</Text> : null}
      </View>
      {parties.isLoading ? <LoadingState label="হিসাব লোড হচ্ছে…" /> : null}
      {parties.isError ? <Notice message={errorMessage(parties.error, 'হিসাব লোড করা যায়নি।')} onRetry={() => { void parties.refetch(); }} /> : null}
      {parties.data?.map((party) => (
        <PartyCard key={party.id} party={party as PartyRecord} onPress={() => router.push({ pathname: '/party/[partyId]', params: { partyId: party.id } })} />
      ))}
      {parties.isSuccess && parties.data?.length === 0 ? (
        <EmptyState title={search ? 'কোনো ফল পাওয়া যায়নি' : 'এখনও কোনো হিসাব নেই'} description={search ? 'অন্য নাম বা নম্বর দিয়ে খুঁজুন।' : 'প্রথম কাস্টমার বা সাপ্লায়ারের হিসাব যোগ করুন।'} icon="users" />
      ) : null}
    </Page>
  );
}