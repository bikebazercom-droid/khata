import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGetDashboardSummary, useGetBusinessSettings, useListParties } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/lib/i18n';

function formatRelativeTime(dateStr: string | null, isEnglish: boolean): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return isEnglish ? 'Just now' : 'এইমাত্র';
  if (mins < 60) return isEnglish ? `${mins}m ago` : `${mins} মিনিট আগে`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return isEnglish ? `${hrs}h ago` : `${hrs} ঘণ্টা আগে`;
  const days = Math.floor(hrs / 24);
  return isEnglish ? `${days}d ago` : `${days} দিন আগে`;
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isEnglish, t, formatCurrency } = useLanguage();

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useGetDashboardSummary();
  const { data: settings, isLoading: settingsLoading } = useGetBusinessSettings();
  const { data: customers, refetch: refetchCustomers } = useListParties({ role: 'CUSTOMER' });
  const { data: suppliers, refetch: refetchSuppliers } = useListParties({ role: 'SUPPLIER' });

  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([refetchSummary(), refetchCustomers(), refetchSuppliers()]);
    setRefreshing(false);
  }

  const recentParties = [...(customers ?? []), ...(suppliers ?? [])]
    .filter(p => p.lastTransactionAt)
    .sort((a, b) => new Date(b.lastTransactionAt!).getTime() - new Date(a.lastTransactionAt!).getTime())
    .slice(0, 6);

  const net = (summary?.youWillGet ?? 0) - (summary?.youWillGive ?? 0);
  const netPositive = net >= 0;

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    header: {
      paddingTop: Platform.OS === 'web' ? 67 : insets.top + 12,
      paddingHorizontal: 20,
      paddingBottom: 16,
      backgroundColor: colors.primary,
    },
    storeName: {
      fontSize: 22,
      fontFamily: 'Inter_700Bold',
      color: '#ffffff',
      marginBottom: 2,
    },
    subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.65)', fontFamily: 'Inter_400Regular' },
    netCard: {
      marginHorizontal: 20,
      marginTop: -1,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      padding: 20,
      marginBottom: 4,
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 8,
      elevation: 2,
    },
    netLabel: { fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 4 },
    netAmount: {
      fontSize: 36,
      fontFamily: 'Inter_700Bold',
      color: netPositive ? colors.willGet : colors.willGive,
    },
    netSubtitle: { fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 2 },
    balanceRow: {
      flexDirection: 'row',
      gap: 12,
      paddingHorizontal: 20,
      marginTop: 12,
    },
    balanceCard: {
      flex: 1,
      borderRadius: colors.radius,
      padding: 16,
    },
    balanceLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', marginBottom: 6, opacity: 0.75 },
    balanceAmount: { fontSize: 22, fontFamily: 'Inter_700Bold' },
    balanceCount: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2, opacity: 0.6 },
    section: { paddingHorizontal: 20, marginTop: 24 },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.foreground },
    seeAll: { fontSize: 13, color: colors.primary, fontFamily: 'Inter_500Medium' },
    partyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      padding: 14,
      marginBottom: 8,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    partyName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.foreground },
    partyMeta: { fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 1 },
    partyBalance: { fontSize: 15, fontFamily: 'Inter_700Bold', marginLeft: 'auto' },
    emptyText: { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center', paddingVertical: 24 },
    bottomPad: { height: Platform.OS === 'web' ? 84 : 90 },
    loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  });

  if (summaryLoading && !summary) {
    return (
      <View style={[s.container, s.loadingContainer]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const customerCount = summary?.customerCount ?? 0;
  const supplierCount = summary?.supplierCount ?? 0;
  const subtitleText = isEnglish
    ? `${customerCount} customers · ${supplierCount} suppliers`
    : `${customerCount} গ্রাহক · ${supplierCount} সরবরাহকারী`;

  return (
    <View style={s.container}>
      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
      >
        {/* Header */}
        <View style={s.header}>
          <Text style={s.storeName}>
            {settingsLoading ? t('loadingStore') : (settings?.storeName || t('myShop'))}
          </Text>
          <Text style={s.subtitle}>{subtitleText}</Text>
        </View>

        {/* Net balance card */}
        <View style={s.netCard}>
          <Text style={s.netLabel}>{t('netBalance').toUpperCase()}</Text>
          <Text style={s.netAmount}>{formatCurrency(Math.abs(net))}</Text>
          <Text style={s.netSubtitle}>
            {netPositive ? t('overallReceive') : t('overallPay')}
          </Text>
        </View>

        {/* YOU WILL GET / YOU WILL GIVE */}
        <View style={s.balanceRow}>
          <View style={[s.balanceCard, { backgroundColor: colors.willGetBg }]}>
            <Text style={[s.balanceLabel, { color: colors.willGet }]}>
              {t('youWillGet').toUpperCase()}
            </Text>
            <Text style={[s.balanceAmount, { color: colors.willGet }]}>
              {formatCurrency(summary?.youWillGet ?? 0)}
            </Text>
            <Text style={[s.balanceCount, { color: colors.willGet }]}>
              {isEnglish
                ? `${customerCount} customers`
                : `${customerCount} ${t('customerLabel')}`}
            </Text>
          </View>
          <View style={[s.balanceCard, { backgroundColor: colors.willGiveBg }]}>
            <Text style={[s.balanceLabel, { color: colors.willGive }]}>
              {t('youWillGive').toUpperCase()}
            </Text>
            <Text style={[s.balanceAmount, { color: colors.willGive }]}>
              {formatCurrency(summary?.youWillGive ?? 0)}
            </Text>
            <Text style={[s.balanceCount, { color: colors.willGive }]}>
              {isEnglish
                ? `${supplierCount} suppliers`
                : `${supplierCount} ${t('supplierLabel')}`}
            </Text>
          </View>
        </View>

        {/* Recent parties */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>{t('recent')}</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/parties')}>
              <Text style={s.seeAll}>{t('seeAll')}</Text>
            </TouchableOpacity>
          </View>

          {recentParties.length === 0 ? (
            <Text style={s.emptyText}>{t('noRecent')}</Text>
          ) : (
            recentParties.map(party => {
              const isGet = party.balanceType === 'YOU_WILL_GET';
              const initials = party.name.slice(0, 2).toUpperCase();
              const avatarBg = party.role === 'CUSTOMER' ? colors.willGetBg : colors.willGiveBg;
              const avatarColor = party.role === 'CUSTOMER' ? colors.willGet : colors.willGive;
              const roleStr = party.role === 'CUSTOMER' ? t('customerLabel') : t('supplierLabel');
              const relTime = formatRelativeTime(party.lastTransactionAt, isEnglish);
              return (
                <TouchableOpacity
                  key={party.id}
                  style={s.partyRow}
                  activeOpacity={0.7}
                  onPress={() => router.push(`/party/${party.id}` as any)}
                >
                  <View style={[s.avatar, { backgroundColor: avatarBg }]}>
                    <Text style={{ color: avatarColor, fontFamily: 'Inter_700Bold', fontSize: 14 }}>{initials}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.partyName} numberOfLines={1}>{party.name}</Text>
                    <Text style={s.partyMeta}>
                      {roleStr}{relTime ? ` · ${relTime}` : ''}
                    </Text>
                  </View>
                  <Text style={[s.partyBalance, { color: isGet ? colors.willGet : colors.willGive }]}>
                    {formatCurrency(party.currentBalance)}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <View style={s.bottomPad} />
      </ScrollView>
    </View>
  );
}
