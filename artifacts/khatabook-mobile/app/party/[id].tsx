import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  Image,
  Linking,
  Share,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@clerk/expo';
import {
  useGetParty,
  useListLedgerEntries,
  useListParties,
  useListAdjustmentTargets,
  getListAdjustmentTargetsQueryKey,
  useSendPaymentReminder,
  usePatchLedgerEntry,
  useDeleteLedgerEntry,
  useDeleteParty,
  getGetPartyQueryKey,
  getListLedgerEntriesQueryKey,
  getListPartiesQueryKey,
  getGetDashboardSummaryQueryKey,
} from '@workspace/api-client-react';
import type { LedgerEntry, Party } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthRole } from '@/lib/auth-role';
import { canAdjustParty, adjustmentDestinations, validAdjustmentSelection } from '@/lib/adjustment-access';
import { queueEntry, listEntries, subscribeOutbox, type QueuedEntry } from '@/lib/entry-outbox';
import { v4 as uuidv4 } from 'uuid';
import NetInfo from '@react-native-community/netinfo';
import { customFetch } from '@/lib/api-transport';

// ─── Module-level helpers ────────────────────────────────────────────────────

const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : '';

const BN_DIGITS: Record<string, string> = {
  '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪',
  '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯',
};

/** Currency formatter — always Bengali digits with ৳ prefix. */
function fmtCur(n: number): string {
  const abs = Math.abs(n);
  const hasDecimal = !Number.isInteger(abs);
  const grouped = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: hasDecimal ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(abs);
  return `৳${grouped.split('').map(c => BN_DIGITS[c] ?? c).join('')}`;
}

/** Plain number formatter for live-typing display — always Bengali digits. */
function fmtNum(s: string): string {
  return s.split('').map(c => BN_DIGITS[c] ?? c).join('');
}

function billImageSrc(billImage: string | null | undefined): string | null {
  if (!billImage) return null;
  if (billImage.startsWith('data:')) return billImage;
  if (billImage.startsWith('/objects/')) return `${API_BASE}/api/storage${billImage}`;
  return null;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatTime(d: string): string {
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}
function isToday(dateStr: string): boolean {
  const d = new Date(dateStr); const n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

function todayInput(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function validDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// ─── TransactionSheet ────────────────────────────────────────────────────────

interface TransactionSheetProps {
  visible: boolean;
  initialType?: 'YOU_GAVE' | 'YOU_GOT';
  partyId: string;
  partyName: string;
  staffMode?: boolean;
  adjustmentPartyIds: string[];
  actorId: string;
  businessId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function TransactionSheet({ visible, initialType = 'YOU_GAVE', partyId, partyName, staffMode = false, adjustmentPartyIds, actorId, businessId, onClose, onSuccess }: TransactionSheetProps) {
  const colors = useColors();

  const [type, setType] = useState<'YOU_GAVE' | 'YOU_GOT'>(initialType);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [entryDate, setEntryDate] = useState(todayInput());
  const [dueDate, setDueDate] = useState('');
  const [billReference, setBillReference] = useState('');
  const [billImageUri, setBillImageUri] = useState<string | null>(null);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  // Transfer / adjustment state
  const [isTransferMode, setIsTransferMode] = useState(false);
  const [transferPartyId, setTransferPartyId] = useState<string | null>(null);
  const [transferSearch, setTransferSearch] = useState('');
  const canAdjustSource = canAdjustParty(staffMode, adjustmentPartyIds, partyId);
  const { data: allTargets = [], isLoading: transferLoading, isError: transferError, error: transferErrorDetail, refetch: refetchTransfers } = useListAdjustmentTargets(
    { query: { enabled: isTransferMode && canAdjustSource, queryKey: getListAdjustmentTargetsQueryKey() } },
  );
  const transferPartyOptions = adjustmentDestinations(allTargets, partyId, staffMode, adjustmentPartyIds)
    .filter((p) => p.name.toLocaleLowerCase().includes(transferSearch.trim().toLocaleLowerCase()));

  useEffect(() => {
    setTransferPartyId((selected) => validAdjustmentSelection(selected, partyId, staffMode, adjustmentPartyIds));
    // Keep transfer mode: revocation must not silently turn a draft adjustment
    // into an ordinary ledger entry.
  }, [partyId, staffMode, adjustmentPartyIds]);

  useEffect(() => { if (visible) setType(initialType); }, [visible, initialType]);

  function reset() {
    setAmount(''); setDescription(''); setType(initialType);
    setEntryDate(todayInput()); setDueDate(''); setBillReference('');
    setBillImageUri(null);
    setIsTransferMode(false); setTransferPartyId(null); setTransferSearch('');
  }

  async function pickImage() {
    Alert.alert(
      'বিল সংযুক্ত করুন',
      'উৎস বেছে নিন',
      [
        {
          text: 'ক্যামেরা',
          onPress: async () => {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (perm.status !== 'granted') {
              Alert.alert('অনুমতি প্রয়োজন', 'ছবি তুলতে ক্যামেরার অনুমতি দিন।');
              return;
            }
            const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
            if (!r.canceled && r.assets[0]) {
              const uri = r.assets[0].uri;
              setBillImageUri(uri);
            }
          },
        },
        {
          text: 'ফটো লাইব্রেরি',
          onPress: async () => {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (perm.status !== 'granted') {
              Alert.alert('অনুমতি প্রয়োজন', 'ফটো লাইব্রেরির অনুমতি দিন।');
              return;
            }
            const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
            if (!r.canceled && r.assets[0]) {
              const uri = r.assets[0].uri;
              setBillImageUri(uri);
            }
          },
        },
        { text: 'বাতিল', style: 'cancel' },
      ],
    );
  }

  async function handleSubmit() {
    if (savingRef.current) return;
    if (!actorId || !businessId) {
      Alert.alert('পরিচয় যাচাই করা যায়নি', 'আবার লগইন করুন। খসড়া জমা দেওয়া হয়নি।');
      return;
    }
    const parsed = parseFloat(amount);
    if (!amount || isNaN(parsed) || parsed <= 0) {
      Alert.alert('ভুল পরিমাণ', 'শূন্যের বেশি একটি বৈধ পরিমাণ লিখুন।');
      return;
    }
    if (isTransferMode && !transferPartyId) {
      Alert.alert('কাস্টমার বেছে নিন', 'অ্যাডজাস্টমেন্টের জন্য একটি কাস্টমার নির্বাচন করুন।');
      return;
    }
    if (isTransferMode && (!canAdjustSource || (staffMode && !adjustmentPartyIds.includes(transferPartyId!)))) {
      Alert.alert('অনুমতি নেই', 'অ্যাডজাস্টমেন্টের উৎস ও গন্তব্য—দুই খাতাতেই অনুমতি প্রয়োজন।');
      return;
    }
    if (!validDateInput(entryDate) || (dueDate && !validDateInput(dueDate))) {
      Alert.alert('তারিখ সঠিক নয়', 'তারিখ YYYY-MM-DD ফরম্যাটে লিখুন।');
      return;
    }
    try {
      savingRef.current = true;
      setSaving(true);
      await queueEntry({
        id: uuidv4(), actorId, businessId, partyId,
        data: {
          type,
          amount: parsed,
          description: description.trim() || undefined,
          entryDate,
          dueDate: dueDate || undefined,
          billReference: billReference.trim() || undefined,
          ...(isTransferMode ? {
            isTransfer: isTransferMode || undefined,
            transferPartyId: isTransferMode ? transferPartyId : undefined,
          } : {}),
        },
        status: 'pending',
      }, staffMode ? undefined : billImageUri ?? undefined);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('এন্ট্রি অপেক্ষমাণ', 'সার্ভার নিশ্চিত করলে মূল হিসাবে যুক্ত হবে। অফলাইনে খসড়াটি এই ডিভাইসে সংরক্ষিত আছে।');
      reset(); onSuccess(); onClose();
    } catch (error) {
      Alert.alert('খসড়া সংরক্ষণ করা যায়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন। ফর্মটি খোলা আছে।');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const isGave = type === 'YOU_GAVE';

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 12 },
    handle: { width: 36, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
    title: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.foreground, marginBottom: 16 },
    typeRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
    typeBtn: { flex: 1, paddingVertical: 14, borderRadius: colors.radius, alignItems: 'center', borderWidth: 2 },
    typeBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', marginTop: 4 },
    amountWrapper: { backgroundColor: colors.card, borderRadius: colors.radius, borderWidth: 1.5, borderColor: isGave ? colors.willGet : colors.willGive, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
    currency: { fontSize: 22, fontFamily: 'Inter_700Bold', color: isGave ? colors.willGet : colors.willGive, marginRight: 6 },
    amountInput: { flex: 1, fontSize: 28, fontFamily: 'Inter_700Bold', color: isGave ? colors.willGet : colors.willGive, padding: 0 },
    descInput: { backgroundColor: colors.card, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border, padding: 14, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.foreground, marginBottom: 12 },
    attachRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
    attachBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: colors.radius, borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed' },
    attachBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.mutedForeground },
    thumbWrapper: { position: 'relative' },
    thumb: { width: 52, height: 52, borderRadius: 8, backgroundColor: colors.card },
    thumbRemove: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.destructive, alignItems: 'center', justifyContent: 'center' },
    submitBtn: { borderRadius: colors.radius, paddingVertical: 16, paddingHorizontal: 12, alignItems: 'center', minHeight: 54 },
    submitText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
    cancelBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
    cancelText: { color: colors.mutedForeground, fontSize: 15, fontFamily: 'Inter_500Medium' },
  });

  const liveAmt = fmtNum(amount || '0');
  const titleText = isGave
    ? `আপনি দিয়েছেন ৳${liveAmt} ${partyName}-কে`
    : `আপনি পেয়েছেন ৳${liveAmt} ${partyName}-এর থেকে`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}
      >
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title} numberOfLines={2}>{titleText}</Text>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: Platform.OS === 'ios' ? 44 : 24 }}
          >
          {/* Type toggle */}
          <View style={s.typeRow}>
            <TouchableOpacity
              style={[s.typeBtn, { backgroundColor: type === 'YOU_GAVE' ? colors.willGetBg : colors.card, borderColor: type === 'YOU_GAVE' ? colors.willGet : colors.border }]}
              onPress={() => setType('YOU_GAVE')} activeOpacity={0.8}
            >
              <Feather name="arrow-up-right" size={18} color={type === 'YOU_GAVE' ? colors.willGet : colors.mutedForeground} />
              <Text style={[s.typeBtnText, { color: type === 'YOU_GAVE' ? colors.willGet : colors.mutedForeground }]}>
                আপনি দিয়েছেন
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.typeBtn, { backgroundColor: type === 'YOU_GOT' ? colors.willGiveBg : colors.card, borderColor: type === 'YOU_GOT' ? colors.willGive : colors.border }]}
              onPress={() => setType('YOU_GOT')} activeOpacity={0.8}
            >
              <Feather name="arrow-down-left" size={18} color={type === 'YOU_GOT' ? colors.willGive : colors.mutedForeground} />
              <Text style={[s.typeBtnText, { color: type === 'YOU_GOT' ? colors.willGive : colors.mutedForeground }]}>
                আপনি পেয়েছেন
              </Text>
            </TouchableOpacity>
          </View>

          {/* Amount input */}
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
            placeholder="বিস্তারিত লিখুন (পণ্য, বিল নং, পরিমাণ ইত্যাদি)"
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="done"
          />

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 5 }}>এন্ট্রির তারিখ</Text>
              <TextInput style={s.descInput} value={entryDate} onChangeText={setEntryDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 5 }}>বকেয়ার তারিখ</Text>
              <TextInput style={s.descInput} value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} />
            </View>
          </View>
          <TextInput
            style={s.descInput}
            value={billReference}
            onChangeText={setBillReference}
            placeholder="বিল / রেফারেন্স নম্বর (ঐচ্ছিক)"
            placeholderTextColor={colors.mutedForeground}
          />

          {/* Bill photo: restricted for staff accounts */}
          {!staffMode ? <View style={s.attachRow}>
            {billImageUri ? (
              <View style={s.thumbWrapper}>
                <Image source={{ uri: billImageUri }} style={s.thumb} resizeMode="cover" />
                <TouchableOpacity
                  style={s.thumbRemove}
                  onPress={() => setBillImageUri(null)}
                  hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                >
                  <Feather name="x" size={11} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : null}
            <TouchableOpacity style={s.attachBtn} onPress={pickImage} activeOpacity={0.7}>
              <Feather name="camera" size={16} color={colors.mutedForeground} />
              <Text style={s.attachBtnText}>
                {billImageUri ? 'ছবি পরিবর্তন করুন' : 'বিল ছবি সংযুক্ত করুন'}
              </Text>
            </TouchableOpacity>
          </View> : null}

          {/* ── Transfer / adjustment section ─────────────────────────── */}
          {canAdjustSource ? <View style={{
            borderRadius: colors.radius,
            marginBottom: 16,
            overflow: 'hidden',
            borderWidth: 2,
            borderColor: isTransferMode ? '#3b82f6' : '#dbeafe',
            backgroundColor: isTransferMode ? '#eff6ff' : '#f8faff',
          }}>
            {/* Header row — always visible */}
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => { setIsTransferMode(v => !v); setTransferPartyId(null); setTransferSearch(''); }}
              style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 14, paddingVertical: 12 }}
            >
              {/* Blue icon badge */}
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: isTransferMode ? '#3b82f6' : '#bfdbfe', alignItems: 'center', justifyContent: 'center', marginRight: 12, flexShrink: 0 }}>
                <Feather name="repeat" size={18} color={isTransferMode ? '#fff' : '#3b82f6'} />
              </View>
              {/* Label + subtitle */}
              <View style={{ flex: 1, marginRight: 10 }}>
                <Text style={{ fontSize: 14, fontFamily: 'Inter_700Bold', color: isTransferMode ? '#1d4ed8' : '#1e3a5f' }}>
                  অ্যাডজাস্টমেন্ট
                </Text>
                <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: isTransferMode ? '#3b82f6' : '#64748b', marginTop: 1 }} numberOfLines={1}>
                  {isTransferMode && transferPartyId
                    ? `✓ কাস্টমার নির্বাচিত হয়েছে`
                    : 'অন্য কাস্টমারের সাথে অ্যাডজাস্ট করুন'}
                </Text>
              </View>
              {/* Toggle pill */}
              <View style={{ width: 48, height: 28, borderRadius: 14, backgroundColor: isTransferMode ? '#3b82f6' : '#cbd5e1', justifyContent: 'center', paddingHorizontal: 3, flexShrink: 0 }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignSelf: isTransferMode ? 'flex-end' : 'flex-start', elevation: 3, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 3 }} />
              </View>
            </TouchableOpacity>

            {/* Expanded: search + party list */}
            {isTransferMode && (
              <View style={{ borderTopWidth: 1.5, borderTopColor: '#bfdbfe', paddingHorizontal: 12, paddingBottom: 12, backgroundColor: '#fff' }}>
                <TextInput
                  value={transferSearch}
                  onChangeText={setTransferSearch}
                  placeholder="কাস্টমারের নাম লিখুন…"
                  placeholderTextColor="#94a3b8"
                  style={{
                    backgroundColor: '#f1f5f9',
                    borderRadius: 10,
                    borderWidth: 1.5,
                    borderColor: '#bfdbfe',
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    fontSize: 14,
                    fontFamily: 'Inter_400Regular',
                    color: '#0f172a',
                    marginTop: 12,
                    marginBottom: 8,
                  }}
                />
                <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {transferLoading ? <ActivityIndicator color={colors.primary} style={{ padding: 16 }} /> :
                   transferError ? (
                    <TouchableOpacity onPress={() => void refetchTransfers()} style={{ paddingVertical: 14 }}>
                      <Text style={{ fontSize: 12, color: colors.destructive }}>{transferErrorDetail instanceof Error ? transferErrorDetail.message : 'খাতার তালিকা লোড করা যায়নি।'} আবার চেষ্টা করুন</Text>
                    </TouchableOpacity>
                   ) : transferPartyOptions.length === 0 ? (
                    <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                      <Feather name="users" size={20} color="#94a3b8" />
                      <Text style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'Inter_400Regular', marginTop: 6 }}>কোনো কাস্টমার পাওয়া যায়নি</Text>
                    </View>
                  ) : transferPartyOptions.map((p) => {
                    const selected = transferPartyId === p.id;
                    return (
                      <TouchableOpacity
                        key={p.id}
                        activeOpacity={0.75}
                        onPress={() => setTransferPartyId(p.id)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          minHeight: 50,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          borderRadius: 10,
                          marginBottom: 4,
                          backgroundColor: selected ? '#3b82f6' : '#f8fafc',
                          borderWidth: 1.5,
                          borderColor: selected ? '#2563eb' : '#e2e8f0',
                        }}
                      >
                        {/* Avatar initial */}
                        <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: selected ? 'rgba(255,255,255,0.25)' : '#dbeafe', alignItems: 'center', justifyContent: 'center', marginRight: 10, flexShrink: 0 }}>
                          <Text style={{ fontSize: 13, fontFamily: 'Inter_700Bold', color: selected ? '#fff' : '#3b82f6' }}>
                            {p.name.slice(0, 1).toUpperCase()}
                          </Text>
                        </View>
                        <Text style={{ flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold', color: selected ? '#fff' : '#0f172a', marginRight: 8 }} numberOfLines={1} ellipsizeMode="tail">{p.name}</Text>
                        {selected && <Feather name="check-circle" size={16} color="#fff" style={{ marginLeft: 6, flexShrink: 0 }} />}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}
          </View> : null}

          <TouchableOpacity
            style={[s.submitBtn, { backgroundColor: isGave ? colors.willGet : colors.willGive, opacity: saving ? 0.6 : 1 }]}
            onPress={handleSubmit}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Text style={s.submitText}>
              {saving ? 'খসড়া সংরক্ষণ হচ্ছে…' : 'এন্ট্রি নিশ্চিত করুন'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.cancelBtn} onPress={() => { reset(); onClose(); }}>
            <Text style={s.cancelText}>বাতিল</Text>
          </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── ReminderSheet ───────────────────────────────────────────────────────────

interface ReminderSheetProps {
  visible: boolean;
  partyId: string;
  partyName: string;
  partyPhone: string;
  onClose: () => void;
}

function ReminderSheet({ visible, partyId, partyName, partyPhone, onClose }: ReminderSheetProps) {
  const colors = useColors();
  const sendReminder = useSendPaymentReminder();
  const [message, setMessage] = useState('');
  const [fetching, setFetching] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setMessage(''); setFetching(true);
    sendReminder.mutateAsync({ partyId })
      .then(r => setMessage(r.message))
      .catch(() => setMessage(''))
      .finally(() => setFetching(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, partyId]);

  async function handleSend() {
    if (!message.trim()) return;
    setSending(true);
    try {
      if (partyPhone) {
        const enc = encodeURIComponent(message.trim());
        const url = Platform.OS === 'ios' ? `sms:${partyPhone}&body=${enc}` : `sms:${partyPhone}?body=${enc}`;
        if (await Linking.canOpenURL(url)) { await Linking.openURL(url); onClose(); return; }
      }
      Alert.alert(
        'রিমাইন্ডার বার্তা',
        message.trim(),
        [{ text: 'বন্ধ করুন', style: 'cancel', onPress: onClose }],
      );
    } catch {
      Alert.alert('Error', 'SMS খোলা যায়নি। আবার চেষ্টা করুন।');
    } finally { setSending(false); }
  }

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 44 : 24 },
    handle: { width: 36, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
    title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 4 },
    subtitle: { fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginBottom: 20 },
    msgBox: { backgroundColor: colors.card, borderRadius: colors.radius, borderWidth: 1.5, borderColor: colors.border, padding: 14, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.foreground, minHeight: 120, textAlignVertical: 'top', marginBottom: 20 },
    sendBtn: { borderRadius: colors.radius, paddingVertical: 16, paddingHorizontal: 12, alignItems: 'center', backgroundColor: colors.primary, flexDirection: 'row', justifyContent: 'center', gap: 8, minHeight: 54 },
    sendBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
    cancelBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
    cancelText: { color: colors.mutedForeground, fontSize: 15, fontFamily: 'Inter_500Medium' },
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}
      >
        <View style={[s.sheet, { paddingBottom: Platform.OS === 'ios' ? 44 : 24 }]}>
          <View style={s.handle} />
          <Text style={s.title}>রিমাইন্ডার পাঠান</Text>
          <Text style={s.subtitle}>{partyName}</Text>

          {fetching ? (
            <View style={{ height: 120, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <TextInput
              style={s.msgBox}
              value={message}
              onChangeText={setMessage}
              multiline
              placeholder="রিমাইন্ডার বার্তা…"
              placeholderTextColor={colors.mutedForeground}
            />
          )}

          <TouchableOpacity
            style={[s.sendBtn, { opacity: fetching || sending || !message.trim() ? 0.5 : 1 }]}
            onPress={handleSend}
            disabled={fetching || sending || !message.trim()}
            activeOpacity={0.85}
          >
            <Feather name="send" size={16} color="#fff" />
            <Text style={s.sendBtnText}>
              {sending ? 'খুলছে…' : 'পাঠান'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
            <Text style={s.cancelText}>বাতিল</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── LedgerRow ───────────────────────────────────────────────────────────────

interface LedgerRowProps {
  entry: LedgerEntry;
  colors: ReturnType<typeof useColors>;
  onPress?: () => void;
  allowImages?: boolean;
  allowTransferLookup?: boolean;
}

function LedgerRow({ entry, colors, onPress, allowImages = true, allowTransferLookup = true }: LedgerRowProps) {
  const { getToken } = useAuth();
  const isGave = entry.type === 'YOU_GAVE';
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const rawSrc = allowImages ? billImageSrc(entry.billImage) : null;
  const [authToken, setAuthToken] = useState<string | null>(null);
  useEffect(() => {
    if (rawSrc && entry.billImage?.startsWith('/objects/')) getToken().then(setAuthToken);
  }, [rawSrc, entry.billImage, getToken]);

  const imgSrc = rawSrc
    ? { uri: rawSrc, ...(authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : {}) }
    : null;

  const entryIsToday = isToday(entry.createdAt);
  const dateLine = entryIsToday
    ? `${formatDate(entry.createdAt)} · আজ · ${formatTime(entry.createdAt)}`
    : `${formatDate(entry.createdAt)} · ${formatTime(entry.createdAt)}`;

  const descFallback = isGave ? 'আপনি দিয়েছেন' : 'আপনি পেয়েছেন';
  const typeTag = isGave ? '▲ আপনি দিয়েছেন' : '▼ আপনি পেয়েছেন';
  const isTransfer = entry.isTransfer;
  const tpId = isTransfer ? (entry.transferPartyId ?? '') : '';
  const { data: transferParty } = useGetParty(tpId, {
    query: { enabled: allowTransferLookup && !!tpId, queryKey: getGetPartyQueryKey(tpId) },
  });
  const transferPartyName = transferParty?.name ?? '';
  const transferLabel = isGave
    ? `আমি দিয়েছি${transferPartyName ? ` — ${transferPartyName}` : ''}`
    : `আমি পেয়েছি${transferPartyName ? ` — ${transferPartyName}` : ''}`;
  const transferLabelColor = isGave ? '#ef4444' : '#10b981';

  const s = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 64, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5, marginRight: 12, flexShrink: 0, backgroundColor: isGave ? colors.willGet : colors.willGive },
    desc: { fontSize: 14, fontFamily: 'Inter_500Medium', color: colors.foreground, flex: 1 },
    meta: { fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 2 },
    tag: { fontSize: 11, fontFamily: 'Inter_600SemiBold', marginTop: 3 },
    amount: { fontSize: 16, fontFamily: 'Inter_700Bold', textAlign: 'right', flexShrink: 0, paddingLeft: 10, maxWidth: '38%' },
    thumb: { width: 44, height: 44, borderRadius: 6, marginTop: 6, backgroundColor: colors.card },
  });

  return (
    <>
      <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={onPress ? 0.7 : 1}>
        <View style={s.dot} />
        <View style={{ flex: 1 }}>
          <Text style={[s.desc, isTransfer ? { color: transferLabelColor, fontFamily: 'Inter_700Bold' } : {}]} numberOfLines={2}>
            {isTransfer ? transferLabel : (entry.description || descFallback)}
          </Text>
          <Text style={s.meta}>{dateLine}</Text>
          <Text style={[s.tag, { color: isGave ? colors.willGet : colors.willGive }]}>{typeTag}</Text>
          {isTransfer && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
              <Feather name="repeat" size={10} color="#3b82f6" />
              <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#3b82f6' }}>ট্রান্সফার</Text>
            </View>
          )}
          {imgSrc ? (
            <TouchableOpacity onPress={() => setLightboxOpen(true)} activeOpacity={0.85}>
              <Image source={imgSrc} style={s.thumb} resizeMode="cover" />
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={[s.amount, { color: isGave ? colors.willGet : colors.willGive }]}>
          {isGave ? '+' : '-'}{fmtCur(entry.amount)}
        </Text>
      </TouchableOpacity>

      {imgSrc ? (
        <Modal visible={lightboxOpen} transparent animationType="fade" onRequestClose={() => setLightboxOpen(false)}>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' }}
            activeOpacity={1}
            onPress={() => setLightboxOpen(false)}
          >
            <Image source={imgSrc} style={{ width: '92%', height: '70%' }} resizeMode="contain" />
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 16 }}>
              বন্ধ করতে চাপুন
            </Text>
          </TouchableOpacity>
        </Modal>
      ) : null}
    </>
  );
}

// ─── EntryDetailSheet ────────────────────────────────────────────────────────

interface EntryDetailSheetProps {
  entry: LedgerEntry;
  party: Party;
  visible: boolean;
  onClose: () => void;
  onDeleted: () => void;
  onUpdated: (u: LedgerEntry) => void;
}

function EntryDetailSheet({ entry: init, party, visible, onClose, onDeleted, onUpdated }: EntryDetailSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const router = useRouter();
  const { identity } = useAuthRole();
  const { getToken } = useAuth();

  const [entry, setEntry] = useState(init);
  const [isEditing, setIsEditing] = useState(false);
  const [editAmount, setEditAmount] = useState(String(init.amount));
  const [editDesc, setEditDesc] = useState(init.description || '');
  const [editEntryDate, setEditEntryDate] = useState(init.createdAt.slice(0, 10));
  const [editDueDate, setEditDueDate] = useState(init.dueDate?.slice(0, 10) || '');
  const [editBillReference, setEditBillReference] = useState(init.billReference || '');
  const [editBillImageUri, setEditBillImageUri] = useState<string | null>(null);
  const [removeBillImage, setRemoveBillImage] = useState(false);
  const [editImageAuthToken, setEditImageAuthToken] = useState<string | null>(null);

  // Resolve the other side of a transfer entry
  const transferPartyId = entry.isTransfer ? (entry.transferPartyId ?? '') : '';
  const { data: transferParty } = useGetParty(transferPartyId, {
    query: { enabled: !!transferPartyId, queryKey: getGetPartyQueryKey(transferPartyId) },
  });

  useEffect(() => {
    if (visible) {
      setEntry(init); setEditAmount(String(init.amount));
      setEditDesc(init.description || ''); setEditEntryDate(init.createdAt.slice(0, 10));
      setEditDueDate(init.dueDate?.slice(0, 10) || '');
      setEditBillReference(init.billReference || ''); setEditBillImageUri(null);
      setRemoveBillImage(false); setIsEditing(false);
    }
  }, [visible, init.id]);

  useEffect(() => {
    if (entry.billImage?.startsWith('/objects/')) getToken().then(setEditImageAuthToken);
  }, [entry.billImage, getToken]);

  const patch = usePatchLedgerEntry();
  const del = useDeleteLedgerEntry();

  async function pickEditImage() {
    if (identity?.role === 'staff') return;
    Alert.alert('বিল সংযুক্ত করুন', 'উৎস বেছে নিন', [
      {
        text: 'ক্যামেরা',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            Alert.alert('অনুমতি প্রয়োজন', 'ছবি তুলতে ক্যামেরার অনুমতি দিন।');
            return;
          }
          const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
          if (!result.canceled && result.assets[0]) {
            setEditBillImageUri(result.assets[0].uri); setRemoveBillImage(false);
          }
        },
      },
      {
        text: 'ফটো লাইব্রেরি',
        onPress: async () => {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) {
            Alert.alert('অনুমতি প্রয়োজন', 'ফটো লাইব্রেরির অনুমতি দিন।');
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
          if (!result.canceled && result.assets[0]) {
            setEditBillImageUri(result.assets[0].uri); setRemoveBillImage(false);
          }
        },
      },
      { text: 'বাতিল', style: 'cancel' },
    ]);
  }

  async function uploadEditImage(uri: string): Promise<string> {
    if (!identity?.businessId) throw new Error('ব্যবসার পরিচয় পাওয়া যায়নি');
    const blob = await (await fetch(uri)).blob();
    const meta = await customFetch<{ uploadURL: string; objectPath: string }>('/api/storage/uploads/request-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-business-id': identity.businessId },
      body: JSON.stringify({ name: 'bill.jpg', size: blob.size, contentType: blob.type || 'image/jpeg' }),
    });
    const uploaded = await fetch(meta.uploadURL, {
      method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'image/jpeg' },
    });
    if (!uploaded.ok) throw new Error(`Bill upload failed: ${uploaded.status}`);
    return meta.objectPath;
  }

  const isGave = entry.type === 'YOU_GAVE';
  const amtColor = isGave ? colors.willGet : colors.willGive;
  const initials = party.name.slice(0, 2).toUpperCase();
  const isBalGet = party.balanceType === 'YOU_WILL_GET';
  const balColor = isBalGet ? colors.willGet : colors.willGive;
  const balSign = isBalGet ? '+' : '-';
  const dateLabel = `${formatDate(entry.createdAt)} • ${formatTime(entry.createdAt)}`;

  async function handleSave() {
    const connection = await NetInfo.fetch().catch(() => null);
    if (!connection || connection.isConnected !== true || connection.isInternetReachable === false) {
      Alert.alert('অফলাইনে সম্পাদনা করা যায় না', 'ইন্টারনেট ফিরে এলে আবার চেষ্টা করুন। ফর্মটি খোলা আছে।');
      return;
    }
    const p = parseFloat(editAmount);
    if (!editAmount || isNaN(p) || p <= 0) {
      Alert.alert('ভুল পরিমাণ', 'শূন্যের বেশি একটি বৈধ পরিমাণ লিখুন।');
      return;
    }
    if (!validDateInput(editEntryDate) || (editDueDate && !validDateInput(editDueDate))) {
      Alert.alert('তারিখ সঠিক নয়', 'তারিখ YYYY-MM-DD ফরম্যাটে লিখুন।');
      return;
    }
    try {
      const uploadedImage = editBillImageUri ? await uploadEditImage(editBillImageUri) : undefined;
      const updated = await patch.mutateAsync({
        partyId: entry.partyId, entryId: entry.id,
        data: {
          amount: p, description: editDesc.trim() || undefined,
          entryDate: editEntryDate,
          dueDate: editDueDate || null,
          billReference: editBillReference.trim() || null,
          ...(removeBillImage ? { billImage: null } : uploadedImage ? { billImage: uploadedImage } : {}),
        },
      });
      setEntry(updated); setEditAmount(String(updated.amount)); setEditDesc(updated.description || '');
      setEditEntryDate(updated.createdAt.slice(0, 10)); setEditDueDate(updated.dueDate?.slice(0, 10) || '');
      setEditBillReference(updated.billReference || ''); setEditBillImageUri(null); setRemoveBillImage(false);
      qc.invalidateQueries({ queryKey: [`/api/parties/${entry.partyId}/ledger-entries`] });
      qc.invalidateQueries({ queryKey: [`/api/parties/${entry.partyId}`] });
      qc.invalidateQueries({ queryKey: ['/api/dashboard/summary'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setIsEditing(false); onUpdated(updated);
    } catch {
      Alert.alert('Error', 'এন্ট্রি আপডেট করা যায়নি।');
    }
  }

  async function handleDelete() {
    const connection = await NetInfo.fetch().catch(() => null);
    if (!connection || connection.isConnected !== true || connection.isInternetReachable === false) {
      Alert.alert('অফলাইনে মুছতে পারবেন না', 'ইন্টারনেট ফিরে এলে আবার চেষ্টা করুন।');
      return;
    }
    Alert.alert(
      'এন্ট্রি মুছুন',
      entry.isTransfer
        ? 'এই ট্রান্সফার এবং অন্য খাতার সংযুক্ত এন্ট্রিটিও স্থায়ীভাবে মুছে যাবে। দুই পক্ষের ব্যালেন্স আপডেট হবে।'
        : 'এই এন্ট্রিটি স্থায়ীভাবে মুছে যাবে। আপনি কি নিশ্চিত?',
      [
        { text: 'বাতিল', style: 'cancel' },
        {
          text: 'মুছুন', style: 'destructive',
          onPress: async () => {
            try {
              await del.mutateAsync({ partyId: entry.partyId, entryId: entry.id });
              qc.invalidateQueries({ queryKey: [`/api/parties/${entry.partyId}/ledger-entries`] });
              qc.invalidateQueries({ queryKey: [`/api/parties/${entry.partyId}`] });
              qc.invalidateQueries({ queryKey: ['/api/dashboard/summary'] });
              qc.invalidateQueries({ queryKey: ['/api/parties'] });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              onDeleted();
            } catch {
              Alert.alert('Error', 'এন্ট্রি মুছে ফেলা যায়নি।');
            }
          },
        },
      ],
    );
  }

  async function handleShare() {
    const dir = isGave ? 'দিয়েছেন' : 'পেয়েছেন';
    const msg = `আপনি ${dir}: ${fmtCur(entry.amount)}\nব্যালেন্স: ${balSign}${fmtCur(party.currentBalance)}\nhttps://banglakhata.com/p/${entry.partyId}`;
    try { await Share.share({ message: msg }); } catch { /* ignore */ }
  }

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: '#F4F6F9' },
    header: { paddingTop: Platform.OS === 'web' ? 16 : insets.top + 8, paddingBottom: 16, paddingHorizontal: 20, backgroundColor: '#004B93', flexDirection: 'row', alignItems: 'center', gap: 20 },
    headerTitle: { flex: 1, fontSize: 18, fontFamily: 'Inter_700Bold', color: '#fff' },
    body: { flex: 1 },
    card: { backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', marginHorizontal: 16, marginTop: 16, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.06, shadowOffset: { width: 0, height: 2 }, shadowRadius: 6, elevation: 3 },
    initials: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#3B82F6', alignItems: 'center', justifyContent: 'center' },
    initialsText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 16 },
    pName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#1E293B' },
    dateText: { fontSize: 12, color: '#64748B', fontFamily: 'Inter_400Regular', marginTop: 2 },
    amtBig: { fontSize: 22, fontFamily: 'Inter_700Bold', textAlign: 'right' },
    dirLabel: { fontSize: 12, color: '#64748B', fontFamily: 'Inter_400Regular', textAlign: 'right', marginTop: 2 },
    balLabel: { fontSize: 14, color: '#475569', fontFamily: 'Inter_500Medium' },
    balValue: { fontSize: 16, fontFamily: 'Inter_700Bold' },
    editBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
    editBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#004B93' },
    infoCard: { backgroundColor: '#fff', borderRadius: 8, marginHorizontal: 16, marginTop: 12, padding: 16, borderWidth: 1, borderColor: '#E2E8F0' },
    smsHeading: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#B91C1C', marginBottom: 8 },
    smsBody: { fontSize: 13, color: '#475569', fontFamily: 'Inter_400Regular', lineHeight: 20 },
    smsLink: { color: '#004B93', fontFamily: 'Inter_500Medium' },
    backupText: { fontSize: 13, color: '#64748B', fontFamily: 'Inter_400Regular' },
    secBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 20, marginBottom: 8 },
    secText: { fontSize: 14, color: '#16A34A', fontFamily: 'Inter_600SemiBold' },
    bottomBar: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? insets.bottom + 8 : 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E2E8F0' },
    deleteBtn: { flex: 1, paddingVertical: 14, borderRadius: 6, borderWidth: 1, borderColor: '#DC2626', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
    deleteBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#DC2626' },
    shareBtn: { flex: 1, paddingVertical: 14, borderRadius: 6, backgroundColor: '#004B93', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
    shareBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
    editOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
    editCard: { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 },
    editTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#1E293B', marginBottom: 20 },
    editLabel: { fontSize: 12, color: '#64748B', fontFamily: 'Inter_500Medium', marginBottom: 6 },
    editInput: { borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 8, padding: 12, fontSize: 15, fontFamily: 'Inter_400Regular', color: '#1E293B', marginBottom: 16 },
    editActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 4 },
    cancelBtn: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 6, borderWidth: 1, borderColor: '#CBD5E1' },
    cancelBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#64748B' },
    saveBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 4, backgroundColor: '#004B93' },
    saveBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  });

  const balanceLabel = isGave ? 'আপনি দিয়েছেন' : 'আপনি পেয়েছেন';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="arrow-left" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>বিস্তারিত প্রবেশিকা</Text>
        </View>

        <ScrollView style={s.body} contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          {/* Summary card */}
          <View style={s.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 }}>
                <View style={s.initials}><Text style={s.initialsText}>{initials}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.pName} numberOfLines={1}>{party.name}</Text>
                  <Text style={s.dateText}>{dateLabel}</Text>
                </View>
              </View>
              <View style={{ marginLeft: 12, alignItems: 'flex-end' }}>
                <Text style={[s.amtBig, { color: amtColor }]}>{fmtCur(Math.abs(entry.amount))}</Text>
                <Text style={s.dirLabel}>{balanceLabel}</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
              <Text style={s.balLabel}>বর্তমান ব্যালেন্স</Text>
              <Text style={[s.balValue, { color: balColor }]}>{fmtCur(Math.abs(party.currentBalance))}</Text>
            </View>

            <TouchableOpacity style={s.editBtn} onPress={() => setIsEditing(true)} activeOpacity={0.7}>
              <Text style={{ fontSize: 15 }}>🖊️</Text>
              <Text style={s.editBtnText}>এন্ট্রি এডিট করুন</Text>
            </TouchableOpacity>
          </View>

          {/* Transfer / linked-party card */}
          {(entry.billReference || entry.dueDate || entry.billImage) ? (
            <View style={s.infoCard}>
              {entry.billReference ? <Text style={s.smsBody}>বিল / রেফারেন্স: {entry.billReference}</Text> : null}
              {entry.dueDate ? <Text style={s.smsBody}>বকেয়ার তারিখ: {formatDate(entry.dueDate)}</Text> : null}
              {entry.billImage && billImageSrc(entry.billImage) ? (
                <Image
                  source={{ uri: billImageSrc(entry.billImage)!, ...(editImageAuthToken ? { headers: { Authorization: `Bearer ${editImageAuthToken}` } } : {}) }}
                  style={{ width: 110, height: 110, borderRadius: 10, marginTop: 10 }}
                  resizeMode="cover"
                />
              ) : null}
            </View>
          ) : null}

          {/* Transfer / linked-party card */}
          {entry.isTransfer && transferPartyId ? (
            <TouchableOpacity
              style={[s.infoCard, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}
              activeOpacity={0.75}
              disabled={!transferParty}
              onPress={() => { onClose(); router.push(`/party/${transferPartyId}`); }}
            >
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#3B82F6', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 14 }}>
                  {(transferParty?.name ?? '…').slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'Inter_500Medium', marginBottom: 2 }}>কার সাথে অ্যাডজাস্ট?</Text>
                <Text style={{ fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#1E293B' }} numberOfLines={1}>
                  {transferParty?.name ?? entry.description ?? '…'}
                </Text>
                {transferParty?.phone ? (
                  <Text style={{ fontSize: 12, color: '#64748B', fontFamily: 'Inter_400Regular', marginTop: 1 }}>{transferParty.phone}</Text>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#2563EB' }}>{transferParty ? 'খাতা দেখুন' : 'খাতা দেখার অনুমতি নেই'}</Text>
                {transferParty ? <Feather name="arrow-right" size={15} color="#2563EB" /> : null}
              </View>
            </TouchableOpacity>
          ) : null}

          {/* SMS card */}
          <View style={s.infoCard}>
            <Text style={s.smsHeading}>📋 SMS পাঠানো হয়নি</Text>
            <Text style={s.smsBody}>
              {`আপনি ${isGave ? 'দিয়েছেন' : 'পেয়েছেন'}: ${fmtCur(Math.abs(entry.amount))}\nব্যালেন্স: ${fmtCur(Math.abs(party.currentBalance))}\n`}
              <Text style={s.smsLink} onPress={() => Linking.openURL(`https://banglakhata.com/p/${entry.partyId}`)}>
                {`https://banglakhata.com/p/${entry.partyId}`}
              </Text>
            </Text>
          </View>

          {/* Backup card */}
          <View style={s.infoCard}>
            <Text style={s.backupText}>☁️ এন্ট্রি ব্যাক আপ করা হয়েছে</Text>
          </View>

          {/* Security badge */}
          <View style={s.secBadge}>
            <Text style={s.secText}>✔️ 100% নিরাপদ ও সুরক্ষিত</Text>
          </View>
        </ScrollView>

        {/* Bottom bar */}
        <View style={s.bottomBar}>
          <TouchableOpacity style={s.deleteBtn} onPress={handleDelete} disabled={del.isPending} activeOpacity={0.8}>
            <Text style={{ fontSize: 16 }}>🗑️</Text>
            <Text style={s.deleteBtnText}>মুছে ফেলুন</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.shareBtn} onPress={handleShare} activeOpacity={0.8}>
            <Text style={{ fontSize: 16 }}>📬</Text>
            <Text style={s.shareBtnText}>শেয়ার করুন</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Edit modal */}
      <Modal visible={isEditing} transparent animationType="fade" onRequestClose={() => setIsEditing(false)}>
        <KeyboardAvoidingView style={s.editOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.editCard}>
            <Text style={s.editTitle}>এন্ট্রি সংশোধন (Re-entry)</Text>
            <Text style={s.editLabel}>টাকার পরিমাণ (৳)</Text>
            <TextInput
              style={s.editInput}
              value={editAmount}
              onChangeText={setEditAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor="#CBD5E1"
              autoFocus
            />
            <Text style={s.editLabel}>বিবরণ / ডিটেলস</Text>
            <TextInput
              style={s.editInput}
              value={editDesc}
              onChangeText={setEditDesc}
              placeholder="নোট (ঐচ্ছিক)"
              placeholderTextColor="#CBD5E1"
              returnKeyType="done"
            />
            <Text style={s.editLabel}>এন্ট্রির তারিখ (YYYY-MM-DD)</Text>
            <TextInput style={s.editInput} value={editEntryDate} onChangeText={setEditEntryDate} placeholder="YYYY-MM-DD" placeholderTextColor="#CBD5E1" />
            <Text style={s.editLabel}>বকেয়ার তারিখ (YYYY-MM-DD)</Text>
            <TextInput style={s.editInput} value={editDueDate} onChangeText={setEditDueDate} placeholder="YYYY-MM-DD (ঐচ্ছিক)" placeholderTextColor="#CBD5E1" />
            <Text style={s.editLabel}>বিল / রেফারেন্স নম্বর</Text>
            <TextInput style={s.editInput} value={editBillReference} onChangeText={setEditBillReference} placeholder="ঐচ্ছিক" placeholderTextColor="#CBD5E1" />
            {identity?.role !== 'staff' ? (
              <View style={{ marginBottom: 14 }}>
                <Text style={s.editLabel}>বিলের ছবি</Text>
                {editBillImageUri || (!removeBillImage && entry.billImage && billImageSrc(entry.billImage)) ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Image
                      source={{ uri: editBillImageUri ?? billImageSrc(entry.billImage)! }}
                      style={{ width: 64, height: 64, borderRadius: 8 }}
                    />
                    <TouchableOpacity onPress={() => { setEditBillImageUri(null); setRemoveBillImage(true); }}>
                      <Text style={{ color: colors.destructive, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>ছবি সরান</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
                <TouchableOpacity
                  style={{ marginTop: 9, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 11, alignItems: 'center' }}
                  onPress={() => void pickEditImage()}
                >
                  <Text style={{ color: colors.foreground, fontFamily: 'Inter_500Medium', fontSize: 13 }}>
                    {editBillImageUri || entry.billImage ? 'ছবি পরিবর্তন করুন' : 'বিলের ছবি যোগ করুন'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <View style={s.editActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setIsEditing(false)}>
                <Text style={s.cancelBtnText}>বাতিল</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveBtn, { opacity: patch.isPending ? 0.6 : 1 }]}
                onPress={handleSave}
                disabled={patch.isPending}
              >
                <Text style={s.saveBtnText}>
                  {patch.isPending ? 'সংরক্ষণ হচ্ছে…' : 'সংরক্ষণ করুন'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Modal>
  );
}

// ─── PartyDetailScreen ───────────────────────────────────────────────────────

export default function PartyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { identity } = useAuthRole();
  const isStaff = identity?.role === 'staff';
  const queryClient = useQueryClient();
  const deleteParty = useDeleteParty();

  const [showSheet, setShowSheet] = useState(false);
  const [pendingType, setPendingType] = useState<'YOU_GAVE' | 'YOU_GOT'>('YOU_GAVE');
  const [showReminderSheet, setShowReminderSheet] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<LedgerEntry | null>(null);
  const [pendingEntries, setPendingEntries] = useState<QueuedEntry[]>([]);
  const [outboxError, setOutboxError] = useState('');

  useEffect(() => {
    setPendingEntries([]);
    setOutboxError('');
    if (!identity || !id) return;
    let active = true;
    const refresh = () => {
      void listEntries(identity.userId, identity.businessId).then((items) => {
        if (active) setPendingEntries(items.filter((item) => item.partyId === id));
      }).catch(() => { if (active) setOutboxError('অফলাইন খসড়া পড়া যাচ্ছে না। ডিভাইস স্টোরেজ পরীক্ষা করুন।'); });
    };
    refresh();
    const unsubscribe = subscribeOutbox(refresh);
    return () => { active = false; unsubscribe(); };
  }, [identity?.userId, identity?.businessId, id]);

  const { data: party, isLoading: partyLoading, refetch: refetchParty } = useGetParty(id!, {
    query: { enabled: !!identity && !!id, queryKey: getGetPartyQueryKey(id!) },
  });
  const { data: entries = [], isLoading: entriesLoading, refetch: refetchEntries } = useListLedgerEntries(id!, {
    query: { enabled: !!identity && !!id, queryKey: getListLedgerEntriesQueryKey(id!) },
  });

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([refetchParty(), refetchEntries()]);
    setRefreshing(false);
  }

  const isGet = party?.balanceType === 'YOU_WILL_GET';

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingTop: Platform.OS === 'web' ? 67 : insets.top + 8, paddingHorizontal: 16, paddingBottom: 16, backgroundColor: colors.primary },
    backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    backText: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontFamily: 'Inter_500Medium', marginLeft: 4 },
    partyAv: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
    partyAvText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 20 },
    partyName: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#fff' },
    partyPhone: { fontSize: 13, color: 'rgba(255,255,255,0.65)', fontFamily: 'Inter_400Regular', marginTop: 2 },
    balCard: { backgroundColor: colors.card, marginHorizontal: 16, marginTop: -1, borderRadius: colors.radius, padding: 20, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.06, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 3 },
    balLeft: { flex: 1 },
    balLabelText: { fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 4 },
    balAmount: { fontSize: 32, fontFamily: 'Inter_700Bold' },
    balType: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginTop: 4 },
    actionRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginTop: 14, marginBottom: 8 },
    actionBtn: { flex: 1, paddingVertical: 14, borderRadius: colors.radius, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
    actionBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
    entriesHeader: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 8, backgroundColor: colors.background },
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
          পার্টি পাওয়া যায়নি
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: colors.primary, fontFamily: 'Inter_500Medium' }}>পেছনে যান</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const initials = party.name.slice(0, 2).toUpperCase();
  const roleLabel = party.role === 'CUSTOMER' ? 'গ্রাহক' : 'সরবরাহকারী';
  const partyId = party.id;

  function confirmPartyDelete() {
    Alert.alert(
      `${roleLabel} মুছুন`,
      `এই ${roleLabel}-এর সব লেনদেন এবং অন্য খাতার সংযুক্ত ট্রান্সফারও স্থায়ীভাবে মুছে যাবে। অন্য পক্ষের ব্যালেন্স সংশোধন হবে। ফিরিয়ে আনা যাবে না।`,
      [
        { text: 'বাতিল', style: 'cancel' },
        {
          text: 'স্থায়ীভাবে মুছুন',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const connection = await NetInfo.fetch().catch(() => null);
              if (!connection || connection.isConnected !== true || connection.isInternetReachable === false) {
                Alert.alert('ইন্টারনেট প্রয়োজন', 'অনলাইনে এলে আবার চেষ্টা করুন।');
                return;
              }
              try {
                await deleteParty.mutateAsync({ partyId });
                queryClient.removeQueries({ queryKey: getGetPartyQueryKey(partyId) });
                queryClient.removeQueries({ queryKey: getListLedgerEntriesQueryKey(partyId) });
                await queryClient.invalidateQueries({ queryKey: getListPartiesQueryKey() });
                await queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                router.replace('/');
              } catch {
                Alert.alert('Error', 'কাস্টমার বা সাপ্লায়ার মুছে ফেলা যায়নি।');
              }
            })();
          },
        },
      ],
    );
  }

  const quickActions = isStaff ? [
    { icon: 'edit-3' as const, label: 'এন্ট্রি', onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setPendingType('YOU_GAVE'); setShowSheet(true); } },
  ] : [
    { icon: 'file-text' as const,      label: 'রিপোর্ট',    onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/report/${id}` as any); } },
    { icon: 'bell' as const,           label: 'রিমাইন্ডার', onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowReminderSheet(true); } },
    { icon: 'edit-3' as const,         label: 'এন্ট্রি',     onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setPendingType('YOU_GAVE'); setShowSheet(true); } },
  ];

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
            <Feather name="chevron-left" size={18} color="rgba(255,255,255,0.8)" />
            <Text style={s.backText}>পেছনে</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={confirmPartyDelete}
            disabled={deleteParty.isPending}
            accessibilityRole="button"
            accessibilityLabel={`${roleLabel} মুছুন`}
            style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)', opacity: deleteParty.isPending ? 0.5 : 1 }}
          >
            {deleteParty.isPending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Feather name="trash-2" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>
        <View style={s.partyAv}><Text style={s.partyAvText}>{initials}</Text></View>
        <Text style={s.partyName}>{party.name}</Text>
        {party.phone ? <Text style={s.partyPhone}>{party.phone}</Text> : null}
        <Text style={[s.partyPhone, { marginTop: 4 }]}>{roleLabel}</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
      >
        {/* Balance card */}
        <View style={s.balCard}>
          <View style={s.balLeft}>
            <Text style={s.balLabelText}>বর্তমান ব্যালেন্স</Text>
            <Text style={[s.balAmount, { color: isGet ? colors.willGet : colors.willGive }]}>
              {fmtCur(party.currentBalance)}
            </Text>
            <Text style={[s.balType, { color: isGet ? colors.willGet : colors.willGive }]}>
              {isGet ? '↑ আপনি পাবেন' : '↓ আপনি দেবেন'}
            </Text>
          </View>
          {party.dueDate ? (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
                বকেয়ার তারিখ
              </Text>
              <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginTop: 2 }}>
                {party.dueDate}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Main action buttons */}
        <View style={s.actionRow}>
          <TouchableOpacity
            style={[s.actionBtn, { backgroundColor: colors.willGetBg }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setPendingType('YOU_GAVE'); setShowSheet(true); }}
            activeOpacity={0.8}
          >
            <Feather name="arrow-up-right" size={18} color={colors.willGet} />
            <Text style={[s.actionBtnText, { color: colors.willGet }]}>আপনি দিয়েছেন</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.actionBtn, { backgroundColor: colors.willGiveBg }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setPendingType('YOU_GOT'); setShowSheet(true); }}
            activeOpacity={0.8}
          >
            <Feather name="arrow-down-left" size={18} color={colors.willGive} />
            <Text style={[s.actionBtnText, { color: colors.willGive }]}>আপনি পেয়েছেন</Text>
          </TouchableOpacity>
        </View>

        {/* Owner-only report/reminder actions; staff can create standard entries only. */}
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 4 }}>
          {quickActions.map(({ icon, label, onPress }) => (
            <TouchableOpacity
              key={label}
              style={{ flex: 1, paddingVertical: 10, borderRadius: colors.radius, alignItems: 'center', gap: 4, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
              onPress={onPress}
              activeOpacity={0.75}
            >
              <Feather name={icon} size={16} color={colors.primary} />
              <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.primary }}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Transaction history header */}
        <View style={s.entriesHeader}>
          <Text style={s.entriesTitle}>
            লেনদেনের ইতিহাস ({entries.length})
          </Text>
        </View>

        {outboxError ? <Text accessibilityRole="alert" style={{ color: '#b91c1c', margin: 16 }}>{outboxError}</Text> : null}
        {pendingEntries.length > 0 && (
          <View style={{ marginHorizontal: 16, padding: 14, backgroundColor: '#fffbeb', borderRadius: 12, borderWidth: 1, borderColor: '#fcd34d' }}>
            <Text style={{ color: '#92400e', fontFamily: 'Inter_700Bold', fontSize: 13, marginBottom: 8 }}>
              অপেক্ষমাণ খসড়া · সার্ভারের ব্যালেন্সে যোগ হয়নি
            </Text>
            {pendingEntries.map((draft) => (
              <View key={draft.id} style={{ borderTopWidth: 1, borderTopColor: '#fde68a', paddingVertical: 8 }}>
                <Text style={{ color: '#78350f', fontFamily: 'Inter_600SemiBold' }}>
                  {draft.data.type === 'YOU_GAVE' ? 'আপনি দিয়েছেন' : 'আপনি পেয়েছেন'}: {fmtCur(draft.data.amount)}
                  {draft.data.isTransfer ? ' · ⇄ ট্রান্সফার' : ''}
                </Text>
                {draft.data.description ? <Text style={{ color: '#92400e', fontSize: 12 }}>{draft.data.description}</Text> : null}
                <Text accessibilityRole={draft.status === 'rejected' ? 'alert' : undefined}
                  style={{ color: draft.status === 'rejected' ? '#b91c1c' : '#92400e', fontSize: 12 }}>
                  {draft.status === 'rejected' ? `সংরক্ষণ প্রত্যাখ্যাত: ${draft.error}` : 'সিঙ্কের অপেক্ষায় · নিশ্চিত হলে হিসাবে দেখাবে'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {entriesLoading ? (
          <View style={{ padding: 32, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View>
        ) : entries.length === 0 ? (
          <View style={s.emptyContainer}>
            <Feather name="file-text" size={36} color={colors.border} />
            <Text style={s.emptyText}>এখনো কোনো লেনদেন নেই</Text>
          </View>
        ) : (
          entries.map(entry => (
            <LedgerRow
              key={entry.id}
              entry={entry}
              colors={colors}
              allowImages={!isStaff}
              allowTransferLookup={!isStaff}
              onPress={isStaff ? undefined : () => setSelectedEntry(entry)}
            />
          ))
        )}

        <View style={s.bottomPad} />
      </ScrollView>

      <TransactionSheet
        visible={showSheet}
        initialType={pendingType}
        partyId={id!}
        partyName={party.name}
        staffMode={isStaff}
        adjustmentPartyIds={identity?.adjustmentPartyIds ?? []}
        actorId={identity?.userId ?? ''}
        businessId={identity?.businessId ?? ''}
        onClose={() => setShowSheet(false)}
        onSuccess={() => { refetchParty(); refetchEntries(); }}
      />

      {!isStaff ? <ReminderSheet
        visible={showReminderSheet}
        partyId={id!}
        partyName={party.name}
        partyPhone={party.phone ?? ''}
        onClose={() => setShowReminderSheet(false)}
      /> : null}

      {!isStaff && selectedEntry && (
        <EntryDetailSheet
          entry={selectedEntry}
          party={party}
          visible
          onClose={() => setSelectedEntry(null)}
          onDeleted={() => { setSelectedEntry(null); refetchParty(); refetchEntries(); }}
          onUpdated={u => { setSelectedEntry(u); refetchParty(); refetchEntries(); }}
        />
      )}

    </View>
  );
}
