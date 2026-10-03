import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useListParties } from '@workspace/api-client-react';
import { EmptyState, LoadingState, Notice } from '@/components/Kit';
import { useAuth } from '@/contexts/AuthContext';
import { errorMessage, formatMoney, type PartyRecord } from '@/lib/domain';
import { useColors } from '@/hooks/useColors';

type PartyRole = 'CUSTOMER' | 'SUPPLIER';
type BalanceFilter = 'all' | 'will-get' | 'will-give' | 'settled';

const BALANCE_FILTERS: { id: BalanceFilter; label: string }[] = [
  { id: 'all', label: 'সব' },
  { id: 'will-get', label: 'আপনি পাবেন' },
  { id: 'will-give', label: 'আপনি দেবেন' },
  { id: 'settled', label: 'হিসাব সমান' },
];

function PartyListRow({ party, onPress }: { party: PartyRecord; onPress: () => void }) {
  const colors = useColors();
  const isReceivable = party.balanceType === 'YOU_WILL_GET';
  const amountColor = party.currentBalance === 0
    ? colors.mutedForeground
    : isReceivable ? colors.success : colors.destructive;

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
        <Text style={[styles.partyMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {party.phone || (party.role === 'CUSTOMER' ? 'গ্রাহক' : 'সরবরাহকারী')}
        </Text>
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

export default function PartiesScreen() {
  const colors = useColors();
  const { identity } = useAuth();
  const [role, setRole] = useState<PartyRole>('CUSTOMER');
  const [search, setSearch] = useState('');
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>('all');
  const [filtersVisible, setFiltersVisible] = useState(false);
  const partiesQuery = useListParties({});
  const allParties = (partiesQuery.data ?? []) as PartyRecord[];

  const roleParties = useMemo(
    () => allParties.filter((party) => party.role === role),
    [allParties, role],
  );

  const totals = useMemo(
    () => roleParties.reduce((sum, party) => {
      if (party.balanceType === 'YOU_WILL_GET') sum.youWillGet += party.currentBalance;
      else sum.youWillGive += party.currentBalance;
      return sum;
    }, { youWillGet: 0, youWillGive: 0 }),
    [roleParties],
  );

  const visibleParties = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return roleParties.filter((party) => {
      const matchesSearch = !query ||
        party.name.toLocaleLowerCase().includes(query) ||
        (party.phone ?? '').toLocaleLowerCase().includes(query);
      const matchesBalance =
        balanceFilter === 'all' ||
        (balanceFilter === 'will-get' && party.currentBalance > 0 && party.balanceType === 'YOU_WILL_GET') ||
        (balanceFilter === 'will-give' && party.currentBalance > 0 && party.balanceType === 'YOU_WILL_GIVE') ||
        (balanceFilter === 'settled' && party.currentBalance === 0);
      return matchesSearch && matchesBalance;
    });
  }, [roleParties, search, balanceFilter]);

  const roleLabel = role === 'CUSTOMER' ? 'গ্রাহক' : 'সরবরাহকারী';
  const openReports = () => router.push('/reports');

  return (
    <SafeAreaView edges={['top']} style={[styles.safeArea, { backgroundColor: colors.primary }]}>
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
              accessibilityLabel="অ্যাক্সেস"
              testID="parties-access"
              style={({ pressed }) => [styles.accessButton, { backgroundColor: `${colors.primaryForeground}20`, opacity: pressed ? 0.75 : 1 }]}
            >
              <Feather name="user-plus" size={15} color={colors.primaryForeground} />
              <Text style={[styles.accessText, { color: colors.primaryForeground }]}>অ্যাক্সেস</Text>
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
            {(['CUSTOMER', 'SUPPLIER'] as const).map((item) => {
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
                    {item === 'CUSTOMER' ? 'গ্রাহক' : 'সরবরাহকারী'}
                  </Text>
                </Pressable>
              );
            })}
            <View style={styles.roleTabSpacer} />
          </View>
        </View>

        <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.summaryCell}>
            <Text style={[styles.summaryAmount, { color: colors.success }]} numberOfLines={1}>
              {formatMoney(totals.youWillGive)}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>আপনি দেবেন</Text>
          </View>
          <View style={[styles.summaryCell, styles.summaryDivider, { borderColor: colors.border }]}>
            <Text style={[styles.summaryAmount, { color: colors.destructive }]} numberOfLines={1}>
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
            onPress={() => setFiltersVisible((visible) => !visible)}
            accessibilityRole="button"
            accessibilityLabel="ফিল্টার"
            accessibilityState={{ expanded: filtersVisible }}
            testID="party-filter-toggle"
            style={({ pressed }) => [
              styles.utilityButton,
              { backgroundColor: balanceFilter === 'all' ? colors.background : colors.secondary, borderColor: colors.border, opacity: pressed ? 0.72 : 1 },
            ]}
          >
            <Feather name="sliders" size={16} color={colors.secondaryForeground} />
            <Text style={[styles.utilityLabel, { color: colors.secondaryForeground }]}>ফিল্টার</Text>
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

        {filtersVisible ? (
          <View style={styles.filterOptions}>
            {BALANCE_FILTERS.map((filter) => {
              const selected = balanceFilter === filter.id;
              return (
                <Pressable
                  key={filter.id}
                  onPress={() => setBalanceFilter(filter.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  testID={`party-filter-${filter.id}`}
                  style={[
                    styles.filterChip,
                    { backgroundColor: selected ? colors.primary : colors.background, borderColor: selected ? colors.primary : colors.border },
                  ]}
                >
                  <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontSize: 12, fontWeight: '700' }}>
                    {filter.label}
                  </Text>
                </Pressable>
              );
            })}
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
          ListHeaderComponent={partiesQuery.isError ? (
            <View style={styles.noticeWrap}>
              <Notice
                message={errorMessage(partiesQuery.error, 'হিসাব লোড করা যায়নি।')}
                onRetry={() => { void partiesQuery.refetch(); }}
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
                      title={search || balanceFilter !== 'all' ? 'কোনো ফল পাওয়া যায়নি' : `এখনও কোনো ${roleLabel} নেই`}
                      description={search || balanceFilter !== 'all' ? 'ফিল্টার বদলে আবার চেষ্টা করুন।' : 'নিচের বোতাম থেকে প্রথম হিসাবটি যোগ করুন।'}
                      icon="users"
                    />
                  </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={partiesQuery.isRefetching}
              onRefresh={() => { void partiesQuery.refetch(); }}
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
          onPress={() => router.push('/party/new')}
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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 0 },
  brandRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 9 },
  logo: { width: 32, height: 32, borderRadius: 9 },
  brandNameWrap: { flex: 1, minWidth: 0 },
  brandName: { fontSize: 17, fontWeight: '800' },
  accessButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10, borderRadius: 13 },
  accessText: { fontSize: 12, fontWeight: '700' },
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
  searchInput: { flex: 1, minWidth: 0, height: '100%', paddingVertical: 0, fontSize: 14 },
  utilityButton: { width: 54, height: 48, alignItems: 'center', justifyContent: 'center', gap: 3, borderWidth: 1, borderRadius: 13 },
  utilityLabel: { fontSize: 9, lineHeight: 11, fontWeight: '800' },
  filterOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingHorizontal: 16, paddingBottom: 8 },
  filterChip: { minHeight: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11, borderWidth: 1, borderRadius: 18 },
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
});