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
  useCreateLedgerEntry,
  useSendPaymentReminder,
  usePatchLedgerEntry,
  useDeleteLedgerEntry,
} from '@workspace/api-client-react';
import type { LedgerEntry, Party } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/lib/i18n';
import { useQueryClient } from '@tanstack/react-query';

// ─── Module-level helpers (no closures over lang/isEnglish) ─────────────────

const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : '';

const BN_DIGITS: Record<string, string> = {
  '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪',
  '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯',
};

/** Currency formatter — takes isEnglish as a plain arg, zero closure risk. */
function fmtCur(n: number, isEnglish: boolean): string {
  const abs = Math.abs(n);
  const hasDecimal = !Number.isInteger(abs);
  const grouped = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: hasDecimal ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(abs);
  if (isEnglish) return `৳${grouped}`;
  return `৳${grouped.split('').map(c => BN_DIGITS[c] ?? c).join('')}`;
}

/** Plain number formatter for live-typing display in transaction sheet. */
function fmtNum(s: string, isEnglish: boolean): string {
  if (isEnglish) return s;
  return s.split('').map(c => BN_DIGITS[c] ?? c).join('');
}

/**
 * Brute-force Bengali→English digit replacer.
 * Use as a last-resort on any raw string that might already contain Bengali digits,
 * e.g. from a pre-formatted API value or a stale cached render.
 */
const BN_TO_EN: Record<string, string> = {
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
  '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
};
function forceEnDigits(str: string): string {
  return str.split('').map(c => BN_TO_EN[c] ?? c).join('');
}

function billImageSrc(billImage: string | null | undefined): string | null {
  if (!billImage) return null;
  if (billImage.startsWith('data:')) return billImage;
  if (billImage.startsWith('/objects/')) return `${API_BASE}/api/storage${billImage}`;
  return null;
}

async function uploadBillImage(
  localUri: string,
  getToken: () => Promise<string | null>,
): Promise<string | null> {
  try {
    const res = await fetch(localUri);
    const blob = await res.blob();
    const mimeType = blob.type || 'image/jpeg';
    const token = await getToken();
    const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const metaRes = await fetch(`${API_BASE}/api/storage/uploads/request-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ name: 'bill.jpg', size: blob.size, contentType: mimeType }),
    });
    if (!metaRes.ok) return null;
    const { uploadURL, objectPath } = (await metaRes.json()) as { uploadURL: string; objectPath: string };
    const up = await fetch(uploadURL, { method: 'PUT', body: blob, headers: { 'Content-Type': mimeType } });
    return up.ok ? objectPath : null;
  } catch { return null; }
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

// ─── TransactionSheet ────────────────────────────────────────────────────────

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
  const { currentLanguage } = useLanguage();
  const isEnglish = currentLanguage === 'en';
  const qc = useQueryClient();
  const { getToken } = useAuth();

  const [type, setType] = useState<'YOU_GAVE' | 'YOU_GOT'>(initialType);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [billImageUri, setBillImageUri] = useState<string | null>(null);
  const uploadRef = useRef<Promise<string | null> | null>(null);
  const createEntry = useCreateLedgerEntry();

  useEffect(() => { if (visible) setType(initialType); }, [visible, initialType]);

  function reset() {
    setAmount(''); setDescription(''); setType(initialType);
    setBillImageUri(null); uploadRef.current = null;
  }

  async function pickImage() {
    Alert.alert(
      isEnglish ? 'Attach Bill' : 'বিল সংযুক্ত করুন',
      isEnglish ? 'Choose a source' : 'উৎস বেছে নিন',
      [
        {
          text: isEnglish ? 'Camera' : 'ক্যামেরা',
          onPress: async () => {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (perm.status !== 'granted') {
              Alert.alert(
                isEnglish ? 'Permission required' : 'অনুমতি প্রয়োজন',
                isEnglish ? 'Please allow camera access to take a photo.' : 'ছবি তুলতে ক্যামেরার অনুমতি দিন।',
              );
              return;
            }
            const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
            if (!r.canceled && r.assets[0]) {
              const uri = r.assets[0].uri;
              setBillImageUri(uri);
              uploadRef.current = uploadBillImage(uri, getToken);
            }
          },
        },
        {
          text: isEnglish ? 'Photo Library' : 'ফটো লাইব্রেরি',
          onPress: async () => {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (perm.status !== 'granted') {
              Alert.alert(
                isEnglish ? 'Permission required' : 'অনুমতি প্রয়োজন',
                isEnglish ? 'Please allow access to your photo library.' : 'ফটো লাইব্রেরির অনুমতি দিন।',
              );
              return;
            }
            const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
            if (!r.canceled && r.assets[0]) {
              const uri = r.assets[0].uri;
              setBillImageUri(uri);
              uploadRef.current = uploadBillImage(uri, getToken);
            }
          },
        },
        { text: isEnglish ? 'Cancel' : 'বাতিল', style: 'cancel' },
      ],
    );
  }

  async function handleSubmit() {
    const parsed = parseFloat(amount);
    if (!amount || isNaN(parsed) || parsed <= 0) {
      Alert.alert(
        isEnglish ? 'Invalid amount' : 'ভুল পরিমাণ',
        isEnglish ? 'Please enter a valid amount greater than 0.' : 'শূন্যের বেশি একটি বৈধ পরিমাণ লিখুন।',
      );
      return;
    }
    try {
      const pending = uploadRef.current; uploadRef.current = null;
      const objectPath = pending ? await pending : null;
      await createEntry.mutateAsync({
        partyId,
        data: { type, amount: parsed, description: description.trim() || undefined, billImage: objectPath ?? undefined },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: [`/api/parties/${partyId}/ledger-entries`] });
      qc.invalidateQueries({ queryKey: [`/api/parties/${partyId}`] });
      qc.invalidateQueries({ queryKey: ['/api/dashboard/summary'] });
      qc.invalidateQueries({ queryKey: ['/api/parties'] });
      reset(); onSuccess(); onClose();
    } catch {
      Alert.alert('Error', isEnglish ? 'Could not record transaction. Please try again.' : 'লেনদেন রেকর্ড করা যায়নি। আবার চেষ্টা করুন।');
    }
  }

  const isGave = type === 'YOU_GAVE';

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 44 : 24 },
    handle: { width: 36, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
    title: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.foreground, marginBottom: 16 },
    typeRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
    typeBtn: { flex: 1, paddingVertical: 14, borderRadius: colors.radius, alignItems: 'center', borderWidth: 2 },
    typeBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', marginTop: 4 },
    amountWrapper: { backgroundColor: colors.card, borderRadius: colors.radius, borderWidth: 1.5, borderColor: isGave ? colors.willGet : colors.willGive, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
    currency: { fontSize: 22, fontFamily: 'Inter_700Bold', color: isGave ? colors.willGet : colors.willGive, marginRight: 6 },
    amountInput: { flex: 1, fontSize: 28, fontFamily: 'Inter_700Bold', color: isGave ? colors.willGet : colors.willGive, padding: 0 },
    descInput: { backgroundColor: colors.card, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border, padding: 14, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.foreground, marginBottom: 12 },
    attachRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
    attachBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: colors.radius, borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed' },
    attachBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.mutedForeground },
    thumbWrapper: { position: 'relative' },
    thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: colors.card },
    thumbRemove: { position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.destructive, alignItems: 'center', justifyContent: 'center' },
    submitBtn: { borderRadius: colors.radius, padding: 16, alignItems: 'center' },
    submitText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
    cancelBtn: { padding: 12, alignItems: 'center', marginTop: 6 },
    cancelText: { color: colors.mutedForeground, fontSize: 15, fontFamily: 'Inter_500Medium' },
  });

  // Live title shown while user types amount
  const liveAmt = fmtNum(amount || '0', isEnglish);
  const titleText = isGave
    ? (isEnglish ? `You gave ৳${liveAmt} to ${partyName}` : `আপনি দিয়েছেন ৳${liveAmt} ${partyName}-কে`)
    : (isEnglish ? `You received ৳${liveAmt} from ${partyName}` : `আপনি পেয়েছেন ৳${liveAmt} ${partyName}-এর থেকে`);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title} numberOfLines={2}>{titleText}</Text>

          {/* Type toggle */}
          <View style={s.typeRow}>
            <TouchableOpacity
              style={[s.typeBtn, { backgroundColor: type === 'YOU_GAVE' ? colors.willGetBg : colors.card, borderColor: type === 'YOU_GAVE' ? colors.willGet : colors.border }]}
              onPress={() => setType('YOU_GAVE')} activeOpacity={0.8}
            >
              <Feather name="arrow-up-right" size={18} color={type === 'YOU_GAVE' ? colors.willGet : colors.mutedForeground} />
              <Text style={[s.typeBtnText, { color: type === 'YOU_GAVE' ? colors.willGet : colors.mutedForeground }]}>
                {isEnglish ? 'You Gave' : 'আপনি দিয়েছেন'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.typeBtn, { backgroundColor: type === 'YOU_GOT' ? colors.willGiveBg : colors.card, borderColor: type === 'YOU_GOT' ? colors.willGive : colors.border }]}
              onPress={() => setType('YOU_GOT')} activeOpacity={0.8}
            >
              <Feather name="arrow-down-left" size={18} color={type === 'YOU_GOT' ? colors.willGive : colors.mutedForeground} />
              <Text style={[s.typeBtnText, { color: type === 'YOU_GOT' ? colors.willGive : colors.mutedForeground }]}>
                {isEnglish ? 'You Received' : 'আপনি পেয়েছেন'}
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
            placeholder={isEnglish ? 'Enter details (item, bill no, quantity etc.)' : 'বিস্তারিত লিখুন (পণ্য, বিল নং, পরিমাণ ইত্যাদি)'}
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="done"
          />

          {/* Bill photo */}
          <View style={s.attachRow}>
            {billImageUri ? (
              <View style={s.thumbWrapper}>
                <Image source={{ uri: billImageUri }} style={s.thumb} resizeMode="cover" />
                <TouchableOpacity
                  style={s.thumbRemove}
                  onPress={() => { setBillImageUri(null); uploadRef.current = null; }}
                  hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
                >
                  <Feather name="x" size={11} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : null}
            <TouchableOpacity style={s.attachBtn} onPress={pickImage} activeOpacity={0.7}>
              <Feather name="camera" size={16} color={colors.mutedForeground} />
              <Text style={s.attachBtnText}>
                {billImageUri
                  ? (isEnglish ? 'Change photo' : 'ছবি পরিবর্তন করুন')
                  : (isEnglish ? 'Attach bill photo' : 'বিল ছবি সংযুক্ত করুন')}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[s.submitBtn, { backgroundColor: isGave ? colors.willGet : colors.willGive, opacity: createEntry.isPending ? 0.6 : 1 }]}
            onPress={handleSubmit}
            disabled={createEntry.isPending}
            activeOpacity={0.85}
          >
            <Text style={s.submitText}>
              {createEntry.isPending
                ? (isEnglish ? 'Saving…' : 'সংরক্ষণ হচ্ছে…')
                : (isEnglish ? 'Confirm Entry' : 'এন্ট্রি নিশ্চিত করুন')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.cancelBtn} onPress={() => { reset(); onClose(); }}>
            <Text style={s.cancelText}>{isEnglish ? 'Cancel' : 'বাতিল'}</Text>
          </TouchableOpacity>
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
  const { currentLanguage } = useLanguage();
  const isEnglish = currentLanguage === 'en';
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
        isEnglish ? 'Reminder message' : 'রিমাইন্ডার বার্তা',
        message.trim(),
        [{ text: isEnglish ? 'Close' : 'বন্ধ করুন', style: 'cancel', onPress: onClose }],
      );
    } catch {
      Alert.alert('Error', isEnglish ? 'Could not open SMS. Please try again.' : 'SMS খোলা যায়নি। আবার চেষ্টা করুন।');
    } finally { setSending(false); }
  }

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 44 : 24 },
    handle: { width: 36, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
    title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 4 },
    subtitle: { fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginBottom: 20 },
    msgBox: { backgroundColor: colors.card, borderRadius: colors.radius, borderWidth: 1.5, borderColor: colors.border, padding: 14, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.foreground, minHeight: 120, textAlignVertical: 'top', marginBottom: 20 },
    sendBtn: { borderRadius: colors.radius, padding: 16, alignItems: 'center', backgroundColor: colors.primary, flexDirection: 'row', justifyContent: 'center', gap: 8 },
    sendBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
    cancelBtn: { padding: 12, alignItems: 'center', marginTop: 6 },
    cancelText: { color: colors.mutedForeground, fontSize: 15, fontFamily: 'Inter_500Medium' },
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title}>{isEnglish ? 'Send Reminder' : 'রিমাইন্ডার পাঠান'}</Text>
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
              placeholder={isEnglish ? 'Reminder message…' : 'রিমাইন্ডার বার্তা…'}
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
              {sending ? (isEnglish ? 'Opening…' : 'খুলছে…') : (isEnglish ? 'Send' : 'পাঠান')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
            <Text style={s.cancelText}>{isEnglish ? 'Cancel' : 'বাতিল'}</Text>
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
  isEnglish: boolean;
  onPress?: () => void;
}

function LedgerRow({ entry, colors, isEnglish, onPress }: LedgerRowProps) {
  const { getToken } = useAuth();
  const isGave = entry.type === 'YOU_GAVE';
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const rawSrc = billImageSrc(entry.billImage);
  const [authToken, setAuthToken] = useState<string | null>(null);
  useEffect(() => {
    if (rawSrc && entry.billImage?.startsWith('/objects/')) getToken().then(setAuthToken);
  }, [rawSrc, entry.billImage, getToken]);

  const imgSrc = rawSrc
    ? { uri: rawSrc, ...(authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : {}) }
    : null;

  const entryIsToday = isToday(entry.createdAt);
  const dateLine = entryIsToday
    ? `${formatDate(entry.createdAt)} · ${isEnglish ? 'Today' : 'আজ'} · ${formatTime(entry.createdAt)}`
    : `${formatDate(entry.createdAt)} · ${formatTime(entry.createdAt)}`;

  const descFallback = isGave
    ? (isEnglish ? 'You gave' : 'আপনি দিয়েছেন')
    : (isEnglish ? 'You got' : 'আপনি পেয়েছেন');

  const typeTag = isGave
    ? (isEnglish ? '▲ YOU GAVE' : '▲ আপনি দিয়েছেন')
    : (isEnglish ? '▼ YOU GOT' : '▼ আপনি পেয়েছেন');

  const s = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5, marginRight: 12, backgroundColor: isGave ? colors.willGet : colors.willGive },
    desc: { fontSize: 14, fontFamily: 'Inter_500Medium', color: colors.foreground, flex: 1 },
    meta: { fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 2 },
    tag: { fontSize: 11, fontFamily: 'Inter_600SemiBold', marginTop: 3 },
    amount: { fontSize: 16, fontFamily: 'Inter_700Bold', textAlign: 'right' },
    thumb: { width: 44, height: 44, borderRadius: 6, marginTop: 6, backgroundColor: colors.card },
  });

  return (
    <>
      <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={onPress ? 0.7 : 1}>
        <View style={s.dot} />
        <View style={{ flex: 1 }}>
          <Text style={s.desc} numberOfLines={2}>{entry.description || descFallback}</Text>
          <Text style={s.meta}>{dateLine}</Text>
          <Text style={[s.tag, { color: isGave ? colors.willGet : colors.willGive }]}>{typeTag}</Text>
          {imgSrc ? (
            <TouchableOpacity onPress={() => setLightboxOpen(true)} activeOpacity={0.85}>
              <Image source={imgSrc} style={s.thumb} resizeMode="cover" />
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={[s.amount, { color: isGave ? colors.willGet : colors.willGive }]}>
          {isGave ? '+' : '-'}{fmtCur(entry.amount, isEnglish)}
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
              {isEnglish ? 'Tap to close' : 'বন্ধ করতে চাপুন'}
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
  const { currentLanguage } = useLanguage();
  const isEnglish = currentLanguage === 'en';
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [entry, setEntry] = useState(init);
  const [isEditing, setIsEditing] = useState(false);
  const [editAmount, setEditAmount] = useState(String(init.amount));
  const [editDesc, setEditDesc] = useState(init.description || '');

  useEffect(() => {
    if (visible) {
      setEntry(init); setEditAmount(String(init.amount));
      setEditDesc(init.description || ''); setIsEditing(false);
    }
  }, [visible, init.id]);

  const patch = usePatchLedgerEntry();
  const del = useDeleteLedgerEntry();

  const isGave = entry.type === 'YOU_GAVE';
  const amtColor = isGave ? colors.willGet : colors.willGive;
  const initials = party.name.slice(0, 2).toUpperCase();
  const isBalGet = party.balanceType === 'YOU_WILL_GET';
  const balColor = isBalGet ? colors.willGet : colors.willGive;
  const balSign = isBalGet ? '+' : '-';
  const dateLabel = `${formatDate(entry.createdAt)} • ${formatTime(entry.createdAt)}`;

  async function handleSave() {
    const p = parseFloat(editAmount);
    if (!editAmount || isNaN(p) || p <= 0) {
      Alert.alert(
        isEnglish ? 'Invalid amount' : 'ভুল পরিমাণ',
        isEnglish ? 'Please enter a valid amount > 0.' : 'শূন্যের বেশি একটি বৈধ পরিমাণ লিখুন।',
      );
      return;
    }
    try {
      const updated = await patch.mutateAsync({
        partyId: entry.partyId, entryId: entry.id,
        data: { amount: p, description: editDesc.trim() || undefined },
      });
      setEntry(updated); setEditAmount(String(updated.amount)); setEditDesc(updated.description || '');
      qc.invalidateQueries({ queryKey: [`/api/parties/${entry.partyId}/ledger-entries`] });
      qc.invalidateQueries({ queryKey: [`/api/parties/${entry.partyId}`] });
      qc.invalidateQueries({ queryKey: ['/api/dashboard/summary'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setIsEditing(false); onUpdated(updated);
    } catch {
      Alert.alert('Error', isEnglish ? 'Could not update entry. Please try again.' : 'এন্ট্রি আপডেট করা যায়নি।');
    }
  }

  function handleDelete() {
    Alert.alert(
      isEnglish ? 'Delete Entry' : 'এন্ট্রি মুছুন',
      isEnglish ? 'This entry will be permanently deleted. Are you sure?' : 'এই এন্ট্রিটি স্থায়ীভাবে মুছে যাবে। আপনি কি নিশ্চিত?',
      [
        { text: isEnglish ? 'Cancel' : 'বাতিল', style: 'cancel' },
        {
          text: isEnglish ? 'Delete' : 'মুছুন', style: 'destructive',
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
              Alert.alert('Error', isEnglish ? 'Could not delete entry. Please try again.' : 'এন্ট্রি মুছে ফেলা যায়নি।');
            }
          },
        },
      ],
    );
  }

  async function handleShare() {
    const dir = isGave ? (isEnglish ? 'gave' : 'দিয়েছেন') : (isEnglish ? 'received' : 'পেয়েছেন');
    const youLabel = isEnglish ? 'You' : 'আপনি';
    const balLabel = isEnglish ? 'Balance' : 'ব্যালেন্স';
    const msg = `${youLabel} ${dir}: ${fmtCur(entry.amount, isEnglish)}\n${balLabel}: ${balSign}${fmtCur(party.currentBalance, isEnglish)}\nhttps://banglakhata.com/p/${entry.partyId}`;
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

  const balanceLabel = isGave
    ? (isEnglish ? 'You gave' : 'আপনি দিয়েছেন')
    : (isEnglish ? 'You received' : 'আপনি পেয়েছেন');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="arrow-left" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>
            {isEnglish ? 'Entry Details' : 'বিস্তারিত প্রবেশিকা'}
          </Text>
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
                <Text style={[s.amtBig, { color: amtColor }]}>{fmtCur(Math.abs(entry.amount), isEnglish)}</Text>
                <Text style={s.dirLabel}>{balanceLabel}</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
              <Text style={s.balLabel}>{isEnglish ? 'Current Balance' : 'বর্তমান ব্যালেন্স'}</Text>
              <Text style={[s.balValue, { color: balColor }]}>{fmtCur(Math.abs(party.currentBalance), isEnglish)}</Text>
            </View>

            <TouchableOpacity style={s.editBtn} onPress={() => setIsEditing(true)} activeOpacity={0.7}>
              <Text style={{ fontSize: 15 }}>🖊️</Text>
              <Text style={s.editBtnText}>{isEnglish ? 'Edit Entry' : 'এন্ট্রি এডিট করুন'}</Text>
            </TouchableOpacity>
          </View>

          {/* SMS card */}
          <View style={s.infoCard}>
            <Text style={s.smsHeading}>
              {isEnglish ? '📋 SMS Not Sent' : '📋 SMS পাঠানো হয়নি'}
            </Text>
            <Text style={s.smsBody}>
              {isEnglish
                ? `You ${isGave ? 'gave' : 'received'}: ${fmtCur(Math.abs(entry.amount), true)}\nBalance: ${fmtCur(Math.abs(party.currentBalance), true)}\n`
                : `আপনি ${isGave ? 'দিয়েছেন' : 'পেয়েছেন'}: ${fmtCur(Math.abs(entry.amount), false)}\nব্যালেন্স: ${fmtCur(Math.abs(party.currentBalance), false)}\n`}
              <Text style={s.smsLink} onPress={() => Linking.openURL(`https://banglakhata.com/p/${entry.partyId}`)}>
                {`https://banglakhata.com/p/${entry.partyId}`}
              </Text>
            </Text>
          </View>

          {/* Backup card */}
          <View style={s.infoCard}>
            <Text style={s.backupText}>
              {isEnglish ? '☁️ Entry backed up' : '☁️ এন্ট্রি ব্যাক আপ করা হয়েছে'}
            </Text>
          </View>

          {/* Security badge */}
          <View style={s.secBadge}>
            <Text style={s.secText}>
              {isEnglish ? '✔️ 100% Safe & Secure' : '✔️ 100% নিরাপদ ও সুরক্ষিত'}
            </Text>
          </View>
        </ScrollView>

        {/* Bottom bar */}
        <View style={s.bottomBar}>
          <TouchableOpacity style={s.deleteBtn} onPress={handleDelete} disabled={del.isPending} activeOpacity={0.8}>
            <Text style={{ fontSize: 16 }}>🗑️</Text>
            <Text style={s.deleteBtnText}>{isEnglish ? 'Delete' : 'মুছে ফেলুন'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.shareBtn} onPress={handleShare} activeOpacity={0.8}>
            <Text style={{ fontSize: 16 }}>📬</Text>
            <Text style={s.shareBtnText}>{isEnglish ? 'Share' : 'শেয়ার করুন'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Edit modal */}
      <Modal visible={isEditing} transparent animationType="fade" onRequestClose={() => setIsEditing(false)}>
        <KeyboardAvoidingView style={s.editOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.editCard}>
            <Text style={s.editTitle}>
              {isEnglish ? 'Edit Entry (Re-entry)' : 'এন্ট্রি সংশোধন (Re-entry)'}
            </Text>
            <Text style={s.editLabel}>{isEnglish ? 'Amount (৳)' : 'টাকার পরিমাণ (৳)'}</Text>
            <TextInput
              style={s.editInput}
              value={editAmount}
              onChangeText={setEditAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor="#CBD5E1"
              autoFocus
            />
            <Text style={s.editLabel}>{isEnglish ? 'Description / Details' : 'বিবরণ / ডিটেলস'}</Text>
            <TextInput
              style={s.editInput}
              value={editDesc}
              onChangeText={setEditDesc}
              placeholder={isEnglish ? 'Note (optional)' : 'নোট (ঐচ্ছিক)'}
              placeholderTextColor="#CBD5E1"
              returnKeyType="done"
            />
            <View style={s.editActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setIsEditing(false)}>
                <Text style={s.cancelBtnText}>{isEnglish ? 'Cancel' : 'বাতিল'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveBtn, { opacity: patch.isPending ? 0.6 : 1 }]}
                onPress={handleSave}
                disabled={patch.isPending}
              >
                <Text style={s.saveBtnText}>
                  {patch.isPending ? (isEnglish ? 'Saving…' : 'সংরক্ষণ হচ্ছে…') : (isEnglish ? 'Save' : 'সংরক্ষণ করুন')}
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

  // Derive isEnglish directly from the raw currentLanguage string — no memoized boolean
  const { currentLanguage } = useLanguage();
  const isEnglish = currentLanguage === 'en';

  const [showSheet, setShowSheet] = useState(false);
  const [pendingType, setPendingType] = useState<'YOU_GAVE' | 'YOU_GOT'>('YOU_GAVE');
  const [showReminderSheet, setShowReminderSheet] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<LedgerEntry | null>(null);

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
          {isEnglish ? 'Party not found' : 'পার্টি পাওয়া যায়নি'}
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: colors.primary, fontFamily: 'Inter_500Medium' }}>
            {isEnglish ? 'Go back' : 'পেছনে যান'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const initials = party.name.slice(0, 2).toUpperCase();
  const roleLabel = party.role === 'CUSTOMER'
    ? (isEnglish ? 'Customer' : 'গ্রাহক')
    : (isEnglish ? 'Supplier' : 'সরবরাহকারী');

  const quickActions = [
    { icon: 'file-text' as const,      label: isEnglish ? 'Report'   : 'রিপোর্ট',    onPress: () => {} },
    { icon: 'bell' as const,           label: isEnglish ? 'Reminder' : 'রিমাইন্ডার', onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowReminderSheet(true); } },
    { icon: 'message-square' as const, label: isEnglish ? 'SMS'      : 'এসএমএস',     onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowReminderSheet(true); } },
    { icon: 'edit-3' as const,         label: isEnglish ? 'Entry'    : 'এন্ট্রি',     onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setPendingType('YOU_GAVE'); setShowSheet(true); } },
  ];

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Feather name="chevron-left" size={18} color="rgba(255,255,255,0.8)" />
          <Text style={s.backText}>{isEnglish ? 'Back' : 'পেছনে'}</Text>
        </TouchableOpacity>
        <View style={s.partyAv}><Text style={s.partyAvText}>{initials}</Text></View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={s.partyName}>{party.name}</Text>
          {/* ── DIAGNOSTIC BADGE: flip confirms context is live ── */}
          <Text style={{
            fontSize: 9, fontFamily: 'Inter_700Bold', paddingHorizontal: 5, paddingVertical: 2,
            borderRadius: 4, overflow: 'hidden',
            backgroundColor: isEnglish ? '#16a34a' : '#dc2626',
            color: '#fff',
          }}>
            {isEnglish ? 'ENG_ACTIVE' : 'BN_ACTIVE'}
          </Text>
        </View>
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
            <Text style={s.balLabelText}>
              {isEnglish ? 'CURRENT BALANCE' : 'বর্তমান ব্যালেন্স'}
            </Text>
            <Text style={[s.balAmount, { color: isGet ? colors.willGet : colors.willGive }]}>
              {fmtCur(party.currentBalance, isEnglish)}
            </Text>
            <Text style={[s.balType, { color: isGet ? colors.willGet : colors.willGive }]}>
              {isGet
                ? (isEnglish ? '↑ You Will Get' : '↑ আপনি পাবেন')
                : (isEnglish ? '↓ You Will Give' : '↓ আপনি দেবেন')}
            </Text>
          </View>
          {party.dueDate ? (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
                {isEnglish ? 'Due date' : 'বকেয়ার তারিখ'}
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
            <Text style={[s.actionBtnText, { color: colors.willGet }]}>
              {isEnglish ? 'You Gave' : 'আপনি দিয়েছেন'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.actionBtn, { backgroundColor: colors.willGiveBg }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setPendingType('YOU_GOT'); setShowSheet(true); }}
            activeOpacity={0.8}
          >
            <Feather name="arrow-down-left" size={18} color={colors.willGive} />
            <Text style={[s.actionBtnText, { color: colors.willGive }]}>
              {isEnglish ? 'You Received' : 'আপনি পেয়েছেন'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Quick-action row: Report · Reminder · SMS · Entry */}
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
            {isEnglish ? 'TRANSACTION HISTORY' : 'লেনদেনের ইতিহাস'} ({entries.length})
          </Text>
        </View>

        {entriesLoading ? (
          <View style={{ padding: 32, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View>
        ) : entries.length === 0 ? (
          <View style={s.emptyContainer}>
            <Feather name="file-text" size={36} color={colors.border} />
            <Text style={s.emptyText}>
              {isEnglish ? 'No transactions yet' : 'এখনো কোনো লেনদেন নেই'}
            </Text>
          </View>
        ) : (
          entries.map(entry => (
            <LedgerRow
              key={entry.id}
              entry={entry}
              colors={colors}
              isEnglish={isEnglish}
              onPress={() => setSelectedEntry(entry)}
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
        onClose={() => setShowSheet(false)}
        onSuccess={() => { refetchParty(); refetchEntries(); }}
      />

      <ReminderSheet
        visible={showReminderSheet}
        partyId={id!}
        partyName={party.name}
        partyPhone={party.phone ?? ''}
        onClose={() => setShowReminderSheet(false)}
      />

      {selectedEntry && (
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
