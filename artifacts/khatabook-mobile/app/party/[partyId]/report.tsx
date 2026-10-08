import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { getGetBusinessSettingsQueryKey, useGetBusinessSettings, useGetParty, useListLedgerEntries } from '@workspace/api-client-react';
import { AppButton, Card, EmptyState, EntryRow, LoadingState, Notice, Page, PageHeader, StatCard } from '@/components/Kit';
import { useAuth } from '@/contexts/AuthContext';
import { useBusinessScope } from '@/contexts/BusinessScopeContext';
import { errorMessage, formatMoney, type LedgerRecord, type PartyRecord } from '@/lib/domain';
import { useColors } from '@/hooks/useColors';
import { buildPartyStatementHtml, calculatePartyStatement, embedPartyStatementBillImages, shareReportPdf, type StatementPeriod } from '@/lib/reportPdf';
import { formatReportDateInput, parseReportDate } from '@/lib/globalLedgerReport';

const PERIODS: { value: StatementPeriod; label: string }[] = [
  { value: 'all', label: 'সব সময়' },
  { value: 'month', label: 'এই মাস' },
  { value: '30days', label: 'গত ৩০ দিন' },
  { value: 'custom', label: 'নিজস্ব' },
];

function periodLabel(period: StatementPeriod, start: string, end: string): string {
  if (period === 'month') return 'চলতি মাস';
  if (period === '30days') return 'গত ৩০ দিন';
  if (period === 'custom') return `${start} — ${end}`;
  return 'সকল লেনদেন';
}

export default function PartyStatementScreen() {
  const colors = useColors();
  const { identity, getApiToken } = useAuth();
  const { selectedBusinessName } = useBusinessScope();
  const params = useLocalSearchParams<{ partyId: string }>();
  const partyId = params.partyId;
  const [period, setPeriod] = useState<StatementPeriod>('all');
  const todayText = formatReportDateInput(new Date());
  const [startText, setStartText] = useState(todayText);
  const [endText, setEndText] = useState(todayText);
  const [search, setSearch] = useState('');
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState('');
  const [imageWarning, setImageWarning] = useState('');
  const [error, setError] = useState('');
  const partyQuery = useGetParty(partyId);
  const entriesQuery = useListLedgerEntries(partyId);
  const settingsQuery = useGetBusinessSettings({
    query: { enabled: identity?.role === 'owner', queryKey: getGetBusinessSettingsQueryKey() },
  });
  const party = partyQuery.data as PartyRecord | undefined;
  const entries = (entriesQuery.data ?? []) as LedgerRecord[];
  const startDate = parseReportDate(startText);
  const endDate = parseReportDate(endText);
  const customValid = period !== 'custom' || (!!startDate && !!endDate && startDate.getTime() <= endDate.getTime());
  const statement = useMemo(
    () => calculatePartyStatement(entries, period, new Date(), {
      startDate: period === 'custom' ? startDate : null,
      endDate: period === 'custom' ? endDate : null,
      search,
    }),
    [entries, period, startText, endText, search],
  );

  const share = async () => {
    if (!party) return;
    setError('');
    setNotice('');
    setImageWarning('');
    setSharing(true);
    try {
      const token = await getApiToken().catch(() => null);
      const { images, failedCount } = await embedPartyStatementBillImages(statement.entries, token);
      const html = buildPartyStatementHtml({
        businessName: selectedBusinessName || settingsQuery.data?.storeName || identity?.businessName || 'আমার খাতা',
        party,
        statement,
        billImages: images,
      });
      const result = await shareReportPdf(html, `${party.name} স্টেটমেন্ট`);
      setNotice(result === 'shared' ? 'PDF শেয়ার করার জন্য প্রস্তুত।' : 'প্রিন্ট মেনু খোলা হয়েছে—সেখান থেকে PDF সেভ করতে পারবেন।');
      if (failedCount > 0) setImageWarning(`${failedCount}টি বিলের ছবি পাওয়া যায়নি; বাকি স্টেটমেন্ট PDF-এ যুক্ত হয়েছে।`);
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
      onRefresh={() => {
        void Promise.all([
          partyQuery.refetch(),
          entriesQuery.refetch(),
          ...(identity?.role === 'owner' ? [settingsQuery.refetch()] : []),
        ]);
      }}
      refreshing={partyQuery.isRefetching || entriesQuery.isRefetching || settingsQuery.isRefetching}
    >
      <PageHeader
        title="স্টেটমেন্ট"
        subtitle={`${party.name} · ${party.role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'}`}
        onBack={() => router.back()}
      />

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
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
                minWidth: 72,
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

      {period === 'custom' ? (
        <View style={{ gap: 7 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>তারিখের সীমা (YYYY-MM-DD)</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput value={startText} onChangeText={setStartText} placeholder="শুরুর তারিখ" placeholderTextColor={colors.mutedForeground} accessibilityLabel="শুরুর তারিখ" style={{ flex: 1, minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 11, color: colors.foreground, backgroundColor: colors.card }} />
            <TextInput value={endText} onChangeText={setEndText} placeholder="শেষের তারিখ" placeholderTextColor={colors.mutedForeground} accessibilityLabel="শেষের তারিখ" style={{ flex: 1, minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 11, color: colors.foreground, backgroundColor: colors.card }} />
          </View>
          {!customValid ? <Text style={{ color: colors.destructive, fontSize: 12 }}>সঠিক তারিখ দিন এবং শুরুর তারিখ শেষের আগের হতে হবে।</Text> : null}
        </View>
      ) : null}
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="বিবরণ অনুসন্ধান"
        placeholderTextColor={colors.mutedForeground}
        accessibilityLabel="বিবরণ অনুসন্ধান"
        style={{ minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 11, color: colors.foreground, backgroundColor: colors.card }}
      />

      {entriesQuery.isError ? <Notice message={errorMessage(entriesQuery.error, 'লেনদেন লোড করা যায়নি।')} onRetry={() => { void entriesQuery.refetch(); }} /> : null}
      {entriesQuery.isLoading ? <LoadingState label="লেনদেন লোড হচ্ছে…" /> : null}
      {notice ? <Notice message={notice} tone="info" /> : null}
      {imageWarning ? <Notice message={imageWarning} tone="info" /> : null}
      {error ? <Notice message={error} /> : null}

      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <StatCard label="আপনি দিয়েছেন" amount={statement.gave} tone="warning" />
        <StatCard label="আপনি পেয়েছেন" amount={statement.received} tone="success" />
      </View>
      <Card>
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>ওপেনিং ব্যালেন্স · {periodLabel(period, startText, endText)}</Text>
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
        disabled={entriesQuery.isLoading || entriesQuery.isError || !customValid}
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