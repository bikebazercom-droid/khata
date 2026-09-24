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
  ScrollView,
  Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@clerk/expo';
import {
  useListParties,
  useCreateParty,
  useBulkSaveBengaliLedger,
  type BengaliLedgerItem,
} from '@workspace/api-client-react';
import type { Party } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/lib/i18n';

const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : '';

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
        <Text style={s.balanceLabel}>{isGet ? 'পেয়েছেন' : 'দিয়েছেন'}</Text>
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

// ─── BengaliLedgerScannerSheet ────────────────────────────────────────────────

interface ScannerSheetProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type ScanStep = 'pick' | 'scanning' | 'review' | 'saving';

interface ReviewItem extends BengaliLedgerItem {
  _id: string;
  enabled: boolean;
  editAmount: string;
  editType: 'YOU_GAVE' | 'YOU_GOT';
  editNote: string;
  resolvedPartyId: string | null;
  resolvedPartyName: string;
}

function BengaliLedgerScannerSheet({ visible, onClose, onSuccess }: ScannerSheetProps) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const bulkSaveMutation = useBulkSaveBengaliLedger();
  const { data: allParties = [] } = useListParties({});
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<ScanStep>('pick');
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPartyPicker, setShowPartyPicker] = useState<string | null>(null); // item _id

  function handleClose() {
    setStep('pick'); setItems([]); setPreviewUri(null); setError(null);
    onClose();
  }

  async function pickAndScan(source: 'camera' | 'gallery') {
    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') { Alert.alert('অনুমতি দরকার', 'ক্যামেরা ব্যবহারের অনুমতি দিন।'); return; }
      result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert('অনুমতি দরকার', 'গ্যালারি ব্যবহারের অনুমতি দিন।'); return; }
      result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    }
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0]!;
    setPreviewUri(asset.uri);
    setError(null);
    setStep('scanning');

    try {
      const fd = new FormData();
      fd.append('image', { uri: asset.uri, type: asset.mimeType ?? 'image/jpeg', name: 'ledger.jpg' } as any);
      const token = await getToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE}/api/scan/bengali-ledger`, { method: 'POST', headers, body: fd });
      if (!res.ok) throw new Error('scan failed');
      const data = await res.json() as { items: BengaliLedgerItem[] };

      if (!data.items?.length) {
        setError('ছবিতে কোনো লেনদেন পাওয়া যায়নি। স্পষ্ট আলোতে পুনরায় চেষ্টা করুন।');
        setStep('pick'); return;
      }

      setItems(data.items.map((item, i) => ({
        ...item,
        _id: String(i),
        enabled: true,
        editAmount: String(item.amount),
        editType: item.type as 'YOU_GAVE' | 'YOU_GOT',
        editNote: item.note ?? '',
        resolvedPartyId: item.partyId,
        resolvedPartyName: item.partyName,
      })));
      setStep('review');
    } catch {
      setError('স্ক্যান করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।');
      setStep('pick');
    }
  }

  function toggle(id: string) {
    setItems(prev => prev.map(i => i._id === id ? { ...i, enabled: !i.enabled } : i));
  }
  function updateItem<K extends keyof ReviewItem>(id: string, field: K, value: ReviewItem[K]) {
    setItems(prev => prev.map(i => i._id === id ? { ...i, [field]: value } : i));
  }
  function reassignParty(itemId: string, partyId: string) {
    const p = allParties.find(x => x.id === partyId);
    if (!p) return;
    setItems(prev => prev.map(i => i._id === itemId ? { ...i, resolvedPartyId: p.id, resolvedPartyName: p.name } : i));
    setShowPartyPicker(null);
  }

  async function handleConfirm() {
    const toSave = items.filter(i => i.enabled && Number(i.editAmount) > 0 && i.resolvedPartyId);
    if (!toSave.length) { Alert.alert('মনোযোগ', 'কমপক্ষে একটি সম্পূর্ণ এন্ট্রি নির্বাচন করুন।'); return; }
    setStep('saving');
    try {
      await bulkSaveMutation.mutateAsync({
        data: {
          entries: toSave.map(i => ({
            partyId: i.resolvedPartyId!,
            amount: Number(i.editAmount),
            type: i.editType,
            note: i.editNote,
          })),
        },
      });
      await qc.invalidateQueries({ queryKey: ['/api/parties'] });
      onSuccess();
      Alert.alert('সফল!', `${toSave.length}টি হিসাব সেভ হয়েছে।`);
      handleClose();
    } catch {
      Alert.alert('সমস্যা', 'সংরক্ষণ করতে সমস্যা হয়েছে।');
      setStep('review');
    }
  }

  const enabledCount = items.filter(i => i.enabled && Number(i.editAmount) > 0 && i.resolvedPartyId).length;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
        {/* Header */}
        <View style={{ backgroundColor: '#1B3A6B', paddingTop: insets.top + 12, paddingBottom: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={handleClose} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="x" size={20} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' }}>বাংলা খাতা স্ক্যান</Text>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, fontFamily: 'Inter_400Regular' }}>হাতে লেখা খাতা থেকে হিসাব তুলুন</Text>
          </View>
          {step === 'review' && (
            <TouchableOpacity onPress={() => { setStep('pick'); setPreviewUri(null); setItems([]); }}>
              <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>নতুন ছবি</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
          {/* Pick / Scanning */}
          {(step === 'pick' || step === 'scanning') && (
            <View style={{ alignItems: 'center', paddingTop: 32, gap: 20 }}>
              {previewUri && step === 'scanning' && (
                <Image source={{ uri: previewUri }} style={{ width: '100%', height: 200, borderRadius: 16 }} resizeMode="cover" />
              )}
              {step === 'scanning' ? (
                <>
                  <ActivityIndicator size="large" color="#1B3A6B" />
                  <Text style={{ color: '#334155', fontFamily: 'Inter_600SemiBold', fontSize: 15 }}>AI বিশ্লেষণ করছে…</Text>
                  <Text style={{ color: '#94a3b8', fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center' }}>হাতে লেখা নাম ও পরিমাণ চিনছে</Text>
                </>
              ) : (
                <>
                  <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(27,58,107,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="camera" size={30} color="#1B3A6B" />
                  </View>
                  <Text style={{ fontSize: 18, fontFamily: 'Inter_700Bold', color: '#0f172a', textAlign: 'center' }}>বাংলা খাতার ছবি তুলুন</Text>
                  <Text style={{ color: '#64748b', fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
                    হাতে লেখা খাতার ছবি তুলুন — AI সব নাম চিনে সংশ্লিষ্ট হিসাবে যোগ করবে।
                  </Text>
                  {error && (
                    <View style={{ backgroundColor: '#fef2f2', borderRadius: 12, padding: 12, flexDirection: 'row', gap: 8, alignItems: 'flex-start', width: '100%' }}>
                      <Feather name="alert-circle" size={14} color="#ef4444" style={{ marginTop: 1 }} />
                      <Text style={{ color: '#ef4444', fontFamily: 'Inter_500Medium', fontSize: 13, flex: 1 }}>{error}</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={{ backgroundColor: '#1B3A6B', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%', justifyContent: 'center' }}
                    onPress={() => pickAndScan('camera')} activeOpacity={0.8}
                  >
                    <Feather name="camera" size={18} color="#fff" />
                    <Text style={{ color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 15 }}>ক্যামেরা দিয়ে ছবি তুলুন</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ borderWidth: 2, borderColor: '#1B3A6B', borderRadius: 14, paddingVertical: 13, paddingHorizontal: 32, flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%', justifyContent: 'center' }}
                    onPress={() => pickAndScan('gallery')} activeOpacity={0.8}
                  >
                    <Feather name="image" size={18} color="#1B3A6B" />
                    <Text style={{ color: '#1B3A6B', fontFamily: 'Inter_700Bold', fontSize: 15 }}>গ্যালারি থেকে ছবি বেছে নিন</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {/* Review */}
          {step === 'review' && (
            <View style={{ gap: 10 }}>
              {previewUri && (
                <Image source={{ uri: previewUri }} style={{ width: '100%', height: 140, borderRadius: 14 }} resizeMode="cover" />
              )}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <Text style={{ fontSize: 15, fontFamily: 'Inter_700Bold', color: '#0f172a' }}>{items.length}টি লেনদেন পাওয়া গেছে</Text>
                <Text style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'Inter_400Regular' }}>{enabledCount}টি নির্বাচিত</Text>
              </View>

              {items.map(item => (
                <View key={item._id} style={{ backgroundColor: item.enabled ? '#fff' : '#f8fafc', borderRadius: 14, borderWidth: 1, borderColor: item.enabled ? '#e2e8f0' : '#f1f5f9', opacity: item.enabled ? 1 : 0.55, padding: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    {/* Checkbox */}
                    <TouchableOpacity onPress={() => toggle(item._id)} style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: item.enabled ? '#1B3A6B' : '#cbd5e1', backgroundColor: item.enabled ? '#1B3A6B' : '#fff', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                      {item.enabled && <Feather name="check" size={12} color="#fff" />}
                    </TouchableOpacity>

                    <View style={{ flex: 1, gap: 8 }}>
                      {/* Party name + confidence */}
                      <View>
                        <Text style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'Inter_500Medium' }}>
                          চিহ্নিত নাম
                          <Text style={{ color: item.confidence === 'high' ? '#059669' : item.confidence === 'medium' ? '#d97706' : '#ef4444' }}>
                            {' '}({item.confidence === 'high' ? 'উচ্চ' : item.confidence === 'medium' ? 'মধ্যম' : 'কম'})
                          </Text>
                        </Text>
                        {item.resolvedPartyId ? (
                          <Text style={{ fontSize: 15, fontFamily: 'Inter_700Bold', color: '#0f172a' }}>{item.resolvedPartyName}</Text>
                        ) : (
                          <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#d97706' }}>⚠️ "{item.extractedName}" — মেলেনি</Text>
                        )}
                        {item.extractedName && item.extractedName !== item.resolvedPartyName && (
                          <Text style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'Inter_400Regular' }}>খাতায়: {item.extractedName}</Text>
                        )}
                      </View>

                      {/* Party reassign button */}
                      <TouchableOpacity
                        onPress={() => setShowPartyPicker(showPartyPicker === item._id ? null : item._id)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#f8fafc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#e2e8f0' }}
                        disabled={!item.enabled}
                      >
                        <Feather name="users" size={13} color="#64748b" />
                        <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: '#64748b', flex: 1 }} numberOfLines={1}>
                          {item.resolvedPartyId ? item.resolvedPartyName : '— পার্টি বেছে নিন —'}
                        </Text>
                        <Feather name="chevron-down" size={13} color="#94a3b8" />
                      </TouchableOpacity>

                      {/* Party picker dropdown */}
                      {showPartyPicker === item._id && (
                        <View style={{ backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', maxHeight: 180 }}>
                          <ScrollView nestedScrollEnabled>
                            {allParties.map(p => (
                              <TouchableOpacity
                                key={p.id}
                                onPress={() => reassignParty(item._id, p.id)}
                                style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', flexDirection: 'row', gap: 8, alignItems: 'center' }}
                              >
                                <Feather name="user" size={13} color="#64748b" />
                                <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: '#334155', flex: 1 }}>{p.name}</Text>
                                <Text style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'Inter_400Regular' }}>
                                  {p.role === 'CUSTOMER' ? 'গ্রাহক' : 'সরবরাহকারী'}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </View>
                      )}

                      {/* Type toggle + Amount */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{ flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#e2e8f0' }}>
                          <TouchableOpacity disabled={!item.enabled} onPress={() => updateItem(item._id, 'editType', 'YOU_GAVE')} style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: item.editType === 'YOU_GAVE' ? '#ef4444' : '#fff' }}>
                            <Text style={{ fontSize: 11, fontFamily: 'Inter_700Bold', color: item.editType === 'YOU_GAVE' ? '#fff' : '#94a3b8' }}>দিয়েছি</Text>
                          </TouchableOpacity>
                          <TouchableOpacity disabled={!item.enabled} onPress={() => updateItem(item._id, 'editType', 'YOU_GOT')} style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: item.editType === 'YOU_GOT' ? '#10b981' : '#fff' }}>
                            <Text style={{ fontSize: 11, fontFamily: 'Inter_700Bold', color: item.editType === 'YOU_GOT' ? '#fff' : '#94a3b8' }}>পেয়েছি</Text>
                          </TouchableOpacity>
                        </View>
                        <TextInput
                          keyboardType="numeric"
                          editable={item.enabled}
                          value={item.editAmount}
                          onChangeText={v => updateItem(item._id, 'editAmount', v)}
                          style={{ flex: 1, textAlign: 'right', fontSize: 18, fontFamily: 'Inter_700Bold', color: '#0f172a', borderBottomWidth: 1, borderBottomColor: '#e2e8f0', paddingBottom: 2 }}
                          placeholder="০" placeholderTextColor="#cbd5e1"
                        />
                      </View>

                      {/* Note */}
                      <TextInput
                        editable={item.enabled}
                        value={item.editNote}
                        onChangeText={v => updateItem(item._id, 'editNote', v)}
                        placeholder="বিবরণ (ঐচ্ছিক)" placeholderTextColor="#cbd5e1"
                        style={{ fontSize: 12, color: '#475569', fontFamily: 'Inter_400Regular', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingBottom: 2 }}
                      />
                    </View>
                  </View>
                </View>
              ))}

              {items.some(i => !i.resolvedPartyId) && (
                <View style={{ backgroundColor: '#fffbeb', borderRadius: 12, padding: 12, flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: '#fde68a' }}>
                  <Feather name="alert-circle" size={14} color="#d97706" style={{ marginTop: 1 }} />
                  <Text style={{ color: '#92400e', fontFamily: 'Inter_500Medium', fontSize: 12, flex: 1 }}>কিছু নাম মেলেনি। ওপরের বাটনে চেপে পার্টি বেছে দিন অথবা সেই এন্ট্রিগুলো বাতিল করুন।</Text>
                </View>
              )}
            </View>
          )}

          {/* Saving */}
          {step === 'saving' && (
            <View style={{ alignItems: 'center', paddingTop: 60, gap: 16 }}>
              <ActivityIndicator size="large" color="#1B3A6B" />
              <Text style={{ color: '#334155', fontFamily: 'Inter_600SemiBold', fontSize: 15 }}>সংরক্ষণ করা হচ্ছে…</Text>
            </View>
          )}
        </ScrollView>

        {/* Confirm button */}
        {step === 'review' && (
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, paddingBottom: insets.bottom + 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#f1f5f9' }}>
            <TouchableOpacity
              onPress={handleConfirm}
              disabled={enabledCount === 0}
              style={{ backgroundColor: '#1B3A6B', borderRadius: 14, paddingVertical: 15, alignItems: 'center', opacity: enabledCount === 0 ? 0.5 : 1 }}
              activeOpacity={0.8}
            >
              <Text style={{ color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 15 }}>সব হিসাব নিশ্চিত ও সেভ করুন ({enabledCount}টি)</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ─── PartiesScreen ────────────────────────────────────────────────────────────

export default function PartiesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<Tab>('CUSTOMER');
  const [search, setSearch] = useState('');
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [showScanSheet, setShowScanSheet] = useState(false);
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
    : isCustomer ? 'এখনো কোনো কাস্টমার নেই' : 'এখনো কোনো সাপ্লায়ার নেই';
  const noResultsBody = search
    ? t('tryDifferentSearch')
    : isCustomer ? '+ চাপুন প্রথম কাস্টমার যোগ করতে' : '+ চাপুন প্রথম সাপ্লায়ার যোগ করতে';

  return (
    <View style={s.container}>
      <View style={s.header}>
        <View style={s.titleRow}>
          <Text style={s.title}>{t('partiesTitle')}</Text>
          {/* Scan button */}
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7, marginRight: 8 }}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowScanSheet(true);
            }}
          >
            <Feather name="camera" size={14} color={colors.primary} />
            <Text style={{ fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary }}>স্ক্যান</Text>
          </TouchableOpacity>
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

      <BengaliLedgerScannerSheet
        visible={showScanSheet}
        onClose={() => setShowScanSheet(false)}
        onSuccess={() => refetch()}
      />
    </View>
  );
}
