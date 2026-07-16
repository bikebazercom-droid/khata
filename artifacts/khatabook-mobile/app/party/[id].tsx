import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  useGetParty,
  useListLedgerEntries,
  useCreateLedgerEntry,
} from '@workspace/api-client-react';
import type { LedgerEntry } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useQueryClient } from '@tanstack/react-query';

function formatAmount(n: number): string {
  return '৳' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

interface TransactionSheetProps {
  visible: boolean;
  initialType?: 'YOU_GAVE' | 'YOU_GOT';
  partyId: string;
  partyName: string;
  onClose: () => void;
  onSuccess: () => void;
}

function TransactionSheet({ visible, initialType = 'YOU_GAVE', partyId, partyName, onClose, onSuccess }: TransactionSheetProps) {
  const colors = useColors();
  const qc = useQueryClient();
  const [type, setType] = useState<'YOU_GAVE' | 'YOU_GOT'>(initialType);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const createEntry = useCreateLedgerEntry();

  // Sync the preselected type every time the sheet opens
  useEffect(() => {
    if (visible) setType(initialType);
  }, [visible, initialType]);

  function reset() {
    setAmount('');
    setDescription('');
    setType(initialType);
  }

  async function handleSubmit() {
    const parsed = parseFloat(amount);
    if (!amount || isNaN(parsed) || parsed <= 0) {
      Alert.alert('Invalid amount', 'Please enter a valid amount greater than 0.');
      return;
    }
    try {
      await createEntry.mutateAsync({
        partyId,
        data: { type, amount: parsed, description: description.trim() || undefined },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: [`/api/parties/${partyId}/ledger-entries`] });
      qc.invalidateQueries({ queryKey: [`/api/parties/${partyId}`] });
      qc.invalidateQueries({ queryKey: ['/api/dashboard/summary'] });
      qc.invalidateQueries({ queryKey: ['/api/parties'] });
      reset();
      onSuccess();
      onClose();
    } catch {
      Alert.alert('Error', 'Could not record transaction. Please try again.');
    }
  }

  const isGave = type === 'YOU_GAVE';

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: 24,
      paddingTop: 12,
      paddingBottom: Platform.OS === 'ios' ? 44 : 24,
    },
    handle: {
      width: 36,
      height: 4,
      backgroundColor: colors.border,
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 20,
    },
    title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 4 },
    subtitle: { fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginBottom: 20 },
    typeRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
    typeBtn: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: colors.radius,
      alignItems: 'center',
      borderWidth: 2,
    },
    typeBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
    amountWrapper: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1.5,
      borderColor: isGave ? colors.willGet : colors.willGive,
      paddingHorizontal: 16,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 14,
    },
    currency: {
      fontSize: 22,
      fontFamily: 'Inter_700Bold',
      color: isGave ? colors.willGet : colors.willGive,
      marginRight: 6,
    },
    amountInput: {
      flex: 1,
      fontSize: 28,
      fontFamily: 'Inter_700Bold',
      color: isGave ? colors.willGet : colors.willGive,
      padding: 0,
    },
    descInput: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.foreground,
      marginBottom: 20,
    },
    submitBtn: {
      borderRadius: colors.radius,
      padding: 16,
      alignItems: 'center',
    },
    submitText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
    cancelBtn: { padding: 12, alignItems: 'center', marginTop: 6 },
    cancelText: { color: colors.mutedForeground, fontSize: 15, fontFamily: 'Inter_500Medium' },
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title}>Record Transaction</Text>
          <Text style={s.subtitle}>{partyName}</Text>

          {/* Type toggle */}
          <View style={s.typeRow}>
            <TouchableOpacity
              style={[s.typeBtn, {
                backgroundColor: type === 'YOU_GAVE' ? colors.willGetBg : colors.card,
                borderColor: type === 'YOU_GAVE' ? colors.willGet : colors.border,
              }]}
              onPress={() => setType('YOU_GAVE')}
              activeOpacity={0.8}
            >
              <Feather name="arrow-up-right" size={18} color={type === 'YOU_GAVE' ? colors.willGet : colors.mutedForeground} />
              <Text style={[s.typeBtnText, { color: type === 'YOU_GAVE' ? colors.willGet : colors.mutedForeground, marginTop: 4 }]}>
                You Gave
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.typeBtn, {
                backgroundColor: type === 'YOU_GOT' ? colors.willGiveBg : colors.card,
                borderColor: type === 'YOU_GOT' ? colors.willGive : colors.border,
              }]}
              onPress={() => setType('YOU_GOT')}
              activeOpacity={0.8}
            >
              <Feather name="arrow-down-left" size={18} color={type === 'YOU_GOT' ? colors.willGive : colors.mutedForeground} />
              <Text style={[s.typeBtnText, { color: type === 'YOU_GOT' ? colors.willGive : colors.mutedForeground, marginTop: 4 }]}>
                You Got
              </Text>
            </TouchableOpacity>
          </View>

          {/* Amount */}
          <View style={s.amountWrapper}>
            <Text style={s.currency}>৳</Text>
            <TextInput
              style={s.amountInput}
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={colors.border}
              keyboardType="decimal-pad"
              autoFocus
            />
          </View>

          {/* Description */}
          <TextInput
            style={s.descInput}
            value={description}
            onChangeText={setDescription}
            placeholder="Note (optional)"
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="done"
          />

          <TouchableOpacity
            style={[s.submitBtn, {
              backgroundColor: isGave ? colors.willGet : colors.willGive,
              opacity: createEntry.isPending ? 0.6 : 1,
            }]}
            onPress={handleSubmit}
            disabled={createEntry.isPending}
            activeOpacity={0.85}
          >
            <Text style={s.submitText}>
              {createEntry.isPending ? 'Saving…' : isGave ? 'Record You Gave' : 'Record You Got'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.cancelBtn} onPress={() => { reset(); onClose(); }}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface LedgerRowProps {
  entry: LedgerEntry;
  colors: ReturnType<typeof useColors>;
}

function LedgerRow({ entry, colors }: LedgerRowProps) {
  const isGave = entry.type === 'YOU_GAVE';
  const s = StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      marginTop: 5,
      marginRight: 12,
      backgroundColor: isGave ? colors.willGet : colors.willGive,
    },
    desc: { fontSize: 14, fontFamily: 'Inter_500Medium', color: colors.foreground, flex: 1 },
    meta: { fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 2 },
    type: { fontSize: 11, fontFamily: 'Inter_600SemiBold', marginTop: 3 },
    amount: { fontSize: 16, fontFamily: 'Inter_700Bold', textAlign: 'right' },
  });

  return (
    <View style={s.row}>
      <View style={s.dot} />
      <View style={{ flex: 1 }}>
        <Text style={s.desc} numberOfLines={2}>
          {entry.description || (isGave ? 'You gave' : 'You got')}
        </Text>
        <Text style={s.meta}>{formatDate(entry.createdAt)} · {formatTime(entry.createdAt)}</Text>
        <Text style={[s.type, { color: isGave ? colors.willGet : colors.willGive }]}>
          {isGave ? '▲ YOU GAVE' : '▼ YOU GOT'}
        </Text>
      </View>
      <Text style={[s.amount, { color: isGave ? colors.willGet : colors.willGive }]}>
        {isGave ? '+' : '-'}{formatAmount(entry.amount)}
      </Text>
    </View>
  );
}

export default function PartyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [showSheet, setShowSheet] = useState(false);
  const [pendingType, setPendingType] = useState<'YOU_GAVE' | 'YOU_GOT'>('YOU_GAVE');
  const [refreshing, setRefreshing] = useState(false);

  const { data: party, isLoading: partyLoading, refetch: refetchParty } = useGetParty(id!);
  const { data: entries = [], isLoading: entriesLoading, refetch: refetchEntries } = useListLedgerEntries(id!);

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([refetchParty(), refetchEntries()]);
    setRefreshing(false);
  }

  const isGet = party?.balanceType === 'YOU_WILL_GET';

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingTop: Platform.OS === 'web' ? 67 : insets.top + 8,
      paddingHorizontal: 16,
      paddingBottom: 16,
      backgroundColor: colors.primary,
    },
    backBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
    },
    backText: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontFamily: 'Inter_500Medium', marginLeft: 4 },
    partyInitials: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: 'rgba(255,255,255,0.15)',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 10,
    },
    partyInitialsText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 20 },
    partyName: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#fff' },
    partyPhone: { fontSize: 13, color: 'rgba(255,255,255,0.65)', fontFamily: 'Inter_400Regular', marginTop: 2 },
    balanceCard: {
      backgroundColor: colors.card,
      marginHorizontal: 16,
      marginTop: -1,
      borderRadius: colors.radius,
      padding: 20,
      flexDirection: 'row',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 8,
      elevation: 3,
    },
    balanceLeft: { flex: 1 },
    balanceLabel: { fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 4 },
    balanceAmount: { fontSize: 32, fontFamily: 'Inter_700Bold' },
    balanceType: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginTop: 4 },
    actionRow: {
      flexDirection: 'row',
      gap: 12,
      paddingHorizontal: 16,
      marginTop: 14,
      marginBottom: 8,
    },
    actionBtn: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: colors.radius,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
    },
    actionBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
    entriesHeader: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      marginTop: 8,
      backgroundColor: colors.background,
    },
    entriesTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground },
    emptyContainer: { alignItems: 'center', paddingVertical: 40 },
    emptyText: { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 10 },
    bottomPad: { height: Platform.OS === 'web' ? 84 : 30 },
  });

  if (partyLoading) {
    return (
      <View style={[s.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!party) {
    return (
      <View style={[s.container, { alignItems: 'center', justifyContent: 'center', padding: 32 }]}>
        <Feather name="alert-circle" size={40} color={colors.destructive} />
        <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 16, marginTop: 12 }}>
          Party not found
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: colors.primary, fontFamily: 'Inter_500Medium' }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const initials = party.name.slice(0, 2).toUpperCase();

  return (
    <View style={s.container}>
      {/* Party header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Feather name="chevron-left" size={18} color="rgba(255,255,255,0.8)" />
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>
        <View style={s.partyInitials}>
          <Text style={s.partyInitialsText}>{initials}</Text>
        </View>
        <Text style={s.partyName}>{party.name}</Text>
        {party.phone ? <Text style={s.partyPhone}>{party.phone}</Text> : null}
        <Text style={[s.partyPhone, { marginTop: 4 }]}>
          {party.role === 'CUSTOMER' ? 'Customer' : 'Supplier'}
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
      >
        {/* Balance card */}
        <View style={s.balanceCard}>
          <View style={s.balanceLeft}>
            <Text style={s.balanceLabel}>CURRENT BALANCE</Text>
            <Text style={[s.balanceAmount, { color: isGet ? colors.willGet : colors.willGive }]}>
              {formatAmount(party.currentBalance)}
            </Text>
            <Text style={[s.balanceType, { color: isGet ? colors.willGet : colors.willGive }]}>
              {isGet ? '↑ You Will Get' : '↓ You Will Give'}
            </Text>
          </View>
          {party.dueDate && (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>Due date</Text>
              <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginTop: 2 }}>
                {party.dueDate}
              </Text>
            </View>
          )}
        </View>

        {/* Action buttons */}
        <View style={s.actionRow}>
          <TouchableOpacity
            style={[s.actionBtn, { backgroundColor: colors.willGetBg }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setPendingType('YOU_GAVE');
              setShowSheet(true);
            }}
            activeOpacity={0.8}
          >
            <Feather name="arrow-up-right" size={18} color={colors.willGet} />
            <Text style={[s.actionBtnText, { color: colors.willGet }]}>You Gave</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.actionBtn, { backgroundColor: colors.willGiveBg }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setPendingType('YOU_GOT');
              setShowSheet(true);
            }}
            activeOpacity={0.8}
          >
            <Feather name="arrow-down-left" size={18} color={colors.willGive} />
            <Text style={[s.actionBtnText, { color: colors.willGive }]}>You Got</Text>
          </TouchableOpacity>
        </View>

        {/* Ledger entries */}
        <View style={s.entriesHeader}>
          <Text style={s.entriesTitle}>
            TRANSACTION HISTORY ({entries.length})
          </Text>
        </View>

        {entriesLoading ? (
          <View style={{ padding: 32, alignItems: 'center' }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : entries.length === 0 ? (
          <View style={s.emptyContainer}>
            <Feather name="file-text" size={36} color={colors.border} />
            <Text style={s.emptyText}>No transactions yet</Text>
          </View>
        ) : (
          entries.map(entry => (
            <LedgerRow key={entry.id} entry={entry} colors={colors} />
          ))
        )}

        <View style={s.bottomPad} />
      </ScrollView>

      <TransactionSheet
        visible={showSheet}
        initialType={pendingType}
        partyId={id!}
        partyName={party.name}
        onClose={() => setShowSheet(false)}
        onSuccess={() => {
          refetchParty();
          refetchEntries();
        }}
      />
    </View>
  );
}
