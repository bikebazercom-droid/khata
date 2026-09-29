import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getListGlobalLedgerEntriesQueryKey,
  useGetBusinessSettings,
  useListGlobalLedgerEntries,
} from '@workspace/api-client-react';
import {
  buildGlobalLedgerReportQuery,
  calculateGlobalLedgerReportTotals,
} from '@workspace/api-client-react/global-ledger-report';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { useColors } from '@/hooks/useColors';
import { useAuthRole } from '@/lib/auth-role';
import {
  BUSINESS_REPORT_PERIODS,
  buildBusinessReportHtml,
  formatBusinessCurrency,
  formatBusinessDate,
  toBengaliDigits,
  type BusinessReportPeriod,
} from '@/lib/business-report';
import {
  assertPdfFile,
  FolderPdfError,
  reportPdfName,
  saveReportPdfToFolder,
  shareReportPdf,
} from '@/lib/report-pdf';

type DateTarget = 'start' | 'end' | 'single';

const MONTHS_BN = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
];

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function shiftDate(date: Date, unit: 'day' | 'month' | 'year', amount: number) {
  const next = new Date(date);
  if (unit === 'day') {
    const day = next.getDate() + amount;
    if (day < 1) next.setDate(daysInMonth(next.getFullYear(), next.getMonth()));
    else if (day > daysInMonth(next.getFullYear(), next.getMonth())) next.setDate(1);
    else next.setDate(day);
    return next;
  }

  if (unit === 'month') {
    let month = next.getMonth() + amount;
    let year = next.getFullYear();
    if (month < 0) { month = 11; year -= 1; }
    if (month > 11) { month = 0; year += 1; }
    next.setFullYear(year, month, Math.min(next.getDate(), daysInMonth(year, month)));
    return next;
  }

  const year = Math.min(2100, Math.max(1900, next.getFullYear() + amount));
  next.setFullYear(year, next.getMonth(), Math.min(next.getDate(), daysInMonth(year, next.getMonth())));
  return next;
}

function DateWheel({
  date,
  onChange,
  colors,
}: {
  date: Date;
  onChange: (date: Date) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const columns: { label: string; value: string; unit: 'day' | 'month' | 'year' }[] = [
    { label: 'দিন', value: toBengaliDigits(date.getDate()), unit: 'day' },
    { label: 'মাস', value: MONTHS_BN[date.getMonth()], unit: 'month' },
    { label: 'বছর', value: toBengaliDigits(date.getFullYear()), unit: 'year' },
  ];

  return (
    <View style={styles.dateWheel}>
      {columns.map((column) => (
        <View key={column.unit} style={styles.dateWheelColumn}>
          <Text style={[styles.dateWheelLabel, { color: colors.mutedForeground }]}>{column.label}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${column.label} বাড়ান`}
            testID={`date-wheel-${column.unit}-next`}
            onPress={() => onChange(shiftDate(date, column.unit, 1))}
            hitSlop={10}
          >
            <Feather name="chevron-up" size={20} color={colors.primary} />
          </TouchableOpacity>
          <Text style={[styles.dateWheelValue, { color: colors.foreground }]} numberOfLines={1}>
            {column.value}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${column.label} কমান`}
            testID={`date-wheel-${column.unit}-previous`}
            onPress={() => onChange(shiftDate(date, column.unit, -1))}
            hitSlop={10}
          >
            <Feather name="chevron-down" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

function DatePickerModal({
  visible,
  date,
  title,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  date: Date;
  title: string;
  onConfirm: (date: Date) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const [draft, setDraft] = useState(date);

  useEffect(() => {
    if (visible) setDraft(date);
  }, [date, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="তারিখ বাছাই বন্ধ করুন"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>{title}</Text>
          <DateWheel date={draft} onChange={setDraft} colors={colors} />
          <View style={styles.modalActions}>
            <TouchableOpacity
              accessibilityRole="button"
              testID="business-report-date-cancel"
              onPress={onClose}
              style={[styles.modalButton, { borderColor: colors.border }]}
            >
              <Text style={[styles.modalButtonText, { color: colors.mutedForeground }]}>বাতিল</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              testID="business-report-date-confirm"
              onPress={() => onConfirm(draft)}
              style={[styles.modalButton, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.modalButtonText, { color: colors.primaryForeground }]}>নিশ্চিত করুন</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function formatEntryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const time = toBengaliDigits(date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }));
  return `${formatBusinessDate(date)} · ${time}`;
}

function formatDueDate(value: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : formatBusinessDate(date);
}

export default function BusinessReportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { identity } = useAuthRole();
  const isOwner = identity?.role === 'owner';
  const { data: settings } = useGetBusinessSettings({
    query: { enabled: isOwner, queryKey: ['/api/settings'] },
  });

  const [period, setPeriod] = useState<BusinessReportPeriod>('ALL');
  const [customStart, setCustomStart] = useState<Date | null>(null);
  const [customEnd, setCustomEnd] = useState<Date | null>(null);
  const [search, setSearch] = useState('');
  const [dateTarget, setDateTarget] = useState<DateTarget | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const folderInProgress = useRef(false);

  const params = useMemo(
    () => buildGlobalLedgerReportQuery(period, customStart, customEnd, search),
    [period, customStart, customEnd, search],
  );
  const range = params;
  const {
    data: entries = [],
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useListGlobalLedgerEntries(params, {
    query: {
      enabled: isOwner,
      queryKey: getListGlobalLedgerEntriesQueryKey(params),
    },
  });

  const totals = useMemo(() => calculateGlobalLedgerReportTotals(entries), [entries]);

  const periodLabel = useMemo(() => {
    if (period === 'CUSTOM_RANGE') {
      if (customStart && customEnd) {
        return `${formatBusinessDate(customStart)} — ${formatBusinessDate(customEnd)}`;
      }
      if (customStart) return `${formatBusinessDate(customStart)} — শেষের তারিখ বাছুন`;
      if (customEnd) return `শুরুর তারিখ বাছুন — ${formatBusinessDate(customEnd)}`;
    }
    if (period === 'SINGLE_DAY') return customStart ? formatBusinessDate(customStart) : 'এক দিন';
    return BUSINESS_REPORT_PERIODS.find((option) => option.key === period)?.label ?? 'সব';
  }, [period, customStart, customEnd]);

  if (identity?.role === 'staff') return <Redirect href="/(tabs)" />;

  function applyDate(date: Date) {
    if (dateTarget === 'single') {
      setCustomStart(date);
      setPeriod('SINGLE_DAY');
    } else if (dateTarget === 'start') {
      setCustomStart(date);
      if (customEnd && date > customEnd) setCustomEnd(date);
      setPeriod('CUSTOM_RANGE');
    } else if (dateTarget === 'end') {
      setCustomEnd(date);
      if (customStart && date < customStart) setCustomStart(date);
      setPeriod('CUSTOM_RANGE');
    }
    setDateTarget(null);
  }

  const storeName = settings?.storeName || 'বাংলা খাতা';
  const exportName = `${storeName}_${period}_${range.startDate ?? 'all'}_${range.endDate ?? 'all'}_${Date.now()}`;

  async function generatePdfUri() {
    const result = await Print.printToFileAsync({
      html: buildBusinessReportHtml({
        storeName,
        periodLabel,
        entries,
        totalDebit: totals.totalDebit,
        totalCredit: totals.totalCredit,
      }),
      base64: false,
    });
    const generated = new File(result.uri);
    assertPdfFile(generated);
    const destination = new File(Paths.document, reportPdfName('business', exportName));
    if (destination.exists) destination.delete();
    generated.copy(destination);
    assertPdfFile(destination);
    return destination.uri;
  }

  async function shareSavedPdf(uri: string) {
    const result = await shareReportPdf(uri, new File(uri), Sharing);
    if (result === 'unavailable') {
      Alert.alert('শেয়ার করা যাচ্ছে না', 'এই ডিভাইসে শেয়ারিং সমর্থিত নয়।');
    }
  }

  async function savePdfToFolder(uri: string) {
    if (folderInProgress.current) return;
    folderInProgress.current = true;
    setPdfBusy(true);
    try {
      const result = await saveReportPdfToFolder(
        Platform.OS,
        uri,
        new File(uri),
        'business',
        exportName,
        {
          ...LegacyFileSystem.StorageAccessFramework,
          getInfoAsync: LegacyFileSystem.getInfoAsync,
        },
      );
      if (result === 'saved') {
        Alert.alert('ফোল্ডারে সেভ হয়েছে', 'নির্বাচিত ফোল্ডারে রিপোর্টের PDF কপি লেখা হয়েছে। Files অ্যাপে দেখুন।');
      } else if (result === 'not-granted') {
        Alert.alert('ফোল্ডারে সেভ হয়নি', 'ফোল্ডার বাছা বাতিল হয়েছে বা অনুমতি দেওয়া হয়নি। অ্যাপের নিজস্ব PDF কপি অক্ষত আছে।');
      }
    } catch (error) {
      Alert.alert(
        'ফোল্ডারে সেভ হয়নি',
        error instanceof FolderPdfError
          ? error.message
          : 'PDF পড়া বা নির্বাচিত ফোল্ডারে লেখা যায়নি। আবার চেষ্টা করুন।',
      );
    } finally {
      folderInProgress.current = false;
      setPdfBusy(false);
    }
  }

  async function handlePdf() {
    if (pdfBusy || shareBusy || isLoading || isFetching || isError || folderInProgress.current) return;
    setPdfBusy(true);
    try {
      const uri = await generatePdfUri();
      Alert.alert(
        'PDF সংরক্ষিত হয়েছে',
        Platform.OS === 'android'
          ? 'রিপোর্টটি অ্যাপের নিজস্ব স্টোরেজে সেভ হয়েছে। বাইরে কপি রাখতে ফোল্ডারে সেভ করুন বা শেয়ার করুন।'
          : 'রিপোর্টটি অ্যাপের নিজস্ব স্টোরেজে সেভ হয়েছে। বাইরে সেভ করতে বা পাঠাতে শেয়ার করুন।',
        [
          ...(Platform.OS === 'android'
            ? [{ text: 'ফোল্ডারে সেভ', onPress: () => void savePdfToFolder(uri) }]
            : []),
          {
            text: 'শেয়ার করুন',
            onPress: () => {
              setShareBusy(true);
              void shareSavedPdf(uri)
                .catch(() => Alert.alert('ত্রুটি', 'শেয়ার করা যায়নি।'))
                .finally(() => setShareBusy(false));
            },
          },
          { text: 'ঠিক আছে', style: 'cancel' },
        ],
      );
    } catch {
      Alert.alert('ত্রুটি', 'PDF তৈরি করা যায়নি। আবার চেষ্টা করুন।');
    } finally {
      setPdfBusy(false);
    }
  }

  async function handleShare() {
    if (pdfBusy || shareBusy || isLoading || isFetching || isError || folderInProgress.current) return;
    setShareBusy(true);
    try {
      await shareSavedPdf(await generatePdfUri());
    } catch {
      Alert.alert('ত্রুটি', 'PDF তৈরি বা শেয়ার করা যায়নি। আবার চেষ্টা করুন।');
    } finally {
      setShareBusy(false);
    }
  }

  function renderDateSelector(target: DateTarget, label: string, date: Date | null) {
    return (
      <TouchableOpacity
        key={target}
        accessibilityRole="button"
        accessibilityLabel={`${label} বাছুন`}
        testID={`business-report-date-${target}`}
        onPress={() => setDateTarget(target)}
        activeOpacity={0.75}
        style={[styles.dateCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}
      >
        <Feather name="calendar" size={15} color={colors.primary} />
        <View style={styles.dateCardText}>
          <Text style={[styles.dateCardLabel, { color: colors.mutedForeground }]}>{label}</Text>
          <Text style={[styles.dateCardValue, { color: colors.foreground }]} numberOfLines={1}>
            {date ? formatBusinessDate(date) : 'নির্বাচন করুন'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={() => void refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <View
            style={[
              styles.header,
              {
                backgroundColor: colors.primary,
                paddingTop: Platform.OS === 'web' ? 67 : insets.top + 8,
              },
            ]}
          >
            <View style={styles.headerRow}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="ফিরে যান"
                testID="business-report-back"
                onPress={() => router.back()}
                hitSlop={10}
                style={styles.backButton}
              >
                <Feather name="arrow-left" size={22} color={colors.primaryForeground} />
              </TouchableOpacity>
              <View style={styles.headerCopy}>
                <Text style={[styles.headerTitle, { color: colors.primaryForeground }]}>ব্যবসার রিপোর্ট</Text>
                <Text style={[styles.headerSubtitle, { color: colors.primaryForeground }]}>
                  {storeName}
                </Text>
              </View>
              <Feather name="bar-chart-2" size={20} color={colors.primaryForeground} />
            </View>
          </View>

          <View style={styles.filterSection}>
            <Text style={[styles.sectionEyebrow, { color: colors.mutedForeground }]}>সময়কাল</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodRow}>
              {BUSINESS_REPORT_PERIODS.map((option) => {
                const selected = period === option.key;
                return (
                  <TouchableOpacity
                    key={option.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    testID={`business-report-period-${option.key.toLowerCase()}`}
                    onPress={() => setPeriod(option.key)}
                    activeOpacity={0.75}
                    style={[
                      styles.periodChip,
                      {
                        backgroundColor: selected ? colors.primary : colors.card,
                        borderColor: selected ? colors.primary : colors.border,
                        borderRadius: colors.radius,
                      },
                    ]}
                  >
                    <Text style={[
                      styles.periodChipText,
                      { color: selected ? colors.primaryForeground : colors.foreground },
                    ]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {period === 'CUSTOM_RANGE' && (
              <View style={styles.dateRow}>
                {renderDateSelector('start', 'আরম্ভের তারিখ', customStart)}
                <Feather name="arrow-right" size={15} color={colors.mutedForeground} />
                {renderDateSelector('end', 'শেষের তারিখ', customEnd)}
              </View>
            )}
            {period === 'SINGLE_DAY' && (
              <View style={styles.dateRow}>
                {renderDateSelector('single', 'এক দিনের রিপোর্ট', customStart ?? new Date())}
              </View>
            )}
          </View>

          <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <Feather name="search" size={17} color={colors.mutedForeground} />
            <TextInput
              accessibilityLabel="রিপোর্টের এন্ট্রি খুঁজুন"
              testID="business-report-search"
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder="পার্টি বা এন্ট্রি খুঁজুন"
              placeholderTextColor={colors.mutedForeground}
              value={search}
              onChangeText={setSearch}
              returnKeyType="search"
              autoCorrect={false}
            />
            {!!search && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="অনুসন্ধান মুছুন"
                onPress={() => setSearch('')}
                hitSlop={8}
              >
                <Feather name="x-circle" size={17} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>

          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <View style={styles.summaryTop}>
              <View>
                <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>মোট ব্যালেন্স</Text>
                <Text style={[
                  styles.summaryAmount,
                  { color: totals.netBalance >= 0 ? colors.willGet : colors.willGive },
                ]}>
                  {formatBusinessCurrency(totals.netBalance)}
                  {totals.netBalance > 0 ? ' Cr' : totals.netBalance < 0 ? ' Dr' : ''}
                </Text>
              </View>
              <View style={[styles.countPill, { backgroundColor: colors.muted }]}>
                <Feather name="list" size={14} color={colors.primary} />
                <Text style={[styles.countText, { color: colors.foreground }]}>
                  {toBengaliDigits(entries.length)} এন্ট্রি
                </Text>
              </View>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryMetrics}>
              <View style={styles.metric}>
                <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>দিয়েছেন · ডেবিট</Text>
                <Text style={[styles.metricValue, { color: colors.willGive }]}>
                  {formatBusinessCurrency(totals.totalDebit)}
                </Text>
              </View>
              <View style={[styles.metricDivider, { backgroundColor: colors.border }]} />
              <View style={styles.metric}>
                <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>পেয়েছেন · ক্রেডিট</Text>
                <Text style={[styles.metricValue, { color: colors.willGet }]}>
                  {formatBusinessCurrency(totals.totalCredit)}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.listHeader}>
            <View>
              <Text style={[styles.listTitle, { color: colors.foreground }]}>সব লেনদেন</Text>
              <Text style={[styles.listSubtitle, { color: colors.mutedForeground }]}>{periodLabel}</Text>
            </View>
            <Feather name="activity" size={17} color={colors.mutedForeground} />
          </View>

          {isLoading ? (
            <View style={styles.stateBox}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.stateText, { color: colors.mutedForeground }]}>রিপোর্ট লোড হচ্ছে…</Text>
            </View>
          ) : isError ? (
            <View style={[styles.stateBox, styles.errorState, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="alert-circle" size={28} color={colors.destructive} />
              <Text style={[styles.stateText, { color: colors.foreground }]}>রিপোর্ট আনা যায়নি</Text>
              <TouchableOpacity
                accessibilityRole="button"
                testID="business-report-retry"
                onPress={() => void refetch()}
                style={[styles.retryButton, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
              >
                <Text style={[styles.retryText, { color: colors.primaryForeground }]}>আবার চেষ্টা করুন</Text>
              </TouchableOpacity>
            </View>
          ) : entries.length === 0 ? (
            <View style={[styles.stateBox, styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="inbox" size={32} color={colors.mutedForeground} />
              <Text style={[styles.stateText, { color: colors.foreground }]}>এই সময়কালে কোনো লেনদেন নেই</Text>
              <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>অন্য সময়কাল বেছে নিন বা অনুসন্ধান মুছুন।</Text>
            </View>
          ) : (
            <View style={styles.entries}>
              {entries.map((entry) => {
                const isDebit = entry.type === 'YOU_GAVE';
                return (
                  <View
                    key={entry.id}
                    testID={`business-report-entry-${entry.id}`}
                    style={[
                      styles.entryCard,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        borderRadius: colors.radius,
                      },
                    ]}
                  >
                    <View style={styles.entryTop}>
                      <View style={styles.entryCopy}>
                        <Text style={[styles.partyName, { color: colors.foreground }]} numberOfLines={1}>
                          {entry.partyName || '—'}
                        </Text>
                        <Text style={[styles.entryDate, { color: colors.mutedForeground }]}>
                          {formatEntryDate(entry.createdAt)}
                        </Text>
                      </View>
                      <View style={[
                        styles.amountPill,
                        { backgroundColor: isDebit ? colors.willGiveBg : colors.willGetBg },
                      ]}>
                        <Text style={[
                          styles.amount,
                          { color: isDebit ? colors.willGive : colors.willGet },
                        ]}>
                          {isDebit ? '− ' : '+ '}{formatBusinessCurrency(entry.amount)}
                        </Text>
                      </View>
                    </View>
                    {!!entry.description && (
                      <Text style={[styles.entryDescription, { color: colors.mutedForeground }]}>
                        {entry.description}
                      </Text>
                    )}
                    {(!!entry.billReference || !!entry.dueDate) && (
                      <View style={styles.entryMeta}>
                        {!!entry.billReference && (
                          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                            বিল: {entry.billReference}
                          </Text>
                        )}
                        {!!entry.dueDate && (
                          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                            বাকি তারিখ: {formatDueDate(entry.dueDate)}
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
          <View style={styles.bottomSpacer} />
        </ScrollView>

        <View
          style={[
            styles.actionBar,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              paddingBottom: Platform.OS === 'ios'
                ? insets.bottom + 10
                : Platform.OS === 'web' ? 34 : 14,
            },
          ]}
        >
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ disabled: pdfBusy || shareBusy || isLoading || isFetching || isError }}
            testID="business-report-save-pdf"
            onPress={() => void handlePdf()}
            disabled={pdfBusy || shareBusy || isLoading || isFetching || isError}
            activeOpacity={0.82}
            style={[
              styles.actionButton,
              styles.secondaryAction,
              { borderColor: colors.primary, borderRadius: colors.radius },
              (pdfBusy || shareBusy) && styles.disabledAction,
            ]}
          >
            {pdfBusy
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Feather name="file-text" size={17} color={colors.primary} />}
            <Text style={[styles.secondaryActionText, { color: colors.primary }]}>
              {pdfBusy ? 'তৈরি হচ্ছে…' : 'PDF সেভ'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            testID="business-report-share-pdf"
            onPress={() => void handleShare()}
            disabled={pdfBusy || shareBusy || isLoading || isFetching || isError}
            activeOpacity={0.85}
            style={[
              styles.actionButton,
              { backgroundColor: colors.primary, borderRadius: colors.radius },
              (pdfBusy || shareBusy) && styles.disabledAction,
            ]}
          >
            {shareBusy
              ? <ActivityIndicator size="small" color={colors.primaryForeground} />
              : <Feather name="share-2" size={17} color={colors.primaryForeground} />}
            <Text style={[styles.primaryActionText, { color: colors.primaryForeground }]}>
              {shareBusy ? 'তৈরি হচ্ছে…' : 'শেয়ার করুন'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <DatePickerModal
        visible={dateTarget !== null}
        date={
          dateTarget === 'end'
            ? customEnd ?? new Date()
            : customStart ?? new Date()
        }
        title={
          dateTarget === 'end'
            ? 'শেষের তারিখ নির্বাচন করুন'
            : dateTarget === 'single'
              ? 'রিপোর্টের দিন নির্বাচন করুন'
              : 'আরম্ভের তারিখ নির্বাচন করুন'
        }
        onConfirm={applyDate}
        onClose={() => setDateTarget(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 14 },
  header: { paddingHorizontal: 16, paddingBottom: 18 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backButton: { paddingVertical: 5, paddingRight: 4 },
  headerCopy: { flex: 1 },
  headerTitle: { fontSize: 19, fontFamily: 'Inter_700Bold' },
  headerSubtitle: { marginTop: 3, fontSize: 12, fontFamily: 'Inter_400Regular', opacity: 0.74 },
  filterSection: { paddingTop: 16 },
  sectionEyebrow: { marginHorizontal: 16, marginBottom: 9, fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  periodRow: { gap: 8, paddingHorizontal: 16, paddingBottom: 4 },
  periodChip: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1 },
  periodChipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  dateCard: { flex: 1, minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1 },
  dateCardText: { flex: 1, minWidth: 0 },
  dateCardLabel: { fontSize: 9, fontFamily: 'Inter_500Medium' },
  dateCardValue: { marginTop: 2, fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  searchBox: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 9, marginHorizontal: 16, marginTop: 15, paddingHorizontal: 12, borderWidth: 1 },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 11, fontSize: 13, fontFamily: 'Inter_400Regular' },
  summaryCard: { marginHorizontal: 16, marginTop: 13, padding: 15, borderWidth: 1 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  summaryLabel: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  summaryAmount: { marginTop: 3, fontSize: 23, fontFamily: 'Inter_700Bold' },
  countPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 20 },
  countText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  summaryDivider: { height: StyleSheet.hairlineWidth, marginVertical: 13 },
  summaryMetrics: { flexDirection: 'row', alignItems: 'center' },
  metric: { flex: 1, gap: 4 },
  metricDivider: { width: StyleSheet.hairlineWidth, height: 32, marginHorizontal: 12 },
  metricLabel: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  metricValue: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginTop: 21, marginBottom: 10 },
  listTitle: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  listSubtitle: { marginTop: 2, fontSize: 10, fontFamily: 'Inter_400Regular' },
  entries: { gap: 8, paddingHorizontal: 16 },
  entryCard: { padding: 12, borderWidth: 1 },
  entryTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  entryCopy: { flex: 1, minWidth: 0 },
  partyName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  entryDate: { marginTop: 3, fontSize: 10, fontFamily: 'Inter_400Regular' },
  amountPill: { minWidth: 92, alignItems: 'flex-end', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 9 },
  amount: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  entryDescription: { marginTop: 9, fontSize: 12, lineHeight: 17, fontFamily: 'Inter_400Regular' },
  entryMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 7 },
  metaText: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  stateBox: { minHeight: 132, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 22 },
  errorState: { marginHorizontal: 16, borderWidth: 1, borderRadius: 12 },
  emptyState: { marginHorizontal: 16, borderWidth: 1, borderRadius: 12 },
  stateText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptyHint: { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  retryButton: { paddingHorizontal: 15, paddingVertical: 9, marginTop: 2 },
  retryText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  bottomSpacer: { height: 18 },
  actionBar: { flexDirection: 'row', gap: 9, paddingHorizontal: 14, paddingTop: 10, borderTopWidth: 1 },
  actionButton: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 10 },
  secondaryAction: { borderWidth: 1.5, backgroundColor: 'transparent' },
  secondaryActionText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  primaryActionText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  disabledAction: { opacity: 0.58 },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, backgroundColor: 'rgba(0,0,0,0.45)' },
  modalCard: { width: '100%', maxWidth: 420, padding: 20, borderWidth: 1, borderRadius: 18 },
  modalTitle: { textAlign: 'center', fontSize: 15, fontFamily: 'Inter_700Bold' },
  dateWheel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginTop: 16 },
  dateWheelColumn: { flex: 1, alignItems: 'center', gap: 5 },
  dateWheelLabel: { marginBottom: 2, fontSize: 10, fontFamily: 'Inter_500Medium' },
  dateWheelValue: { width: '100%', textAlign: 'center', fontSize: 14, fontFamily: 'Inter_700Bold' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  modalButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 10 },
  modalButtonText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});