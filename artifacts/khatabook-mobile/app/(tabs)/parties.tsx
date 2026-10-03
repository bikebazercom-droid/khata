import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { DueFilter, PartyRole, useListParties } from '@workspace/api-client-react';
import { EmptyState, LoadingState, Notice } from '@/components/Kit';
import { useAuth } from '@/contexts/AuthContext';
import { errorMessage, formatMoney, toBengaliDigits, type PartyRecord } from '@/lib/domain';
import { useColors } from '@/hooks/useColors';

type PartyFilter = 'all' | 'will_get' | 'will_give' | 'permanent' | 'today' | 'upcoming' | 'no_date';
type PartySort = 'recent' | 'highest' | 'name' | 'oldest' | 'lowest';

const FILTER_OPTIONS: { id: PartyFilter; label: string }[] = [
  { id: 'all', label: 'সব' },
  { id: 'will_get', label: 'আপনি পাবেন' },
  { id: 'will_give', label: 'আপনি দেবেন' },
  { id: 'permanent', label: 'স্থায়ী' },
  { id: 'today', label: 'আজকের বাকি' },
  { id: 'upcoming', label: 'আসন্ন' },
  { id: 'no_date', label: 'কোনো নির্দিষ্ট তারিখ নেই' },
];

const SORT_OPTIONS: { id: PartySort; label: string }[] = [
  { id: 'recent', label: 'সর্বাধিক সাম্প্রতিক' },
  { id: 'highest', label: 'সর্বোচ্চ পরিমাণ' },
  { id: 'name', label: 'নামের দ্বারা (A–Z)' },
  { id: 'oldest', label: 'সব থেকে পুরোনো' },
  { id: 'lowest', label: 'সর্বনিম্ন রাশি' },
];

function formatRelativeActivity(value?: string | null): string | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;

  const elapsedMinutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60_000);
  if (elapsedMinutes < 1) return 'এইমাত্র';
  if (elapsedMinutes < 60) return `${toBengaliDigits(String(elapsedMinutes))} মিনিট আগে`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${toBengaliDigits(String(elapsedHours))} ঘণ্টা আগে`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 30) return `${toBengaliDigits(String(elapsedDays))} দিন আগে`;

  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedMonths < 12) return `${toBengaliDigits(String(elapsedMonths))} মাস আগে`;

  return `${toBengaliDigits(String(Math.floor(elapsedMonths / 12)))} বছর আগে`;
}

function PartyListRow({ party, onPress }: { party: PartyRecord; onPress: () => void }) {
  const colors = useColors();
  const isReceivable = party.balanceType === 'YOU_WILL_GET';
  const amountColor = party.currentBalance === 0
    ? colors.mutedForeground
    : isReceivable ? colors.success : colors.destructive;
  const metadata = formatRelativeActivity(party.lastTransactionAt)
    ?? party.phone
    ?? (party.role === PartyRole.CUSTOMER ? 'গ্রাহক' : 'সরবরাহকারী');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${party.name}, ${formatMoney(party.currentBalance)}`}
      testID={`party-${party.id}`}
      style={({ pressed }) => [styles.partyRow, { backgroundColor: colors.card, opacity: pressed ? 0.76 : 1 }]}
    >
      <View style={[styles.avatar, { backgroundColor: `${amountColor}20` }]}>
        <Text style={[styles.avatarText, { color: amountColor }]}>
          {party.name.trim().slice(0, 1).toUpperCase() || 'খ'}
        </Text>
      </View>
      <View style={styles.partyInfo}>
        <Text style={[styles.partyName, { color: colors.foreground }]} numberOfLines={1}>{party.name}</Text>
        <Text style={[styles.partyMeta, { color: colors.mutedForeground }]} numberOfLines={1}>{metadata}</Text>
      </View>
      <View style={styles.partyBalance}>
        <Text style={[styles.partyAmount, { color: amountColor }]} numberOfLines={1}>
          {formatMoney(party.currentBalance)}
        </Text>
        <Text style={[styles.partyMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {party.currentBalance === 0 ? 'হিসাব সমান' : isReceivable ? 'আপনি পাবেন' : 'আপনি দেবেন'}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

function FilterSortSheet({
  visible,
  pendingFilter,
  pendingSort,
  onFilterChange,
  onSortChange,
  onClose,
  onApply,
}: {
  visible: boolean;
  pendingFilter: PartyFilter;
  pendingSort: PartySort;
  onFilterChange: (filter: PartyFilter) => void;
  onSortChange: (sort: PartySort) => void;
  onClose: () => void;
  onApply: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="ফিল্টার বন্ধ করুন"
          style={styles.modalScrim}
        />
        <View style={[styles.filterSheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetTitleRow}>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>ফিল্টার ও বাছাই</Text>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="বন্ধ করুন"
                style={[styles.sheetCloseButton, { backgroundColor: colors.background }]}
              >
                <Feather name="x" size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.sheetSectionLabel, { color: colors.mutedForeground }]}>মাধ্যমে ফিল্টার</Text>
            <View style={styles.sheetFilterGrid}>
              {FILTER_OPTIONS.filter((filter) => filter.id !== 'no_date').map((filter) => {
                const selected = pendingFilter === filter.id;
                return (
                  <Pressable
                    key={filter.id}
                    onPress={() => onFilterChange(filter.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    testID={`party-filter-${filter.id}`}
                    style={[
                      styles.sheetFilterButton,
                      {
                        backgroundColor: selected ? colors.primary : colors.card,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.sheetFilterText, { color: selected ? colors.primaryForeground : colors.foreground }]}>
                      {filter.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => onFilterChange('no_date')}
              accessibilityRole="button"
              accessibilityState={{ selected: pendingFilter === 'no_date' }}
              testID="party-filter-no_date"
              style={[
                styles.sheetNoDateButton,
                {
                  backgroundColor: pendingFilter === 'no_date' ? colors.primary : colors.card,
                  borderColor: pendingFilter === 'no_date' ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={[styles.sheetFilterText, { color: pendingFilter === 'no_date' ? colors.primaryForeground : colors.foreground }]}>
                কোনো নির্দিষ্ট তারিখ নেই
              </Text>
            </Pressable>

            <View style={[styles.sheetSortSection, { borderTopColor: colors.border }]}>
              <Text style={[styles.sheetSectionLabel, { color: colors.mutedForeground }]}>মাধ্যমে বাছাই</Text>
              {SORT_OPTIONS.map((sort) => {
                const selected = pendingSort === sort.id;
                return (
                  <Pressable
                    key={sort.id}
                    onPress={() => onSortChange(sort.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    testID={`party-sort-${sort.id}`}
                    style={[styles.sheetSortRow, { borderBottomColor: colors.border }]}
                  >
                    <Text style={[styles.sheetSortText, { color: selected ? colors.primary : colors.foreground, fontWeight: selected ? '800' : '500' }]}>
                      {sort.label}
                    </Text>
                    <View style={[styles.radioOuter, { borderColor: selected ? colors.primary : colors.border }]}>
                      {selected ? <View style={[styles.radioInner, { backgroundColor: colors.primary }]} /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.sheetActions}>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={[styles.sheetSecondaryButton, { borderColor: colors.border }]}
            >
              <Text style={[styles.sheetSecondaryButtonText, { color: colors.foreground }]}>বাতিল</Text>
            </Pressable>
            <Pressable
              onPress={onApply}
              accessibilityRole="button"
              testID="party-filter-apply"
              style={[styles.sheetPrimaryButton, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.sheetPrimaryButtonText, { color: colors.primaryForeground }]}>ফলাফল দেখুন</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function PartiesScreen() {
  const colors = useColors();
  const { identity } = useAuth();
  const [role, setRole] = useState<PartyRole>(PartyRole.CUSTOMER);
  const [search, setSearch] = useState('');
  const [pendingFilter, setPendingFilter] = useState<PartyFilter>('all');
  const [pendingSort, setPendingSort] = useState<PartySort>('recent');
  const [appliedFilter, setAppliedFilter] = useState<PartyFilter>('all');
  const [appliedSort, setAppliedSort] = useState<PartySort>('recent');
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  const dueFilter = appliedFilter === 'today'
    ? DueFilter.DUE_TODAY
    : appliedFilter === 'upcoming'
      ? DueFilter.UPCOMING
      : appliedFilter === 'permanent' || appliedFilter === 'no_date'
        ? DueFilter.NO_DUE_DATE
        : DueFilter.ALL;
  const partiesQuery = useListParties({ role, search, dueFilter });
  const summaryQuery = useListParties({ role });
  const rawParties = (partiesQuery.data ?? []) as PartyRecord[];
  const summaryParties = (summaryQuery.data ?? []) as PartyRecord[];

  const visibleParties = useMemo(() => {
    let result = rawParties;
    if (appliedFilter === 'will_get') result = result.filter((party) => party.balanceType === 'YOU_WILL_GET');
    if (appliedFilter === 'will_give') result = result.filter((party) => party.balanceType === 'YOU_WILL_GIVE');

    switch (appliedSort) {
      case 'highest':
        return [...result].sort((a, b) => b.currentBalance - a.currentBalance);
      case 'lowest':
        return [...result].sort((a, b) => a.currentBalance - b.currentBalance);
      case 'name':
        return [...result].sort((a, b) => a.name.localeCompare(b.name, 'bn'));
      case 'oldest':
        return [...result].sort((a, b) => {
          const aTime = a.lastTransactionAt ? new Date(a.lastTransactionAt).getTime() : 0;
          const bTime = b.lastTransactionAt ? new Date(b.lastTransactionAt).getTime() : 0;
          return aTime - bTime;
        });
      default:
        return result;
    }
  }, [rawParties, appliedFilter, appliedSort]);

  const totals = useMemo(
    () => summaryParties.reduce((sum, party) => {
      if (party.balanceType === 'YOU_WILL_GET') sum.youWillGet += party.currentBalance;
      else sum.youWillGive += party.currentBalance;
      return sum;
    }, { youWillGet: 0, youWillGive: 0 }),
    [summaryParties],
  );

  const roleLabel = role === PartyRole.CUSTOMER ? 'গ্রাহক' : 'সরবরাহকারী';
  const isFiltered = appliedFilter !== 'all' || appliedSort !== 'recent';
  const filterSummary = FILTER_OPTIONS.find((filter) => filter.id === appliedFilter)?.label ?? 'সব';
  const sortSummary = SORT_OPTIONS.find((sort) => sort.id === appliedSort)?.label ?? '';
  const hasQueryError = partiesQuery.isError || summaryQuery.isError;
  const queryError = partiesQuery.error ?? summaryQuery.error;
  const openReports = () => router.push('/reports');
  const openFilterSheet = () => {
    setPendingFilter(appliedFilter);
    setPendingSort(appliedSort);
    setFilterSheetVisible(true);
  };
  const refresh = () => {
    void Promise.all([partiesQuery.refetch(), summaryQuery.refetch()]);
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.safeArea, { backgroundColor: colors.primary }]}>
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0} style={styles.keyboardAvoiding}>
        <View style={[styles.screen, { backgroundColor: colors.card }]}>
          <View style={[styles.header, { backgroundColor: colors.primary }]}>
            <View style={styles.brandRow}>
              <Image source={require('../../assets/images/brand-icon.png')} style={styles.logo} />
              <View style={styles.brandNameWrap}>
                <Text style={[styles.brandName, { color: colors.primaryForeground }]} numberOfLines={1}>
                  {identity?.businessName || 'আমার খাতা'}
                </Text>
              </View>
              <Pressable
                onPress={() => router.push('/(tabs)/settings')}
                accessibilityRole="button"
                accessibilityLabel="সেটিংস"
                testID="parties-settings"
                style={({ pressed }) => [styles.headerActionButton, { backgroundColor: `${colors.primaryForeground}20`, opacity: pressed ? 0.75 : 1 }]}
              >
                <Feather name="settings" size={15} color={colors.primaryForeground} />
                <Text style={[styles.headerActionText, { color: colors.primaryForeground }]}>সেটিংস</Text>
              </Pressable>
              <Pressable
                onPress={openReports}
                accessibilityRole="button"
                accessibilityLabel="রিপোর্ট খুলুন"
                testID="parties-folder"
                style={({ pressed }) => [styles.folderButton, { backgroundColor: `${colors.primaryForeground}20`, opacity: pressed ? 0.75 : 1 }]}
              >
                <Feather name="folder" size={18} color={colors.primaryForeground} />
              </Pressable>
            </View>

            <View style={[styles.roleTabs, { borderBottomColor: `${colors.primaryForeground}25` }]}>
              {([PartyRole.CUSTOMER, PartyRole.SUPPLIER] as const).map((item) => {
                const selected = role === item;
                return (
                  <Pressable
                    key={item}
                    onPress={() => setRole(item)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    testID={`parties-role-${item.toLowerCase()}`}
                    style={[
                      styles.roleTab,
                      { borderBottomColor: selected ? colors.primaryForeground : 'transparent' },
                    ]}
                  >
                    <Text style={[styles.roleTabText, { color: colors.primaryForeground, opacity: selected ? 1 : 0.64 }]}>
                      {item === PartyRole.CUSTOMER ? 'গ্রাহক' : 'সরবরাহকারী'}
                    </Text>
                  </Pressable>
                );
              })}
              <View style={styles.roleTabSpacer} />
            </View>
          </View>

          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.summaryCell}>
              <Text style={[styles.summaryAmount, { color: colors.destructive }]} numberOfLines={1}>
                {formatMoney(totals.youWillGive)}
              </Text>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>আপনি দেবেন</Text>
            </View>
            <View style={[styles.summaryCell, styles.summaryDivider, { borderColor: colors.border }]}>
              <Text style={[styles.summaryAmount, { color: colors.success }]} numberOfLines={1}>
                {formatMoney(totals.youWillGet)}
              </Text>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>আপনি পাবেন</Text>
            </View>
            <Pressable
              onPress={openReports}
              accessibilityRole="button"
              accessibilityLabel="রিপোর্ট দেখুন"
              testID="parties-view-report"
              style={styles.summaryReport}
            >
              <Text style={[styles.summaryReportText, { color: colors.primary }]}>রিপোর্ট দেখুন</Text>
              <Feather name="chevron-right" size={16} color={colors.primary} />
            </Pressable>
          </View>

          <View style={styles.utilityRow}>
            <View style={[styles.searchBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Feather name="search" size={17} color={colors.mutedForeground} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={`${roleLabel} খুঁজুন...`}
                placeholderTextColor={colors.mutedForeground}
                accessibilityLabel={`${roleLabel} খুঁজুন`}
                testID="party-search"
                returnKeyType="search"
                style={[styles.searchInput, { color: colors.foreground }]}
              />
              {search ? (
                <Pressable onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel="খোঁজা মুছুন">
                  <Feather name="x" size={17} color={colors.mutedForeground} />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              onPress={openFilterSheet}
              accessibilityRole="button"
              accessibilityLabel="ফিল্টার ও বাছাই"
              testID="party-filter-toggle"
              style={({ pressed }) => [
                styles.utilityButton,
                {
                  backgroundColor: isFiltered ? colors.primary : colors.background,
                  borderColor: isFiltered ? colors.primary : colors.border,
                  opacity: pressed ? 0.72 : 1,
                },
              ]}
            >
              <Feather name="sliders" size={16} color={isFiltered ? colors.primaryForeground : colors.mutedForeground} />
              <Text style={[styles.utilityLabel, { color: isFiltered ? colors.primaryForeground : colors.mutedForeground }]}>ফিল্টার</Text>
              {isFiltered ? <View style={[styles.filterDot, { backgroundColor: colors.accent }]} /> : null}
            </Pressable>
            <Pressable
              onPress={openReports}
              accessibilityRole="button"
              accessibilityLabel="পিডিএফ রিপোর্ট"
              testID="party-pdf-report"
              style={({ pressed }) => [styles.utilityButton, { backgroundColor: colors.background, borderColor: colors.border, opacity: pressed ? 0.72 : 1 }]}
            >
              <Feather name="file-text" size={16} color={colors.mutedForeground} />
              <Text style={[styles.utilityLabel, { color: colors.mutedForeground }]}>পিডিএফ</Text>
            </Pressable>
          </View>

          {isFiltered ? (
            <View style={styles.activeFilterRow}>
              <Text style={[styles.activeFilterText, { backgroundColor: colors.secondary, color: colors.secondaryForeground }]}>
                {appliedFilter === 'all' ? sortSummary : filterSummary}
                {appliedFilter !== 'all' && appliedSort !== 'recent' ? ` · ${sortSummary}` : ''}
              </Text>
              <Pressable
                onPress={() => {
                  setAppliedFilter('all');
                  setAppliedSort('recent');
                }}
                accessibilityRole="button"
                testID="party-filter-reset"
              >
                <Text style={[styles.resetText, { color: colors.mutedForeground }]}>রিসেট</Text>
              </Pressable>
            </View>
          ) : null}

          <FlatList
            data={visibleParties}
            keyExtractor={(party) => party.id}
            renderItem={({ item }) => (
              <PartyListRow
                party={item}
                onPress={() => router.push({ pathname: '/party/[partyId]', params: { partyId: item.id } })}
              />
            )}
            ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: colors.border }]} />}
            ListHeaderComponent={hasQueryError ? (
              <View style={styles.noticeWrap}>
                <Notice
                  message={errorMessage(queryError, 'হিসাব লোড করা যায়নি।')}
                  onRetry={refresh}
                />
              </View>
            ) : null}
            ListEmptyComponent={
              partiesQuery.isLoading
                ? <LoadingState label="হিসাব লোড হচ্ছে…" />
                : partiesQuery.isError
                  ? null
                  : <View style={styles.emptyWrap}>
                      <EmptyState
                        title={search || isFiltered ? 'কোনো ফল পাওয়া যায়নি' : `এখনও কোনো ${roleLabel} নেই`}
                        description={search || isFiltered ? 'ফিল্টার বদলে আবার চেষ্টা করুন।' : 'নিচের বোতাম থেকে প্রথম হিসাবটি যোগ করুন।'}
                        icon="users"
                      />
                    </View>
            }
            refreshControl={
              <RefreshControl
                refreshing={partiesQuery.isRefetching || summaryQuery.isRefetching}
                onRefresh={refresh}
                tintColor={colors.primary}
              />
            }
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            scrollEnabled={visibleParties.length > 0 || partiesQuery.isLoading}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: Platform.OS === 'web' ? 150 : 130 },
              visibleParties.length === 0 ? styles.emptyListContent : null,
            ]}
            style={styles.list}
            testID="party-list"
          />

          <Pressable
            onPress={() => router.push({ pathname: '/party/new', params: { role } })}
            accessibilityRole="button"
            accessibilityLabel={`${roleLabel} যোগ করুন`}
            testID="parties-add"
            style={({ pressed }) => [
              styles.addButton,
              { backgroundColor: colors.accent, opacity: pressed ? 0.82 : 1, bottom: Platform.OS === 'web' ? 96 : 92 },
            ]}
          >
            <Feather name="plus" size={19} color={colors.accentForeground} />
            <Text style={[styles.addButtonText, { color: colors.accentForeground }]}>{roleLabel} যোগ করুন</Text>
          </Pressable>

          <FilterSortSheet
            visible={filterSheetVisible}
            pendingFilter={pendingFilter}
            pendingSort={pendingSort}
            onFilterChange={setPendingFilter}
            onSortChange={setPendingSort}
            onClose={() => setFilterSheetVisible(false)}
            onApply={() => {
              setAppliedFilter(pendingFilter);
              setAppliedSort(pendingSort);
              setFilterSheetVisible(false);
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  keyboardAvoiding: { flex: 1 },
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 0 },
  brandRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 9 },
  logo: { width: 32, height: 32, borderRadius: 9 },
  brandNameWrap: { flex: 1, minWidth: 0 },
  brandName: { fontSize: 17, fontWeight: '800' },
  headerActionButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10, borderRadius: 13 },
  headerActionText: { fontSize: 12, fontWeight: '700' },
  folderButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  roleTabs: { height: 48, flexDirection: 'row', alignItems: 'stretch', gap: 24, borderBottomWidth: StyleSheet.hairlineWidth },
  roleTab: { minWidth: 56, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2 },
  roleTabText: { fontSize: 15, fontWeight: '800' },
  roleTabSpacer: { flex: 1 },
  summaryCard: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: -25,
    marginHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 19,
    overflow: 'hidden',
    zIndex: 2,
    elevation: 5,
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
  },
  summaryCell: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, paddingVertical: 10 },
  summaryDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth },
  summaryAmount: { fontSize: 14, fontWeight: '800' },
  summaryLabel: { marginTop: 3, fontSize: 10, fontWeight: '600' },
  summaryReport: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 4 },
  summaryReportText: { fontSize: 11, fontWeight: '800', textAlign: 'center' },
  utilityRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 14, marginBottom: 8 },
  searchBox: { flex: 1, minWidth: 0, height: 48, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, borderWidth: 1, borderRadius: 13 },
  searchInput: { flex: 1, minWidth: 0, height: '100%', paddingVertical: 0, fontSize: 16 },
  utilityButton: { width: 54, height: 48, alignItems: 'center', justifyContent: 'center', gap: 3, borderWidth: 1, borderRadius: 13, position: 'relative' },
  utilityLabel: { fontSize: 9, lineHeight: 11, fontWeight: '800' },
  filterDot: { position: 'absolute', top: 5, right: 6, width: 6, height: 6, borderRadius: 3 },
  activeFilterRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 4 },
  activeFilterText: { overflow: 'hidden', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, fontSize: 10, fontWeight: '700' },
  resetText: { fontSize: 10, fontWeight: '800' },
  list: { flex: 1 },
  listContent: { flexGrow: 1 },
  emptyListContent: { justifyContent: 'center' },
  noticeWrap: { paddingHorizontal: 16, paddingTop: 8 },
  emptyWrap: { paddingHorizontal: 16 },
  partyRow: { minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '800' },
  partyInfo: { flex: 1, minWidth: 0, gap: 4 },
  partyName: { fontSize: 15, fontWeight: '800' },
  partyMeta: { fontSize: 11, fontWeight: '500' },
  partyBalance: { maxWidth: '38%', alignItems: 'flex-end', gap: 3 },
  partyAmount: { maxWidth: '100%', fontSize: 14, fontWeight: '800' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 80 },
  addButton: {
    position: 'absolute',
    right: 18,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
    borderRadius: 28,
    elevation: 5,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  addButtonText: { fontSize: 14, fontWeight: '800' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalScrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.48)' },
  filterSheet: { maxHeight: '88%', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  sheetHeader: { paddingHorizontal: 20, paddingTop: 13, paddingBottom: 4 },
  sheetHandle: { width: 40, height: 4, alignSelf: 'center', marginBottom: 12, borderRadius: 2, backgroundColor: '#CBD5E1' },
  sheetTitleRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 17, fontWeight: '800' },
  sheetCloseButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 15 },
  sheetScroll: { flexShrink: 1 },
  sheetScrollContent: { paddingHorizontal: 20, paddingBottom: 8 },
  sheetSectionLabel: { marginTop: 10, marginBottom: 10, fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  sheetFilterGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  sheetFilterButton: { width: '31%', minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1, borderRadius: 12 },
  sheetFilterText: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  sheetNoDateButton: { minHeight: 42, alignItems: 'flex-start', justifyContent: 'center', marginTop: 8, paddingHorizontal: 13, borderWidth: 1, borderRadius: 12 },
  sheetSortSection: { marginTop: 18, paddingTop: 5, borderTopWidth: StyleSheet.hairlineWidth },
  sheetSortRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth },
  sheetSortText: { fontSize: 13 },
  radioOuter: { width: 19, height: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 10 },
  radioInner: { width: 9, height: 9, borderRadius: 5 },
  sheetActions: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 10 },
  sheetSecondaryButton: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 13 },
  sheetSecondaryButtonText: { fontSize: 14, fontWeight: '700' },
  sheetPrimaryButton: { flex: 1.4, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  sheetPrimaryButtonText: { fontSize: 14, fontWeight: '800' },
});