import React, { useMemo, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  buildGlobalLedgerReportQuery,
  calculateGlobalLedgerReportTotals,
  type GlobalLedgerReportPeriod,
} from '@workspace/api-client-react/global-ledger-report';
import { getListGlobalLedgerEntriesQueryKey, useListGlobalLedgerEntries, useListParties } from '@workspace/api-client-react';
import { AppButton, Card, EmptyState, LoadingState, Notice, Page, PageHeader, StatCard } from '@/components/Kit';
import { useAuth } from '@/contexts/AuthContext';
import { errorMessage, formatMoney, type GlobalLedgerRecord, type PartyRecord } from '@/lib/domain';
import { useColors } from '@/hooks/useColors';
import {
  buildGlobalLedgerReportCsv,
  filterGlobalLedgerEntriesByRole,
  formatReportDateInput,
  GLOBAL_LEDGER_PRESETS,
  parseReportDate,
  type GlobalLedgerRole,
} from '@/lib/globalLedgerReport';
import { buildGlobalLedgerReportHtml, shareReportPdf } from '@/lib/reportPdf';

const ROLE_FILTERS: { value: GlobalLedgerRole; label: string }[] = [
  { value: 'ALL', label: 'সব' },
  { value: 'CUSTOMER', label: 'কাস্টমার' },
  { value: 'SUPPLIER', label: 'সাপ্লায়ার' },
];

function periodTitle(period: GlobalLedgerReportPeriod, start: string, end: string): string {
  if (period === 'CUSTOM_RANGE') return `${start || 'শুরু'} — ${end || 'শেষ'}`;
  return GLOBAL_LEDGER_PRESETS.find((preset) => preset.value === period)?.label ?? 'সব সময়';
}

export default function TransactionReportScreen() {
  const colors = useColors();
  const { identity } = useAuth();
  const todayText = formatReportDateInput(new Date());
  const [period, setPeriod] = useState<GlobalLedgerReportPeriod>('ALL');
  const [role, setRole] = useState<GlobalLedgerRole>('ALL');
  const [search, setSearch] = useState('');
  const [startText, setStartText] = useState(todayText);
  const [endText, setEndText] = useState(todayText);
  const [busy, setBusy] = useState<'pdf' | 'csv' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const startDate = parseReportDate(startText);
  const endDate = parseReportDate(endText);
  const customValid = period !== 'CUSTOM_RANGE'
    || (!!startDate && !!endDate && startDate.getTime() <= endDate.getTime());
  const singleDayValid = period !== 'SINGLE_DAY' || !!startDate;
  const valid = customValid && singleDayValid;
  const query = useMemo(() => buildGlobalLedgerReportQuery(
    period,
    period === 'SINGLE_DAY' ? startDate : period === 'CUSTOM_RANGE' ? startDate : null,
    period === 'CUSTOM_RANGE' ? endDate : null,
    search,
  ), [period, startText, endText, search]);
  const entriesQuery = useListGlobalLedgerEntries(query, {
    query: { queryKey: getListGlobalLedgerEntriesQueryKey(query), enabled: valid },
  });
  const partiesQuery = useListParties();
  const allEntries = (entriesQuery.data ?? []) as GlobalLedgerRecord[];
  const parties = (partiesQuery.data ?? []) as PartyRecord[];
  const entries = useMemo(
    () => filterGlobalLedgerEntriesByRole(allEntries, parties, role),
    [allEntries, parties, role],
  );
  const totals = calculateGlobalLedgerReportTotals(entries);

  const sharePdf = async () => {
    setError('');
    setNotice('');
    setBusy('pdf');
    try {
      const html = buildGlobalLedgerReportHtml({
        businessName: identity?.businessName || 'বাংলাখাতা',
        entries,
        periodLabel: periodTitle(period, startText, endText),
      });
      const result = await shareReportPdf(html, 'বাংলাখাতা লেনদেন রিপোর্ট');
      setNotice(result === 'shared' ? 'PDF শেয়ার করার জন্য প্রস্তুত।' : 'প্রিন্ট মেনু খোলা হয়েছে—সেখান থেকে PDF সেভ করতে পারবেন।');
    } catch (shareError) {
      setError(errorMessage(shareError, 'PDF তৈরি বা শেয়ার করা যায়নি। আবার চেষ্টা করুন।'));
    } finally {
      setBusy(null);
    }
  };

  const shareCsv = async () => {
    setError('');
    setNotice('');
    setBusy('csv');
    try {
      const csv = buildGlobalLedgerReportCsv(entries);
      const fileName = `banglakhata-transactions-${formatReportDateInput(new Date())}.csv`;
      if (Platform.OS === 'web') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        URL.revokeObjectURL(url);
        setNotice('CSV ফাইল ডাউনলোড হয়েছে।');
      } else {
        const file = new File(Paths.cache, fileName);
        file.write(csv);
        if (!(await Sharing.isAvailableAsync())) throw new Error('এই ডিভাইসে ফাইল শেয়ার করা যাচ্ছে না।');
        await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'লেনদেন CSV শেয়ার করুন' });
        setNotice('CSV শেয়ার করার জন্য প্রস্তুত।');
      }
    } catch (shareError) {
      setError(errorMessage(shareError, 'CSV তৈরি বা শেয়ার করা যায়নি। আবার চেষ্টা করুন।'));
    } finally {
      setBusy(null);
    }
  };

  const chipStyle = (selected: boolean) => ({
    minHeight: 40 as const,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: selected ? colors.primary : colors.border,
    backgroundColor: selected ? colors.primary : colors.card,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  });
  const inputStyle = {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: colors.foreground,
    backgroundColor: colors.card,
    fontSize: 15,
  };

  return (
    <Page
      onRefresh={() => { void Promise.all([entriesQuery.refetch(), partiesQuery.refetch()]); }}
      refreshing={entriesQuery.isRefetching || partiesQuery.isRefetching}
    >
      <PageHeader title="লেনদেন রিপোর্ট" subtitle="লেনদেন খুঁজুন, ফিল্টার করুন ও এক্সপোর্ট করুন" onBack={() => router.back()} />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {GLOBAL_LEDGER_PRESETS.map((preset) => {
          const selected = period === preset.value;
          return (
            <Pressable key={preset.value} onPress={() => setPeriod(preset.value)} accessibilityRole="button" accessibilityState={{ selected }} testID={`transaction-period-${preset.value.toLowerCase()}`} style={chipStyle(selected)}>
              <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontSize: 12, fontWeight: '700' }}>{preset.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {period === 'SINGLE_DAY' || period === 'CUSTOM_RANGE' ? (
        <Card>
          <Text style={{ color: colors.foreground, fontWeight: '700', marginBottom: 8 }}>{period === 'SINGLE_DAY' ? 'তারিখ (YYYY-MM-DD)' : 'নিজস্ব তারিখের সীমা (YYYY-MM-DD)'}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              value={startText}
              onChangeText={setStartText}
              placeholder="শুরুর তারিখ"
              placeholderTextColor={colors.mutedForeground}
              style={[inputStyle, { flex: 1 }]}
              accessibilityLabel="শুরুর তারিখ"
            />
            {period === 'CUSTOM_RANGE' ? (
              <TextInput
                value={endText}
                onChangeText={setEndText}
                placeholder="শেষের তারিখ"
                placeholderTextColor={colors.mutedForeground}
                style={[inputStyle, { flex: 1 }]}
                accessibilityLabel="শেষের তারিখ"
              />
            ) : null}
          </View>
          {!valid ? <Text style={{ color: colors.destructive, fontSize: 12, marginTop: 6 }}>সঠিক তারিখ দিন এবং শুরু তারিখ শেষের আগের হতে হবে।</Text> : null}
        </Card>
      ) : null}

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="পার্টি বা বিবরণ খুঁজুন"
        placeholderTextColor={colors.mutedForeground}
        style={inputStyle}
        accessibilityLabel="লেনদেন অনুসন্ধান"
        returnKeyType="search"
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {ROLE_FILTERS.map((filter) => {
          const selected = role === filter.value;
          return (
            <Pressable key={filter.value} onPress={() => setRole(filter.value)} accessibilityRole="button" accessibilityState={{ selected }} testID={`transaction-role-${filter.value.toLowerCase()}`} style={[chipStyle(selected), { flex: 1 }]}>
              <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontSize: 13, fontWeight: '700' }}>{filter.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {entriesQuery.isLoading || partiesQuery.isLoading ? <LoadingState label="লেনদেন রিপোর্ট লোড হচ্ছে…" /> : null}
      {entriesQuery.isError ? <Notice message={errorMessage(entriesQuery.error, 'লেনদেন রিপোর্ট লোড করা যায়নি.')} onRetry={() => { void entriesQuery.refetch(); }} /> : null}
      {partiesQuery.isError ? <Notice message={errorMessage(partiesQuery.error, 'পার্টির ধরন লোড করা যায়নি।')} onRetry={() => { void partiesQuery.refetch(); }} /> : null}
      {notice ? <Notice message={notice} tone="info" /> : null}
      {error ? <Notice message={error} /> : null}

      {valid && !entriesQuery.isError ? (
        <>
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <StatCard label="মোট ডেবিট" amount={totals.totalDebit} tone="warning" />
            <StatCard label="মোট ক্রেডিট" amount={totals.totalCredit} tone="success" />
          </View>
          <Card>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>লেনদেন · নিট ব্যালেন্স</Text>
            <Text style={{ color: colors.foreground, fontSize: 21, fontWeight: '800' }}>{totals.entryCount} · {formatMoney(totals.netBalance)}</Text>
          </Card>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <AppButton title="PDF শেয়ার" icon="share-2" onPress={() => { void sharePdf(); }} loading={busy === 'pdf'} disabled={busy !== null || entriesQuery.isLoading} testID="transaction-report-pdf" />
            <AppButton title="CSV শেয়ার / ডাউনলোড" icon="download" onPress={() => { void shareCsv(); }} loading={busy === 'csv'} disabled={busy !== null || entriesQuery.isLoading} testID="transaction-report-csv" />
          </View>
          {entries.length ? entries.map((entry) => (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/entry/[entryId]', params: { entryId: entry.id, partyId: entry.partyId } })}
            >
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.foreground, fontWeight: '800' }}>{entry.partyName}</Text>
                    <Text style={{ color: colors.mutedForeground, marginTop: 3 }}>{entry.description || 'বিবরণ নেই'}</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }}>{new Date(entry.createdAt).toLocaleDateString()}</Text>
                  </View>
                  <Text style={{ color: entry.type === 'YOU_GAVE' ? colors.destructive : colors.success, fontWeight: '800' }}>{entry.type === 'YOU_GAVE' ? '−' : '+'}{formatMoney(entry.amount)}</Text>
                </View>
              </Card>
            </Pressable>
          )) : (
            <EmptyState title="কোনো লেনদেন নেই" description="তারিখ, ধরন বা অনুসন্ধানের শব্দ পরিবর্তন করুন।" icon="file-text" />
          )}
        </>
      ) : null}
    </Page>
  );
}