import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useGetParty, useListLedgerEntries } from '@workspace/api-client-react';
import { AppButton, Card, EmptyState, EntryRow, LoadingState, Notice, Page, PageHeader, StatCard } from '@/components/Kit';
import { useAuth } from '@/contexts/AuthContext';
import { errorMessage, formatMoney, type LedgerRecord, type PartyRecord } from '@/lib/domain';
import { useColors } from '@/hooks/useColors';
import { buildPartyStatementHtml, calculatePartyStatement, shareReportPdf, type StatementPeriod } from '@/lib/reportPdf';

const PERIODS: { value: StatementPeriod; label: string }[] = [
  { value: 'all', label: 'সব সময়' },
  { value: 'month', label: 'এই মাস' },
  { value: '30days', label: 'গত ৩০ দিন' },
];

function periodLabel(period: StatementPeriod): string {
  if (period === 'month') return 'চলতি মাস';
  if (period === '30days') return 'গত ৩০ দিন';
  return 'সকল লেনদেন';
}

export default function PartyStatementScreen() {
  const colors = useColors();
  const { identity } = useAuth();
  const params = useLocalSearchParams<{ partyId: string }>();
  const partyId = params.partyId;
  const [period, setPeriod] = useState<StatementPeriod>('all');
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const partyQuery = useGetParty(partyId);
  const entriesQuery = useListLedgerEntries(partyId);
  const party = partyQuery.data as PartyRecord | undefined;
  const entries = (entriesQuery.data ?? []) as LedgerRecord[];
  const statement = useMemo(() => calculatePartyStatement(entries, period), [entries, period]);

  const share = async () => {
    if (!party) return;
    setError('');
    setNotice('');
    setSharing(true);
    try {
      const html = buildPartyStatementHtml({
        businessName: identity?.businessName || 'বাংলাখাতা',
        party,
        periodLabel: periodLabel(period),
        statement,
      });
      const result = await shareReportPdf(html, `${party.name} স্টেটমেন্ট`);
      setNotice(result === 'shared' ? 'PDF শেয়ার করার জন্য প্রস্তুত।' : 'প্রিন্ট মেনু খোলা হয়েছে—সেখান থেকে PDF সেভ করতে পারবেন।');
    } catch (shareError) {
      setError(errorMessage(shareError, 'PDF তৈরি বা শেয়ার করা যায়নি। আবার চেষ্টা করুন।'));
    } finally {
      setSharing(false);
    }
  };

  if (partyQuery.isLoading) return <Page><LoadingState label="স্টেটমেন্ট লোড হচ্ছে…" /></Page>;
  if (partyQuery.isError || !party) return <Page><Notice message={errorMessage(partyQuery.error, 'এই হিসাবটি পাওয়া যায়নি।')} onRetry={() => { void partyQuery.refetch(); }} /></Page>;

  return (
    <Page
      onRefresh={() => { void Promise.all([partyQuery.refetch(), entriesQuery.refetch()]); }}
      refreshing={partyQuery.isRefetching || entriesQuery.isRefetching}
    >
      <PageHeader
        title="স্টেটমেন্ট"
        subtitle={`${party.name} · ${party.role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'}`}
        onBack={() => router.back()}
      />

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {PERIODS.map((option) => {
          const selected = period === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => setPeriod(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              testID={`statement-period-${option.value}`}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 42,
                paddingHorizontal: 8,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.primary : colors.card,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontSize: 12, fontWeight: '700' }}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {entriesQuery.isError ? <Notice message={errorMessage(entriesQuery.error, 'লেনদেন লোড করা যায়নি।')} onRetry={() => { void entriesQuery.refetch(); }} /> : null}
      {entriesQuery.isLoading ? <LoadingState label="লেনদেন লোড হচ্ছে…" /> : null}
      {notice ? <Notice message={notice} tone="info" /> : null}
      {error ? <Notice message={error} /> : null}

      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <StatCard label="আপনি দিয়েছেন" amount={statement.gave} tone="warning" />
        <StatCard label="আপনি পেয়েছেন" amount={statement.received} tone="success" />
      </View>
      <Card>
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>ওপেনিং ব্যালেন্স · {periodLabel(period)}</Text>
        <Text style={{ color: colors.foreground, fontSize: 19, fontWeight: '800' }}>{statement.openingBalance < 0 ? '−' : ''}{formatMoney(Math.abs(statement.openingBalance))}</Text>
        <View style={{ height: 1, backgroundColor: colors.border }} />
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>বর্তমান ব্যালেন্স</Text>
        <Text style={{ color: colors.primary, fontSize: 23, fontWeight: '800' }}>{formatMoney(Math.abs(statement.closingBalance))}{statement.closingBalance === 0 ? ' · সমান' : statement.closingBalance > 0 ? ' · পাওনা' : ' · দেনা'}</Text>
      </Card>

      <AppButton
        title="PDF শেয়ার করুন"
        icon="share-2"
        onPress={() => { void share(); }}
        loading={sharing}
        disabled={entriesQuery.isLoading || entriesQuery.isError}
        testID="party-statement-share"
      />

      <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: '800', marginTop: 2 }}>লেনদেন · {statement.entries.length}</Text>
      {statement.entries.map((entry) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          onPress={() => router.push({ pathname: '/entry/[entryId]', params: { entryId: entry.id, partyId } })}
        />
      ))}
      {entriesQuery.isSuccess && statement.entries.length === 0 ? (
        <EmptyState title="এই সময়ে কোনো লেনদেন নেই" description="অন্য সময়সীমা বেছে নিন অথবা পরে আবার দেখুন।" icon="file-text" />
      ) : null}
    </Page>
  );
}