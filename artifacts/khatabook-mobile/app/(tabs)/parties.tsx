import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Platform,
  RefreshControl,
  Modal,
  KeyboardAvoidingView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  useListParties,
  useCreateParty,
} from '@workspace/api-client-react';
import type { Party } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/lib/i18n';

type Tab = 'CUSTOMER' | 'SUPPLIER';

function formatAmount(n: number): string {
  return '৳' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'কোনো লেনদেন নেই';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'এইমাত্র';
  if (mins < 60) return `${mins} মিনিট আগে`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ঘণ্টা আগে`;
  const days = Math.floor(hrs / 24);
  return `${days} দিন আগে`;
}

interface PartyCardProps {
  party: Party;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}

function PartyCard({ party, onPress, colors }: PartyCardProps) {
  const isGet = party.balanceType === 'YOU_WILL_GET';
  const initials = party.name.slice(0, 2).toUpperCase();
  const avatarBg = isGet ? colors.willGetBg : colors.willGiveBg;
  const avatarColor = isGet ? colors.willGet : colors.willGive;

  const s = StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      padding: 14,
      marginBottom: 8,
      marginHorizontal: 16,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
      backgroundColor: avatarBg,
    },
    name: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.foreground },
    meta: { fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 2 },
    balance: { fontSize: 16, fontFamily: 'Inter_700Bold', color: isGet ? colors.willGet : colors.willGive, marginLeft: 'auto' },
    balanceLabel: { fontSize: 10, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'right', marginTop: 2 },
  });

  return (
    <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={onPress}>
      <View style={s.avatar}>
        <Text style={{ color: avatarColor, fontFamily: 'Inter_700Bold', fontSize: 15 }}>{initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.name} numberOfLines={1}>{party.name}</Text>
        <Text style={s.meta}>
          {party.phone ? party.phone + ' · ' : ''}{formatRelativeTime(party.lastTransactionAt)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={s.balance}>{formatAmount(party.currentBalance)}</Text>
        <Text style={s.balanceLabel}>{isGet ? 'পাবেন' : 'দেবেন'}</Text>
      </View>
    </TouchableOpacity>
  );
}

interface AddPartySheetProps {
  visible: boolean;
  role: Tab;
  onClose: () => void;
  onSuccess: () => void;
}

function AddPartySheet({ visible, role, onClose, onSuccess }: AddPartySheetProps) {
  const colors = useColors();
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [balanceType, setBalanceType] = useState<'YOU_WILL_GET' | 'YOU_WILL_GIVE'>('YOU_WILL_GET');
  const createParty = useCreateParty();

  function reset() {
    setName('');
    setPhone('');
    setOpeningBalance('');
    setBalanceType('YOU_WILL_GET');
  }

  async function handleSubmit() {
    if (!name.trim()) {
      Alert.alert('নাম প্রয়োজন', 'একটি নাম লিখুন।');
      return;
    }
    try {
      await createParty.mutateAsync({
        data: {
          name: name.trim(),
          phone: phone.trim() || undefined,
          role,
          openingBalance: openingBalance ? parseFloat(openingBalance) : undefined,
          openingBalanceType: balanceType,
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reset();
      onSuccess();
      onClose();
    } catch {
      Alert.alert('Error', 'পার্টি যোগ করা যায়নি। আবার চেষ্টা করুন।');
    }
  }

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 24,
      paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    },
    handle: {
      width: 36,
      height: 4,
      backgroundColor: colors.border,
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 20,
    },
    title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 20 },
    label: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.mutedForeground, marginBottom: 6 },
    input: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      padding: 14,
      fontSize: 15,
      fontFamily: 'Inter_400Regular',
      color: colors.foreground,
      marginBottom: 16,
    },
    row: { flexDirection: 'row', gap: 10, marginBottom: 16 },
    toggle: {
      flex: 1,
      padding: 12,
      borderRadius: colors.radius,
      borderWidth: 1.5,
      alignItems: 'center',
    },
    toggleText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
    btn: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      padding: 16,
      alignItems: 'center',
      marginTop: 4,
    },
    btnText: { color: colors.primaryForeground, fontSize: 16, fontFamily: 'Inter_600SemiBold' },
    cancelBtn: { padding: 14, alignItems: 'center', marginTop: 6 },
    cancelText: { color: colors.mutedForeground, fontSize: 15, fontFamily: 'Inter_500Medium' },
  });

  const roleLabel = role === 'CUSTOMER' ? t('customer') : t('supplier');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title}>{`${roleLabel} যোগ করুন`}</Text>

          <Text style={s.label}>{t('nameLabel')}</Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder={t('enterNamePlaceholder')}
            placeholderTextColor={colors.mutedForeground}
            autoFocus
          />

          <Text style={s.label}>{t('phoneOptional')}</Text>
          <TextInput
            style={s.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="01XXXXXXXXX"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="phone-pad"
          />

          <Text style={s.label}>{t('openingBalanceOptional')}</Text>
          <TextInput
            style={s.input}
            value={openingBalance}
            onChangeText={setOpeningBalance}
            placeholder="0"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="decimal-pad"
          />

          {openingBalance ? (
            <>
              <Text style={s.label}>{t('balanceTypeLabel')}</Text>
              <View style={s.row}>
                <TouchableOpacity
                  style={[s.toggle, {
                    backgroundColor: balanceType === 'YOU_WILL_GET' ? colors.willGetBg : colors.card,
                    borderColor: balanceType === 'YOU_WILL_GET' ? colors.willGet : colors.border,
                  }]}
                  onPress={() => setBalanceType('YOU_WILL_GET')}
                >
                  <Text style={[s.toggleText, { color: balanceType === 'YOU_WILL_GET' ? colors.willGet : colors.mutedForeground }]}>
                    {t('youWillGet')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.toggle, {
                    backgroundColor: balanceType === 'YOU_WILL_GIVE' ? colors.willGiveBg : colors.card,
                    borderColor: balanceType === 'YOU_WILL_GIVE' ? colors.willGive : colors.border,
                  }]}
                  onPress={() => setBalanceType('YOU_WILL_GIVE')}
                >
                  <Text style={[s.toggleText, { color: balanceType === 'YOU_WILL_GIVE' ? colors.willGive : colors.mutedForeground }]}>
                    {t('youWillGive')}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          ) : null}

          <TouchableOpacity
            style={[s.btn, createParty.isPending && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={createParty.isPending}
            activeOpacity={0.8}
          >
            <Text style={s.btnText}>{createParty.isPending ? t('adding') : t('add')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
            <Text style={s.cancelText}>{t('cancel')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function PartiesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<Tab>('CUSTOMER');
  const [search, setSearch] = useState('');
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { data: parties = [], isLoading, refetch } = useListParties({
    role: activeTab,
    search: search || undefined,
  });

  async function handleRefresh() {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingTop: Platform.OS === 'web' ? 67 : insets.top + 12,
      paddingHorizontal: 16,
      paddingBottom: 12,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.foreground, flex: 1 },
    addBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentRow: {
      flexDirection: 'row',
      backgroundColor: colors.muted,
      borderRadius: colors.radius,
      padding: 3,
      marginBottom: 10,
    },
    segment: {
      flex: 1,
      paddingVertical: 8,
      alignItems: 'center',
      borderRadius: colors.radius - 2,
    },
    segmentText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.foreground,
      marginLeft: 8,
    },
    list: { flex: 1 },
    listContent: { paddingTop: 12 },
    emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 60 },
    emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: colors.foreground, marginTop: 12, marginBottom: 6 },
    emptyText: { fontSize: 14, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'center' },
    bottomPad: { height: Platform.OS === 'web' ? 84 : 90 },
  });

  const renderItem = useCallback(({ item }: { item: Party }) => (
    <PartyCard
      party={item}
      colors={colors}
      onPress={() => router.push(`/party/${item.id}` as any)}
    />
  ), [colors, router]);

  const keyExtractor = useCallback((item: Party) => item.id, []);

  const isCustomer = activeTab === 'CUSTOMER';
  const noResultsTitle = search
    ? t('noResults')
    : isCustomer ? 'এখনো কোনো গ্রাহক নেই' : 'এখনো কোনো সরবরাহকারী নেই';
  const noResultsBody = search
    ? t('tryDifferentSearch')
    : isCustomer ? '+ চাপুন প্রথম গ্রাহক যোগ করতে' : '+ চাপুন প্রথম সরবরাহকারী যোগ করতে';

  return (
    <View style={s.container}>
      <View style={s.header}>
        <View style={s.titleRow}>
          <Text style={s.title}>{t('partiesTitle')}</Text>
          <TouchableOpacity
            style={s.addBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowAddSheet(true);
            }}
          >
            <Feather name="plus" size={20} color={colors.primaryForeground} />
          </TouchableOpacity>
        </View>

        {/* Segment control */}
        <View style={s.segmentRow}>
          {(['CUSTOMER', 'SUPPLIER'] as Tab[]).map(tab => (
            <TouchableOpacity
              key={tab}
              style={[s.segment, activeTab === tab && { backgroundColor: colors.card }]}
              onPress={() => { setActiveTab(tab); setSearch(''); }}
              activeOpacity={0.8}
            >
              <Text style={[s.segmentText, { color: activeTab === tab ? colors.foreground : colors.mutedForeground }]}>
                {tab === 'CUSTOMER' ? t('customersTab') : t('suppliersTab')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Search */}
        <View style={s.searchRow}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={isCustomer ? t('searchCustomersPlaceholder') : t('searchSuppliersPlaceholder')}
            placeholderTextColor={colors.mutedForeground}
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      <FlatList
        data={parties}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        style={s.list}
        contentContainerStyle={[s.listContent, parties.length === 0 && { flex: 1 }]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!!parties.length}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={s.emptyContainer}>
            {isLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
                <Feather name="users" size={40} color={colors.border} />
                <Text style={s.emptyTitle}>{noResultsTitle}</Text>
                <Text style={s.emptyText}>{noResultsBody}</Text>
              </>
            )}
          </View>
        }
        ListFooterComponent={<View style={s.bottomPad} />}
      />

      <AddPartySheet
        visible={showAddSheet}
        role={activeTab}
        onClose={() => setShowAddSheet(false)}
        onSuccess={() => {
          refetch();
          qc.invalidateQueries({ queryKey: ['/api/dashboard/summary'] });
        }}
      />
    </View>
  );
}
