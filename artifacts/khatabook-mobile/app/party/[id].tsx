import React, { useState, useCallback, useEffect, useRef } from 'react';
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

// ---------------------------------------------------------------------------
// Bill image helpers
// ---------------------------------------------------------------------------

const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : '';

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
    const fetchRes = await fetch(localUri);
    const blob = await fetchRes.blob();
    const mimeType = blob.type || 'image/jpeg';
    const token = await getToken();
    const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const metaRes = await fetch(`${API_BASE}/api/storage/uploads/request-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ name: 'bill.jpg', size: blob.size, contentType: mimeType }),
    });
    if (!metaRes.ok) return null;
    const { uploadURL, objectPath } = (await metaRes.json()) as { uploadURL: string; objectPath: string };
    const uploadRes = await fetch(uploadURL, { method: 'PUT', body: blob, headers: { 'Content-Type': mimeType } });
    if (!uploadRes.ok) return null;
    return objectPath;
  } catch {
    return null;
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// TransactionSheet
// ---------------------------------------------------------------------------

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
  const { isEnglish, t, formatNumber } = useLanguage();
  const qc = useQueryClient();
  const { getToken } = useAuth();
  const [type, setType] = useState<'YOU_GAVE' | 'YOU_GOT'>(initialType);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [billImageUri, setBillImageUri] = useState<string | null>(null);
  const uploadPromiseRef = useRef<Promise<string | null> | null>(null);
  const createEntry = useCreateLedgerEntry();

  useEffect(() => {
    if (visible) setType(initialType);
  }, [visible, initialType]);

  function reset() {
    setAmount('');
    setDescription('');
    setType(initialType);
    setBillImageUri(null);
    uploadPromiseRef.current = null;
  }

  async function pickImage() {
    Alert.alert(
      t('attachBill'),
      isEnglish ? 'Choose a source' : 'উৎস বেছে নিন',
      [
        {
          text: t('camera'),
          onPress: async () => {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (perm.status !== 'granted') {
              Alert.alert(
                isEnglish ? 'Permission required' : 'অনুমতি প্রয়োজন',
                isEnglish ? 'Please allow camera access to take a photo.' : 'ছবি তুলতে ক্যামেরার অনুমতি দিন।',
              );
              return;
            }
            const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
            if (!result.canceled && result.assets[0]) {
              const uri = result.assets[0].uri;
              setBillImageUri(uri);
              uploadPromiseRef.current = uploadBillImage(uri, getToken);
            }
          },
        },
        {
          text: t('photoLibrary'),
          onPress: async () => {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (perm.status !== 'granted') {
              Alert.alert(
                isEnglish ? 'Permission required' : 'অনুমতি প্রয়োজন',
                isEnglish ? 'Please allow access to your photo library.' : 'ফটো লাইব্রেরির অনুমতি দিন।',
              );
              return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
            if (!result.canceled && result.assets[0]) {
              const uri = result.assets[0].uri;
              setBillImageUri(uri);
              uploadPromiseRef.current = uploadBillImage(uri, getToken);
            }
          },
        },
        { text: t('cancel'), style: 'cancel' },
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
      const pendingUpload = uploadPromiseRef.current;
      uploadPromiseRef.current = null;
      const objectPath = pendingUpload ? await pendingUpload : null;
      await createEntry.mutateAsync({
        partyId,
        data: { type, amount: parsed, description: description.trim() || undefined, billImage: objectPath ?? undefined },
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
      Alert.alert('Error', isEnglish ? 'Could not record transaction. Please try again.' : 'লেনদেন রেকর্ড করা যায়নি। আবার চেষ্টা করুন।');
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
    handle: { width: 36, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
    title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 4 },
    subtitle: { fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginBottom: 20 },
    typeRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
    typeBtn: { flex: 1, paddingVertical: 14, borderRadius: colors.radius, alignItems: 'center', borderWidth: 2 },
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
    currency: { fontSize: 22, fontFamily: 'Inter_700Bold', color: isGave ? colors.willGet : colors.willGive, marginRight: 6 },
    amountInput: { flex: 1, fontSize: 28, fontFamily: 'Inter_700Bold', color: isGave ? colors.willGet : colors.willGive, padding: 0 },
    descInput: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.foreground,
      marginBottom: 12,
    },
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title} numberOfLines={2}>
            {type === 'YOU_GAVE'
              ? (isEnglish
                  ? `You gave ৳${amount || '0'} to ${partyName}`
                  : `আপনি দিয়েছেন ৳${formatNumber(parseFloat(amount) || 0)} ${partyName}-কে`)
              : (isEnglish
                  ? `You received ৳${amount || '0'} from ${partyName}`
                  : `আপনি পেয়েছেন ৳${formatNumber(parseFloat(amount) || 0)} ${partyName}-এর থেকে`)}
          </Text>

          {/* Type toggle */}
          <View style={s.typeRow}>
            <TouchableOpacity
              style={[s.typeBtn, { backgroundColor: type === 'YOU_GAVE' ? colors.willGetBg : colors.card, borderColor: type === 'YOU_GAVE' ? colors.willGet : colors.border }]}
              onPress={() => setType('YOU_GAVE')}
              activeOpacity={0.8}
            >
              <Feather name="arrow-up-right" size={18} color={type === 'YOU_GAVE' ? colors.willGet : colors.mutedForeground} />
              <Text style={[s.typeBtnText, { color: type === 'YOU_GAVE' ? colors.willGet : colors.mutedForeground, marginTop: 4 }]}>
                {t('youGave')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.typeBtn, { backgroundColor: type === 'YOU_GOT' ? colors.willGiveBg : colors.card, borderColor: type === 'YOU_GOT' ? colors.willGive : colors.border }]}
              onPress={() => setType('YOU_GOT')}
              activeOpacity={0.8}
            >
              <Feather name="arrow-down-left" size={18} color={type === 'YOU_GOT' ? colors.willGive : colors.mutedForeground} />
              <Text style={[s.typeBtnText, { color: type === 'YOU_GOT' ? colors.willGive : colors.mutedForeground, marginTop: 4 }]}>
                {t('youReceived')}
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
            placeholder={t('placeholderDetails')}
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
                  onPress={() => { setBillImageUri(null); uploadPromiseRef.current = null; }}
                  hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
                >
                  <Feather name="x" size={11} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : null}
            <TouchableOpacity style={s.attachBtn} onPress={pickImage} activeOpacity={0.7}>
              <Feather name="camera" size={16} color={colors.mutedForeground} />
              <Text style={s.attachBtnText}>
                {billImageUri ? t('changePhoto') : t('attachBillPhoto')}
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
              {createEntry.isPending ? t('saving') : t('confirmEntry')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.cancelBtn} onPress={() => { reset(); onClose(); }}>
            <Text style={s.cancelText}>{t('cancel')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// ReminderSheet
// ---------------------------------------------------------------------------

interface ReminderSheetProps {
  visible: boolean;
  partyId: string;
  partyName: string;
  partyPhone: string;
  onClose: () => void;
}

function ReminderSheet({ visible, partyId, partyName, partyPhone, onClose }: ReminderSheetProps) {
  const colors = useColors();
  const { isEnglish, t } = useLanguage();
  const sendReminder = useSendPaymentReminder();
  const [message, setMessage] = useState('');
  const [fetching, setFetching] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setMessage('');
    setFetching(true);
    sendReminder.mutateAsync({ partyId })
      .then((res) => setMessage(res.message))
      .catch(() => setMessage(''))
      .finally(() => setFetching(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, partyId]);

  async function handleSend() {
    if (!message.trim()) return;
    setSending(true);
    try {
      if (partyPhone) {
        const encoded = encodeURIComponent(message.trim());
        const smsUrl = Platform.OS === 'ios'
          ? `sms:${partyPhone}&body=${encoded}`
          : `sms:${partyPhone}?body=${encoded}`;
        const supported = await Linking.canOpenURL(smsUrl);
        if (supported) {
          await Linking.openURL(smsUrl);
          onClose();
          return;
        }
      }
      Alert.alert(
        isEnglish ? 'Reminder message' : 'রিমাইন্ডার বার্তা',
        message.trim(),
        [{ text: isEnglish ? 'Close' : 'বন্ধ করুন', style: 'cancel', onPress: onClose }],
      );
    } catch {
      Alert.alert('Error', isEnglish ? 'Could not open SMS. Please try again.' : 'SMS খোলা যায়নি। আবার চেষ্টা করুন।');
    } finally {
      setSending(false);
    }
  }

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
    handle: { width: 36, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
    title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 4 },
    subtitle: { fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginBottom: 20 },
    messageBox: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1.5,
      borderColor: colors.border,
      padding: 14,
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.foreground,
      minHeight: 120,
      textAlignVertical: 'top',
      marginBottom: 20,
    },
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
          <Text style={s.title}>{t('sendReminderBtn')}</Text>
          <Text style={s.subtitle}>{partyName}</Text>

          {fetching ? (
            <View style={{ height: 120, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <TextInput
              style={s.messageBox}
              value={message}
              onChangeText={setMessage}
              multiline
              placeholder={t('reminderMsgPlaceholder')}
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
            <Text style={s.sendBtnText}>{sending ? t('sendingOpen') : t('send')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
            <Text style={s.cancelText}>{t('cancel')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// LedgerRow
// ---------------------------------------------------------------------------

interface LedgerRowProps {
  entry: LedgerEntry;
  colors: ReturnType<typeof useColors>;
  isEnglish: boolean;
  onPress?: () => void;
}

function LedgerRow({ entry, colors, isEnglish, onPress }: LedgerRowProps) {
  const { getToken } = useAuth();
  const { formatCurrency } = useLanguage();
  const isGave = entry.type === 'YOU_GAVE';
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const rawSrc = billImageSrc(entry.billImage);
  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    if (rawSrc && entry.billImage?.startsWith('/objects/')) {
      getToken().then(setAuthToken);
    }
  }, [rawSrc, entry.billImage, getToken]);

  const imageSource = rawSrc
    ? { uri: rawSrc, ...(authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : {}) }
    : null;

  const s = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5, marginRight: 12, backgroundColor: isGave ? colors.willGet : colors.willGive },
    desc: { fontSize: 14, fontFamily: 'Inter_500Medium', color: colors.foreground, flex: 1 },
    meta: { fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 2 },
    type: { fontSize: 11, fontFamily: 'Inter_600SemiBold', marginTop: 3 },
    amount: { fontSize: 16, fontFamily: 'Inter_700Bold', textAlign: 'right' },
    billThumb: { width: 44, height: 44, borderRadius: 6, marginTop: 6, backgroundColor: colors.card },
  });

  const descFallback = isGave
    ? (isEnglish ? 'You gave' : 'আপনি দিয়েছেন')
    : (isEnglish ? 'You got' : 'আপনি পেয়েছেন');
  const typeLabel = isGave
    ? (isEnglish ? '▲ YOU GAVE' : '▲ আপনি দিয়েছেন')
    : (isEnglish ? '▼ YOU GOT' : '▼ আপনি পেয়েছেন');

  return (
    <>
      <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={onPress ? 0.7 : 1}>
        <View style={s.dot} />
        <View style={{ flex: 1 }}>
          <Text style={s.desc} numberOfLines={2}>
            {entry.description || descFallback}
          </Text>
          <Text style={s.meta}>{formatDate(entry.createdAt)} · {formatTime(entry.createdAt)}</Text>
          <Text style={[s.type, { color: isGave ? colors.willGet : colors.willGive }]}>
            {typeLabel}
          </Text>
          {imageSource ? (
            <TouchableOpacity onPress={() => setLightboxOpen(true)} activeOpacity={0.85}>
              <Image source={imageSource} style={s.billThumb} resizeMode="cover" />
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={[s.amount, { color: isGave ? colors.willGet : colors.willGive }]}>
          {isGave ? '+' : '-'}{formatCurrency(entry.amount)}
        </Text>
      </TouchableOpacity>

      {imageSource ? (
        <Modal visible={lightboxOpen} transparent animationType="fade" onRequestClose={() => setLightboxOpen(false)}>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' }}
            activeOpacity={1}
            onPress={() => setLightboxOpen(false)}
          >
            <Image source={imageSource} style={{ width: '92%', height: '70%' }} resizeMode="contain" />
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 16 }}>
              {isEnglish ? 'Tap to close' : 'বন্ধ করতে চাপুন'}
            </Text>
          </TouchableOpacity>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// EntryDetailSheet
// ---------------------------------------------------------------------------

interface EntryDetailSheetProps {
  entry: LedgerEntry;
  party: Party;
  visible: boolean;
  onClose: () => void;
  onDeleted: () => void;
  onUpdated: (updated: LedgerEntry) => void;
}

function EntryDetailSheet({ entry: initialEntry, party, visible, onClose, onDeleted, onUpdated }: EntryDetailSheetProps) {
  const colors = useColors();
  const { isEnglish, t, formatCurrency } = useLanguage();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [entry, setEntry] = useState(initialEntry);
  const [isEditing, setIsEditing] = useState(false);
  const [editAmount, setEditAmount] = useState(String(initialEntry.amount));
  const [editDesc, setEditDesc] = useState(initialEntry.description || '');

  useEffect(() => {
    if (visible) {
      setEntry(initialEntry);
      setEditAmount(String(initialEntry.amount));
      setEditDesc(initialEntry.description || '');
      setIsEditing(false);
    }
  }, [visible, initialEntry.id]);

  const patchEntry  = usePatchLedgerEntry();
  const deleteEntry = useDeleteLedgerEntry();

  const isGave   = entry.type === 'YOU_GAVE';
  const amtColor = isGave ? colors.willGet : colors.willGive;
  const initials = party.name.slice(0, 2).toUpperCase();
  const isBalGet = party.balanceType === 'YOU_WILL_GET';
  const balColor = isBalGet ? colors.willGet : colors.willGive;
  const balSign  = isBalGet ? '+' : '-';
  const dateLabel = `${formatDate(entry.createdAt)} • ${formatTime(entry.createdAt)}`;

  async function handleSave() {
    const parsed = parseFloat(editAmount);
    if (!editAmount || isNaN(parsed) || parsed <= 0) {
      Alert.alert(isEnglish ? 'Invalid amount' : 'ভুল পরিমাণ', isEnglish ? 'Please enter a valid amount > 0.' : 'শূন্যের বেশি একটি বৈধ পরিমাণ লিখুন।');
      return;
    }
    try {
      const updated = await patchEntry.mutateAsync({
        partyId: entry.partyId,
        entryId: entry.id,
        data: { amount: parsed, description: editDesc.trim() || undefined },
      });
      setEntry(updated);
      setEditAmount(String(updated.amount));
      setEditDesc(updated.description || '');
      qc.invalidateQueries({ queryKey: [`/api/parties/${entry.partyId}/ledger-entries`] });
      qc.invalidateQueries({ queryKey: [`/api/parties/${entry.partyId}`] });
      qc.invalidateQueries({ queryKey: ['/api/dashboard/summary'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setIsEditing(false);
      onUpdated(updated);
    } catch {
      Alert.alert('Error', isEnglish ? 'Could not update entry. Please try again.' : 'এন্ট্রি আপডেট করা যায়নি।');
    }
  }

  function handleDelete() {
    Alert.alert(
      t('deleteEntryTitle'),
      t('deleteEntryMsg'),
      [
        { text: t('cancelAlert'), style: 'cancel' },
        {
          text: t('deleteAlert'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteEntry.mutateAsync({ partyId: entry.partyId, entryId: entry.id });
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
    const dirLabel = isGave ? t('shareGave') : t('shareGot');
    const balStr   = `${balSign}(৳ ${party.currentBalance.toFixed(0)})`;
    const youLabel = isEnglish ? 'You' : 'আপনি';
    const balLabel = isEnglish ? 'Balance' : 'ব্যালেন্স';
    const msg = `${youLabel} ${dirLabel}: ৳ ${entry.amount}\n${balLabel}: ${balStr}\nhttps://banglakhata.com/p/${entry.partyId}`;
    try { await Share.share({ message: msg }); } catch { /* ignore */ }
  }

  const s = StyleSheet.create({
    overlay:   { flex: 1, backgroundColor: '#F4F6F9' },
    header: { paddingTop: Platform.OS === 'web' ? 16 : insets.top + 8, paddingBottom: 16, paddingHorizontal: 20, backgroundColor: '#004B93', flexDirection: 'row', alignItems: 'center', gap: 20 },
    headerTitle: { flex: 1, fontSize: 18, fontFamily: 'Inter_700Bold', color: '#fff' },
    body:      { flex: 1 },
    card: { backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', marginHorizontal: 16, marginTop: 16, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.06, shadowOffset: { width: 0, height: 2 }, shadowRadius: 6, elevation: 3, padding: 0 },
    initials: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#3B82F6', alignItems: 'center', justifyContent: 'center' },
    initialsText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 16 },
    partyName:  { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#1E293B' },
    dateText:   { fontSize: 12, color: '#64748B', fontFamily: 'Inter_400Regular', marginTop: 2 },
    amountBig:  { fontSize: 22, fontFamily: 'Inter_700Bold', textAlign: 'right' },
    dirLabel:   { fontSize: 12, color: '#64748B', fontFamily: 'Inter_400Regular', textAlign: 'right', marginTop: 2 },
    balLabel:   { fontSize: 14, color: '#475569', fontFamily: 'Inter_500Medium' },
    balValue:   { fontSize: 16, fontFamily: 'Inter_700Bold' },
    editBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
    editBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#004B93' },
    infoCard: { backgroundColor: '#fff', borderRadius: 8, marginHorizontal: 16, marginTop: 12, padding: 16, borderWidth: 1, borderColor: '#E2E8F0' },
    smsHeading: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#B91C1C', marginBottom: 8 },
    smsBody:    { fontSize: 13, color: '#475569', fontFamily: 'Inter_400Regular', lineHeight: 20 },
    smsLink:    { color: '#004B93', fontFamily: 'Inter_500Medium' },
    backupText: { fontSize: 13, color: '#64748B', fontFamily: 'Inter_400Regular' },
    secBadge:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 20, marginBottom: 8 },
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

  const balanceLabel = isGave ? t('balGave') : t('balGot');
  const smsBody = isEnglish
    ? `You ${isGave ? 'gave' : 'received'}: ৳ ${entry.amount}\nBalance: ${balSign}(৳ ${party.currentBalance.toFixed(0)})\nhttps://banglakhata.com/p/${entry.partyId}`
    : `আপনি ${isGave ? 'দিয়েছেন' : 'পেয়েছেন'}: ৳ ${entry.amount}\nব্যালেন্স: ${balSign}(৳ ${party.currentBalance.toFixed(0)})\nhttps://banglakhata.com/p/${entry.partyId}`;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="arrow-left" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{t('entryDetails')}</Text>
        </View>

        <ScrollView style={s.body} contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          {/* Transaction summary card */}
          <View style={s.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 }}>
                <View style={s.initials}><Text style={s.initialsText}>{initials}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.partyName} numberOfLines={1}>{party.name}</Text>
                  <Text style={s.dateText}>{dateLabel}</Text>
                </View>
              </View>
              <View style={{ marginLeft: 12, alignItems: 'flex-end' }}>
                <Text style={[s.amountBig, { color: amtColor }]}>{formatCurrency(Math.abs(entry.amount))}</Text>
                <Text style={s.dirLabel}>{balanceLabel}</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', backgroundColor: '#fff' }}>
              <Text style={s.balLabel}>{t('currentBalance')}</Text>
              <Text style={[s.balValue, { color: balColor }]}>৳ {Math.abs(party.currentBalance)}</Text>
            </View>

            <TouchableOpacity style={s.editBtn} onPress={() => setIsEditing(true)} activeOpacity={0.7}>
              <Text style={{ fontSize: 15 }}>🖊️</Text>
              <Text style={s.editBtnText}>{t('editEntry')}</Text>
            </TouchableOpacity>
          </View>

          {/* SMS card */}
          <View style={s.infoCard}>
            <Text style={s.smsHeading}>{t('smsNotSent')}</Text>
            <Text style={s.smsBody}>
              {isEnglish
                ? `You ${isGave ? 'gave' : 'received'}: ৳ ${Math.abs(entry.amount)}\nBalance: -(৳ ${Math.abs(party.currentBalance)})\n`
                : `আপনি ${isGave ? 'দিয়েছেন' : 'পেয়েছেন'}: ৳ ${Math.abs(entry.amount)}\nব্যালেন্স: -(৳ ${Math.abs(party.currentBalance)})\n`}
              <Text style={s.smsLink} onPress={() => Linking.openURL(`https://banglakhata.com/p/${entry.partyId}`)}>
                {`https://banglakhata.com/p/${entry.partyId}`}
              </Text>
            </Text>
          </View>

          {/* Backup card */}
          <View style={s.infoCard}>
            <Text style={s.backupText}>{t('entryBackedUp')}</Text>
          </View>

          {/* Security badge */}
          <View style={s.secBadge}>
            <Text style={s.secText}>{t('secureLabel')}</Text>
          </View>
        </ScrollView>

        {/* Bottom action bar */}
        <View style={s.bottomBar}>
          <TouchableOpacity style={s.deleteBtn} onPress={handleDelete} disabled={deleteEntry.isPending} activeOpacity={0.8}>
            <Text style={{ fontSize: 16 }}>🗑️</Text>
            <Text style={s.deleteBtnText}>{t('deleteEntryBtn')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.shareBtn} onPress={handleShare} activeOpacity={0.8}>
            <Text style={{ fontSize: 16 }}>📬</Text>
            <Text style={s.shareBtnText}>{t('shareEntryBtn')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Edit overlay */}
      <Modal visible={isEditing} transparent animationType="fade" onRequestClose={() => setIsEditing(false)}>
        <KeyboardAvoidingView style={s.editOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.editCard}>
            <Text style={s.editTitle}>{t('reentry')}</Text>

            <Text style={s.editLabel}>{t('amountLabel')}</Text>
            <TextInput
              style={s.editInput}
              value={editAmount}
              onChangeText={setEditAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor="#CBD5E1"
              autoFocus
            />

            <Text style={s.editLabel}>{t('descLabel')}</Text>
            <TextInput
              style={s.editInput}
              value={editDesc}
              onChangeText={setEditDesc}
              placeholder={t('notePlaceholder')}
              placeholderTextColor="#CBD5E1"
              returnKeyType="done"
            />

            <View style={s.editActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setIsEditing(false)}>
                <Text style={s.cancelBtnText}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveBtn, { opacity: patchEntry.isPending ? 0.6 : 1 }]}
                onPress={handleSave}
                disabled={patchEntry.isPending}
              >
                <Text style={s.saveBtnText}>{patchEntry.isPending ? t('saving') : t('save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// PartyDetailScreen
// ---------------------------------------------------------------------------

export default function PartyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isEnglish, t, formatCurrency } = useLanguage();
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
    partyInitials: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
    partyInitialsText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 20 },
    partyName: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#fff' },
    partyPhone: { fontSize: 13, color: 'rgba(255,255,255,0.65)', fontFamily: 'Inter_400Regular', marginTop: 2 },
    balanceCard: { backgroundColor: colors.card, marginHorizontal: 16, marginTop: -1, borderRadius: colors.radius, padding: 20, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.06, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 3 },
    balanceLeft: { flex: 1 },
    balanceLabel: { fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 4 },
    balanceAmount: { fontSize: 32, fontFamily: 'Inter_700Bold' },
    balanceType: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginTop: 4 },
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
          {t('partyNotFound')}
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: colors.primary, fontFamily: 'Inter_500Medium' }}>{t('goBack')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const initials = party.name.slice(0, 2).toUpperCase();
  const roleLabel = party.role === 'CUSTOMER' ? t('customer') : t('supplier');

  return (
    <View style={s.container}>
      {/* Party header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Feather name="chevron-left" size={18} color="rgba(255,255,255,0.8)" />
          <Text style={s.backText}>{t('back')}</Text>
        </TouchableOpacity>
        <View style={s.partyInitials}>
          <Text style={s.partyInitialsText}>{initials}</Text>
        </View>
        <Text style={s.partyName}>{party.name}</Text>
        {party.phone ? <Text style={s.partyPhone}>{party.phone}</Text> : null}
        <Text style={[s.partyPhone, { marginTop: 4 }]}>{roleLabel}</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
      >
        {/* Balance card */}
        <View style={s.balanceCard}>
          <View style={s.balanceLeft}>
            <Text style={s.balanceLabel}>{t('currentBalanceLabel')}</Text>
            <Text style={[s.balanceAmount, { color: isGet ? colors.willGet : colors.willGive }]}>
              {formatCurrency(party.currentBalance)}
            </Text>
            <Text style={[s.balanceType, { color: isGet ? colors.willGet : colors.willGive }]}>
              {isGet ? t('youWillGetArrow') : t('youWillGiveArrow')}
            </Text>
          </View>
          {party.dueDate && (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>{t('dueDate')}</Text>
              <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginTop: 2 }}>
                {party.dueDate}
              </Text>
            </View>
          )}
        </View>

        {/* Primary action buttons: You Gave / You Received */}
        <View style={s.actionRow}>
          <TouchableOpacity
            style={[s.actionBtn, { backgroundColor: colors.willGetBg }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setPendingType('YOU_GAVE'); setShowSheet(true); }}
            activeOpacity={0.8}
          >
            <Feather name="arrow-up-right" size={18} color={colors.willGet} />
            <Text style={[s.actionBtnText, { color: colors.willGet }]}>{t('youGave')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.actionBtn, { backgroundColor: colors.willGiveBg }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setPendingType('YOU_GOT'); setShowSheet(true); }}
            activeOpacity={0.8}
          >
            <Feather name="arrow-down-left" size={18} color={colors.willGive} />
            <Text style={[s.actionBtnText, { color: colors.willGive }]}>{t('youReceived')}</Text>
          </TouchableOpacity>
        </View>

        {/* Quick-action row: Report · Reminder · SMS · Entry */}
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 4 }}>
          {[
            { key: 'report' as const,   icon: 'file-text' as const },
            { key: 'reminder' as const, icon: 'bell'      as const },
            { key: 'sms'      as const, icon: 'message-square' as const },
            { key: 'entry'    as const, icon: 'edit-3'   as const },
          ].map(({ key, icon }) => (
            <TouchableOpacity
              key={key}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: colors.radius,
                alignItems: 'center',
                gap: 4,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
              }}
              onPress={() => {
                if (key === 'reminder' || key === 'sms') {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowReminderSheet(true);
                } else if (key === 'entry') {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setPendingType('YOU_GAVE');
                  setShowSheet(true);
                }
              }}
              activeOpacity={0.75}
            >
              <Feather name={icon} size={16} color={colors.primary} />
              <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.primary }}>
                {t(key)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Transaction history header */}
        <View style={s.entriesHeader}>
          <Text style={s.entriesTitle}>
            {t('transactionHistory')} ({entries.length})
          </Text>
        </View>

        {entriesLoading ? (
          <View style={{ padding: 32, alignItems: 'center' }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : entries.length === 0 ? (
          <View style={s.emptyContainer}>
            <Feather name="file-text" size={36} color={colors.border} />
            <Text style={s.emptyText}>{t('noTransactionsYet')}</Text>
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

      {selectedEntry && party && (
        <EntryDetailSheet
          entry={selectedEntry}
          party={party}
          visible={!!selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onDeleted={() => { setSelectedEntry(null); refetchParty(); refetchEntries(); }}
          onUpdated={(updated) => { setSelectedEntry(updated); refetchParty(); refetchEntries(); }}
        />
      )}
    </View>
  );
}
