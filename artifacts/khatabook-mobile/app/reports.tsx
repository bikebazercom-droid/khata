import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useListParties } from '@workspace/api-client-react';
import { AppButton, Card, EmptyState, LoadingState, Notice, Page, PageHeader, PartyCard, StatCard } from '@/components/Kit';
import { useAuth } from '@/contexts/AuthContext';
import { errorMessage, type PartyRecord } from '@/lib/domain';
import { useColors } from '@/hooks/useColors';
import { buildPartyBalancesHtml, shareReportPdf } from '@/lib/reportPdf';

type RoleFilter = 'ALL' | 'CUSTOMER' | 'SUPPLIER';

const FILTERS: { value: RoleFilter; label: string }[] = [
  { value: 'ALL', label: 'সব' },
  { value: 'CUSTOMER', label: 'কাস্টমার' },
  { value: 'SUPPLIER', label: 'সাপ্লায়ার' },
];

export default function ReportsScreen() {
  const colors = useColors();
  const { identity } = useAuth();
  const [role, setRole] = useState<RoleFilter>('ALL');
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const partiesQuery = useListParties();
  const allParties = (partiesQuery.data ?? []) as PartyRecord[];
  const parties = useMemo(
    () => allParties.filter((party) => role === 'ALL' || party.role === role),
    [allParties, role],
  );
  const totalGet = parties.reduce((sum, party) => sum + (party.balanceType === 'YOU_WILL_GET' ? party.currentBalance : 0), 0);
  const totalGive = parties.reduce((sum, party) => sum + (party.balanceType === 'YOU_WILL_GIVE' ? party.currentBalance : 0), 0);

  const share = async () => {
    setError('');
    setNotice('');
    setSharing(true);
    try {
      const html = buildPartyBalancesHtml({
        businessName: identity?.businessName || 'বাংলাখাতা',
        parties,
        role,
      });
      const result = await shareReportPdf(html, 'বাংলাখাতা হিসাব রিপোর্ট');
      setNotice(result === 'shared' ? 'PDF শেয়ার করার জন্য প্রস্তুত।' : 'প্রিন্ট মেনু খোলা হয়েছে—সেখান থেকে PDF সেভ করতে পারবেন।');
    } catch (shareError) {
      setError(errorMessage(shareError, 'PDF তৈরি বা শেয়ার করা যায়নি। আবার চেষ্টা করুন।'));
    } finally {
      setSharing(false);
    }
  };

  return (
    <Page onRefresh={() => { void partiesQuery.refetch(); }} refreshing={partiesQuery.isRefetching}>
      <PageHeader title="PDF রিপোর্ট" subtitle="হিসাবের সারাংশ ও পার্টির ব্যালেন্স" onBack={() => router.back()} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {FILTERS.map((filter) => {
          const selected = role === filter.value;
          return (
            <Pressable
              key={filter.value}
              onPress={() => setRole(filter.value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              testID={`report-role-${filter.value.toLowerCase()}`}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 42,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.primary : colors.card,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontSize: 13, fontWeight: '700' }}>{filter.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {partiesQuery.isLoading ? <LoadingState label="হিসাব লোড হচ্ছে…" /> : null}
      {partiesQuery.isError ? <Notice message={errorMessage(partiesQuery.error, 'হিসাব লোড করা যায়নি।')} onRetry={() => { void partiesQuery.refetch(); }} /> : null}
      {notice ? <Notice message={notice} tone="info" /> : null}
      {error ? <Notice message={error} /> : null}

      {!partiesQuery.isLoading && !partiesQuery.isError ? (
        <>
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <StatCard label="আপনি পাবেন" amount={totalGet} tone="success" />
            <StatCard label="আপনি দেবেন" amount={totalGive} tone="warning" />
          </View>
          <Card>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>রিপোর্টে অন্তর্ভুক্ত হিসাব</Text>
            <Text style={{ color: colors.foreground, fontSize: 22, fontWeight: '800' }}>{parties.length}</Text>
          </Card>
          <AppButton
            title="PDF শেয়ার করুন"
            icon="share-2"
            onPress={() => { void share(); }}
            loading={sharing}
            disabled={partiesQuery.isLoading}
            testID="balances-report-share"
          />
          {parties.length ? parties.map((party) => (
            <PartyCard
              key={party.id}
              party={party}
              onPress={() => router.push({ pathname: '/party/[partyId]', params: { partyId: party.id } })}
            />
          )) : (
            <EmptyState title="এই তালিকায় কোনো হিসাব নেই" description="অন্য ধরন বেছে নিন অথবা একটি নতুন হিসাব যোগ করুন।" icon="users" />
          )}
        </>
      ) : null}
    </Page>
  );
}