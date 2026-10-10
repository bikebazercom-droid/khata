import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Image, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getGetDashboardSummaryQueryKey,
  getGetPartyQueryKey,
  getListAdjustmentTargetsQueryKey,
  getListGlobalLedgerEntriesQueryKey,
  getListLedgerEntriesQueryKey,
  getListPartiesQueryKey,
  useCreateLedgerEntry,
  useDeleteLedgerEntry,
  useListAdjustmentTargets,
  useListParties,
  usePatchLedgerEntry,
  useRequestUploadUrl,
} from '@workspace/api-client-react';
import { AppButton, BillPhoto, Card, Field, FormPage, LoadingState, Notice, PageHeader, PartyCard } from '@/components/Kit';
import { Calculator } from '@/components/Calculator';
import { DatePickerField } from '@/components/DatePickerField';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useTransactionSuccessSound } from '@/lib/useTransactionSuccessSound';
import {
  apiBaseUrl,
  errorMessage,
  formatMoney,
  isIsoDate,
  makeClientRequestId,
  todayIsoDate,
  type LedgerRecord,
  type PartyRecord,
} from '@/lib/domain';
import { getLedgerEntryDateKey } from '@/lib/partyLedger';

type Props = {
  mode: 'create' | 'edit';
  partyId?: string;
  entry?: LedgerRecord;
  initialType?: EntryType;
};
type EntryType = 'YOU_GAVE' | 'YOU_GOT';
type PickedAttachment = {
  uri: string;
  name: string;
  size: number | null;
  mimeType: string;
  isImage: boolean;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rtf: 'application/rtf',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
};

function resolveAttachmentMimeType(name: string, mimeType?: string | null) {
  if (mimeType && mimeType !== 'application/octet-stream') return mimeType.toLowerCase();
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? mimeType ?? 'application/octet-stream';
}

function formatAttachmentSize(size: number | null) {
  if (!size || size < 1) return 'ফাইল';
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function LedgerEntryForm({ mode, partyId: initialPartyId, entry, initialType }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const playSuccessSound = useTransactionSuccessSound();
  const { identity, token } = useAuth();
  const queryClient = useQueryClient();
  const createEntry = useCreateLedgerEntry();
  const deleteEntry = useDeleteLedgerEntry();
  const patchEntry = usePatchLedgerEntry();
  const requestUploadUrl = useRequestUploadUrl();
  const partyList = useListParties(undefined, { query: { enabled: mode === 'create', queryKey: getListPartiesQueryKey() } });
  const [selectedPartyId, setSelectedPartyId] = useState(initialPartyId ?? '');
  const [partySearch, setPartySearch] = useState('');
  const [type, setType] = useState<EntryType>(entry?.type ?? initialType ?? 'YOU_GAVE');
  const [amount, setAmount] = useState<number | null>(entry?.amount ?? null);
  const [description, setDescription] = useState(entry?.description ?? '');
  const [billReference, setBillReference] = useState(entry?.billReference ?? '');
  const [dueDate, setDueDate] = useState(() => mode === 'edit' && entry
    ? getLedgerEntryDateKey(entry.dueDate, entry.createdAt)
    : todayIsoDate());
  const [isTransfer, setIsTransfer] = useState(false);
  const [transferPartyId, setTransferPartyId] = useState('');
  const [pickedAttachment, setPickedAttachment] = useState<PickedAttachment | null>(null);
  const [existingImage, setExistingImage] = useState<string | null>(entry?.billImage ?? null);
  const [removeImage, setRemoveImage] = useState(false);
  const [attachmentMenuVisible, setAttachmentMenuVisible] = useState(false);
  const [uploadedImagePath, setUploadedImagePath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const [hasStartedCalculator, setHasStartedCalculator] = useState(mode === 'edit');
  const [metadataHeight, setMetadataHeight] = useState(0);
  const metadataProgress = useRef(new Animated.Value(mode === 'edit' ? 1 : 0)).current;
  const showMetadata = mode === 'edit' || hasStartedCalculator;

  useEffect(() => {
    const animation = Animated.timing(metadataProgress, {
      toValue: showMetadata ? 1 : 0,
      duration: 260,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [metadataHeight, metadataProgress, showMetadata]);

  const parties = (partyList.data ?? []) as PartyRecord[];
  const selectedParty = parties.find((item) => item.id === selectedPartyId);
  const selectedPartyRole = selectedParty?.role;
  const adjustmentTargetParams = selectedPartyRole ? { partyRole: selectedPartyRole } : undefined;
  const adjustmentTargets = useListAdjustmentTargets(adjustmentTargetParams, {
    query: {
      enabled: mode === 'create' && identity?.role === 'staff' && !!selectedParty,
      queryKey: getListAdjustmentTargetsQueryKey(adjustmentTargetParams),
    },
  });
  const canTransfer = !!selectedParty &&
    (identity?.role === 'owner' || !!identity?.adjustmentPartyIds.includes(selectedParty.id));
  const transferTargets = !selectedPartyRole ? [] : identity?.role === 'staff'
    ? (adjustmentTargets.data ?? []).filter((target) => target.id !== selectedPartyId && target.role === selectedPartyRole)
    : parties.filter((item) => item.id !== selectedPartyId && item.role === selectedPartyRole);

  const chooseImage = async (source: 'camera' | 'library') => {
    try {
      const permission = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        const settingsAction = Platform.OS !== 'web' && !permission.canAskAgain
          ? [{ text: 'সেটিংস খুলুন', onPress: () => { void Linking.openSettings().catch(() => undefined); } }]
          : [];
        Alert.alert('অনুমতি প্রয়োজন', source === 'camera' ? 'ছবি তুলতে ক্যামেরার অনুমতি দিন।' : 'বিলের ছবি বাছতে গ্যালারির অনুমতি দিন।', [
          { text: 'ঠিক আছে', style: 'cancel' },
          ...settingsAction,
        ]);
        return;
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, quality: 0.86 };
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const name = asset.fileName || `bill-${Date.now()}.jpg`;
        const mimeType = resolveAttachmentMimeType(name, asset.mimeType);
        setPickedAttachment({
          uri: asset.uri,
          name,
          size: asset.fileSize ?? null,
          mimeType,
          isImage: mimeType.startsWith('image/'),
        });
        setUploadedImagePath(null);
        setRemoveImage(false);
      }
    } catch (pickerError) {
      setError(errorMessage(pickerError, 'ছবি খোলা যায়নি।'));
    }
  };

  const chooseDocument = async (pdfOnly = false) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: pdfOnly ? 'application/pdf' : '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const mimeType = resolveAttachmentMimeType(asset.name, asset.mimeType);
      setPickedAttachment({
        uri: asset.uri,
        name: asset.name,
        size: asset.size ?? null,
        mimeType,
        isImage: mimeType.startsWith('image/'),
      });
      setUploadedImagePath(null);
      setRemoveImage(false);
    } catch (pickerError) {
      setError(errorMessage(pickerError, 'ফাইল খোলা যায়নি।'));
    }
  };

  const promptForImage = () => {
    setError('');
    setAttachmentMenuVisible(true);
  };

  const runAttachmentPicker = (picker: () => void) => {
    setAttachmentMenuVisible(false);
    setTimeout(picker, Platform.OS === 'web' ? 0 : 220);
  };

  const uploadSelectedAttachment = async (): Promise<string | null> => {
    if (!pickedAttachment) return removeImage ? null : existingImage;
    if (uploadedImagePath) return uploadedImagePath;
    const file = new File(pickedAttachment.uri);
    const name = pickedAttachment.name || `bill-${Date.now()}`;
    const contentType = pickedAttachment.mimeType;
    const size = Math.max(1, pickedAttachment.size ?? file.size);
    const upload = await requestUploadUrl.mutateAsync({ data: { name, size, contentType } });
    const uploadUrl = /^https?:\/\//i.test(upload.uploadURL) ? upload.uploadURL : `${apiBaseUrl()}${upload.uploadURL}`;
    const response = await expoFetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        ...(upload.uploadToken ? { Authorization: `Bearer ${upload.uploadToken}` } : {}),
      },
      body: file,
    });
    if (!response.ok) throw new Error(`Attachment upload failed (${response.status})`);
    setUploadedImagePath(upload.objectPath);
    return upload.objectPath;
  };

  const invalidateLedger = async (targetPartyId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListLedgerEntriesQueryKey(targetPartyId) }),
      queryClient.invalidateQueries({ queryKey: getGetPartyQueryKey(targetPartyId) }),
      queryClient.invalidateQueries({ queryKey: getListPartiesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListGlobalLedgerEntriesQueryKey({}) }),
      queryClient.invalidateQueries({ queryKey: getListAdjustmentTargetsQueryKey() }),
    ]);
  };

  const confirmDelete = () => {
    if (!entry || !initialPartyId) return;
    Alert.alert(
      'লেনদেনটি স্থায়ীভাবে মুছবেন?',
      entry.isTransfer
        ? 'এই ট্রান্সফার রেকর্ডটি সার্ভার থেকে স্থায়ীভাবে মুছে যাবে। এই কাজটি ফেরানো যাবে না।'
        : 'এই লেনদেনটি স্থায়ীভাবে মুছে যাবে এবং বাকি আবার হিসাব হবে। এই কাজটি ফেরানো যাবে না।',
      [
        { text: 'বাতিল', style: 'cancel' },
        {
          text: 'স্থায়ীভাবে মুছুন',
          style: 'destructive',
          onPress: () => {
            void deleteEntry.mutateAsync({ partyId: initialPartyId, entryId: entry.id }).then(async () => {
              await invalidateLedger(initialPartyId);
              router.replace({ pathname: '/party/[partyId]', params: { partyId: initialPartyId } });
            }).catch((deleteError) => {
              setError(errorMessage(deleteError, 'লেনদেনটি মুছতে পারেনি। আবার চেষ্টা করুন।'));
            });
          },
        },
      ],
    );
  };

  const save = async () => {
    setError('');
    const targetPartyId = selectedPartyId || initialPartyId || '';
    if (!targetPartyId) {
      setError('আগে একটি হিসাব বেছে নিন।');
      return;
    }
    if (amount === null || !Number.isFinite(amount) || amount <= 0) {
      setError('সঠিক টাকার অঙ্ক লিখুন।');
      return;
    }
    if (dueDate && !isIsoDate(dueDate)) {
      setError('লেনদেনের তারিখটি সঠিক নয়।');
      return;
    }
    const selectedTransferTarget = transferTargets.find((target) => target.id === transferPartyId);
    if (isTransfer && (
      !transferPartyId ||
      transferPartyId === targetPartyId ||
      !selectedPartyRole ||
      selectedTransferTarget?.role !== selectedPartyRole
    )) {
      setError(`একজন ${selectedParty?.role === 'SUPPLIER' ? 'সরবরাহকারী' : 'কাস্টমার'} বেছে নিন।`);
      return;
    }

    setUploading(true);
    try {
      const billImage = await uploadSelectedAttachment();
      if (mode === 'create') {
        const payload = {
          type,
          amount,
          description: description.trim(),
          billReference: billReference.trim() || null,
          billImage,
          dueDate: dueDate || null,
          isTransfer,
          transferPartyId: isTransfer ? transferPartyId : null,
        };
        const fingerprint = JSON.stringify([targetPartyId, payload]);
        if (!requestRef.current || requestRef.current.fingerprint !== fingerprint) {
          requestRef.current = { fingerprint, id: makeClientRequestId() };
        }
        await createEntry.mutateAsync({
          partyId: targetPartyId,
          data: { ...payload, clientRequestId: requestRef.current.id },
        });
        playSuccessSound();
        await invalidateLedger(targetPartyId);
        router.replace({ pathname: '/party/[partyId]', params: { partyId: targetPartyId } });
      } else if (entry) {
        await patchEntry.mutateAsync({
          partyId: targetPartyId,
          entryId: entry.id,
          data: {
            type,
            amount,
            description: description.trim(),
            billReference: billReference.trim() || null,
            billImage,
            dueDate: dueDate || null,
          },
        });
        playSuccessSound();
        await invalidateLedger(targetPartyId);
        router.back();
      }
    } catch (saveError) {
      setError(errorMessage(saveError, 'লেনদেন সার্ভারে সংরক্ষণ হয়নি। তথ্য ফর্মে আছে—আবার চেষ্টা করুন।'));
    } finally {
      setUploading(false);
    }
  };

  const visibleParties = parties.filter((party) => {
    if (!partySearch.trim()) return true;
    const query = partySearch.toLocaleLowerCase();
    return party.name.toLocaleLowerCase().includes(query) || party.phone.includes(query);
  });
  const imageUri = pickedAttachment?.isImage ? pickedAttachment.uri : (removeImage ? null : existingImage);
  const hasAttachment = !!pickedAttachment || (!removeImage && !!existingImage);
  const isBusy = uploading || createEntry.isPending || patchEntry.isPending || requestUploadUrl.isPending;
  const directionLabel = type === 'YOU_GOT' ? 'আপনি পেয়েছেন' : 'আপনি দিয়েছেন';
  const formTitle = mode === 'create' && initialType
    ? `${directionLabel}${amount !== null ? ` ${formatMoney(amount)}` : ''}`
    : mode === 'create' ? 'নতুন লেনদেন' : 'লেনদেন পরিবর্তন';
  const formSubtitle = mode === 'create' && selectedParty
    ? `${selectedParty.name}${type === 'YOU_GOT' ? ' থেকে' : ' কে'}`
    : mode === 'create' ? 'খাতায় একটি এন্ট্রি লিখুন' : 'লেনদেনের তথ্য আপডেট করুন';

  return (
    <Calculator
      key={entry?.id ?? 'new-entry'}
      initialAmount={entry?.amount ?? 0}
      onAmountChange={setAmount}
      onInteraction={() => setHasStartedCalculator(true)}
      currencyColor={type === 'YOU_GOT' ? colors.success : colors.destructive}
      disabled={isBusy}
    >
      {({ display, keypad }) => (
    <FormPage footer={mode === 'edit' && entry?.isTransfer ? undefined : (
      <>
        <View style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8 }}>
          <AppButton
            title={mode === 'create' ? 'এন্ট্রি নিশ্চিত করুন' : 'সংরক্ষণ করুন'}
            icon="check"
            variant={type === 'YOU_GOT' ? 'success' : 'danger'}
            onPress={() => { void save(); }}
            loading={isBusy}
            disabled={(!selectedPartyId && !initialPartyId) || amount === null || amount <= 0}
            testID="entry-save"
          />
        </View>
        {keypad}
      </>
    )}>
      <PageHeader title={formTitle} subtitle={formSubtitle} onBack={() => router.back()} />

      {mode === 'edit' && entry?.isTransfer ? (
        <>
          <Notice message="ট্রান্সফার দুইটি খাতাকে একসঙ্গে বদলায়। নিরাপদ হিসাবের জন্য এই এন্ট্রি এখানে পরিবর্তন করা যাবে না।" />
          {error ? <Notice message={error} /> : null}
          <AppButton title="ট্রান্সফার স্থায়ীভাবে মুছুন" icon="trash-2" variant="danger" onPress={confirmDelete} loading={deleteEntry.isPending} testID="entry-delete" />
        </>
      ) : (
        <>
          {error ? <Notice message={error} /> : null}

          {mode === 'create' && !initialPartyId ? (
            <View style={{ gap: 9 }}>
              <Field label="কোন হিসাব?" value={partySearch} onChangeText={setPartySearch} placeholder="নাম বা ফোন দিয়ে খুঁজুন" testID="entry-party-search" />
              {partyList.isLoading ? <LoadingState label="হিসাব লোড হচ্ছে…" /> : null}
              {partyList.isError ? <Notice message={errorMessage(partyList.error, 'হিসাব লোড করা যায়নি।')} onRetry={() => { void partyList.refetch(); }} /> : null}
              {selectedParty ? <PartyCard party={selectedParty} onPress={() => { setSelectedPartyId(''); setTransferPartyId(''); }} /> : null}
              {!selectedParty ? visibleParties.slice(0, 6).map((party) => (
                <PartyCard key={party.id} party={party} onPress={() => { setSelectedPartyId(party.id); setTransferPartyId(''); setPartySearch(''); }} />
              )) : null}
              {partyList.isSuccess && visibleParties.length === 0 ? <Text style={{ color: colors.mutedForeground }}>কোনো হিসাব পাওয়া যায়নি। আগে নতুন হিসাব তৈরি করুন।</Text> : null}
            </View>
          ) : selectedParty && !initialType ? <PartyCard party={selectedParty} onPress={() => undefined} /> : null}

          {!initialType ? (
            <>
              <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '800' }}>লেনদেনের ধরন</Text>
              <View style={{ flexDirection: 'row', gap: 9 }}>
                {(['YOU_GAVE', 'YOU_GOT'] as const).map((value) => {
                  const active = type === value;
                  return (
                    <Pressable key={value} onPress={() => setType(value)} accessibilityRole="button" testID={`entry-type-${value}`} style={{ flex: 1, minHeight: 48, borderRadius: 11, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.secondary : colors.card, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: active ? colors.primary : colors.foreground, fontWeight: '700' }}>{value === 'YOU_GAVE' ? 'আপনি দিয়েছেন' : 'আপনি পেয়েছেন'}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          {display}

          <Animated.View
            accessibilityElementsHidden={!showMetadata}
            importantForAccessibility={showMetadata ? 'auto' : 'no-hide-descendants'}
            testID="entry-metadata-panel"
            style={{
              height: metadataProgress.interpolate({ inputRange: [0, 1], outputRange: [0, metadataHeight] }),
              opacity: metadataProgress,
              overflow: 'hidden',
            }}
          >
            <View onLayout={(event) => setMetadataHeight(event.nativeEvent.layout.height)} style={{ gap: 16 }}>
              <Field label="বিস্তারিত লিখুন" value={description} onChangeText={setDescription} placeholder="পণ্য, বিল নং, পরিমাণ ইত্যাদি" testID="entry-description" />
              <Field label="বিল/রেফারেন্স নম্বর" value={billReference} onChangeText={setBillReference} placeholder="ঐচ্ছিক" testID="entry-bill-reference" />
              <DatePickerField label="তারিখ" value={dueDate} onChange={setDueDate} testID="entry-date" />

              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: colors.foreground, fontWeight: '800' }}>বিল সংযুক্ত করুন</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>ঐচ্ছিক · সেভ করার সময় নিরাপদে আপলোড হবে</Text>
                  </View>
                   <AppButton title={hasAttachment ? 'ফাইল বদলান' : 'বিল সংযুক্ত করুন'} icon="paperclip" compact variant="secondary" onPress={promptForImage} testID="entry-add-photo" />
                </View>
                 {hasAttachment ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                     {pickedAttachment?.isImage && imageUri ? (
                       <Image source={{ uri: imageUri }} style={{ width: 84, height: 84, borderRadius: 12 }} />
                     ) : pickedAttachment ? (
                       <View style={{ width: 84, height: 84, borderRadius: 12, backgroundColor: colors.secondary, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 6 }}>
                         <Feather name={pickedAttachment.mimeType === 'application/pdf' ? 'file-text' : 'file'} size={27} color={colors.primary} />
                         <Text numberOfLines={1} style={{ color: colors.primary, fontSize: 10, fontWeight: '700' }}>
                           {pickedAttachment.mimeType === 'application/pdf' ? 'PDF' : 'Ֆայլ'}
                         </Text>
                       </View>
                     ) : <BillPhoto path={existingImage} token={token} />}
                     <View style={{ flex: 1, gap: 4 }}>
                       <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: '700' }}>
                         {pickedAttachment?.name ?? 'সংযুক্ত বিল'}
                       </Text>
                       {pickedAttachment ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{formatAttachmentSize(pickedAttachment.size)}</Text> : null}
                     </View>
                     <Pressable onPress={() => { setPickedAttachment(null); setUploadedImagePath(null); setExistingImage(null); setRemoveImage(true); }} accessibilityRole="button" testID="entry-remove-photo">
                       <Text style={{ color: colors.destructive, fontWeight: '700' }}>সরান</Text>
                    </Pressable>
                  </View>
                ) : null}
              </Card>

               <Modal
                 visible={attachmentMenuVisible}
                 transparent
                 animationType="fade"
                 onRequestClose={() => setAttachmentMenuVisible(false)}
               >
                 <View style={{ flex: 1, justifyContent: 'flex-end' }}>
                   <Pressable
                     accessibilityRole="button"
                     accessibilityLabel="মেনু বন্ধ করুন"
                     onPress={() => setAttachmentMenuVisible(false)}
                     style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10, 24, 42, 0.42)' }]}
                   />
                   <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 16) + 12, gap: 10 }}>
                     <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 4 }} />
                     <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                       <View>
                         <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: '800' }}>বিল সংযুক্ত করুন</Text>
                         <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: 3 }}>কোথা থেকে ফাইলটি নেবেন?</Text>
                       </View>
                       <Pressable onPress={() => setAttachmentMenuVisible(false)} accessibilityRole="button" accessibilityLabel="বন্ধ করুন" hitSlop={10}>
                         <Feather name="x" size={22} color={colors.mutedForeground} />
                       </Pressable>
                     </View>
                     {[
                       { key: 'gallery', title: 'গ্যালারি / ফটো', subtitle: 'ফোনের ছবি বেছে নিন', icon: 'image' as const, action: () => chooseImage('library') },
                       ...(Platform.OS !== 'web' ? [{ key: 'camera', title: 'ক্যামেরা', subtitle: 'এখনই ছবি তুলুন', icon: 'camera' as const, action: () => chooseImage('camera') }] : []),
                       { key: 'pdf', title: 'PDF', subtitle: 'একটি PDF ডকুমেন্ট বেছে নিন', icon: 'file-text' as const, action: () => chooseDocument(true) },
                       { key: 'files', title: 'ফাইল ম্যানেজার', subtitle: 'ডকুমেন্ট বা অন্য ফাইল বেছে নিন', icon: 'folder' as const, action: () => chooseDocument() },
                     ].map((option) => (
                       <Pressable
                         key={option.key}
                         onPress={() => runAttachmentPicker(() => { void option.action(); })}
                         accessibilityRole="button"
                         testID={`entry-bill-source-${option.key}`}
                         style={({ pressed }) => ({
                           minHeight: 62,
                           flexDirection: 'row',
                           alignItems: 'center',
                           gap: 14,
                           paddingHorizontal: 14,
                           paddingVertical: 10,
                           borderRadius: 14,
                           backgroundColor: pressed ? colors.muted : colors.secondary,
                         })}
                       >
                         <Feather name={option.icon} size={21} color={colors.primary} />
                         <View style={{ flex: 1 }}>
                           <Text style={{ color: colors.foreground, fontWeight: '700' }}>{option.title}</Text>
                           <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>{option.subtitle}</Text>
                         </View>
                         <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                       </Pressable>
                     ))}
                     <Pressable onPress={() => setAttachmentMenuVisible(false)} accessibilityRole="button" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                       <Text style={{ color: colors.mutedForeground, fontWeight: '700' }}>বাতিল</Text>
                     </Pressable>
                   </View>
                 </View>
               </Modal>

              {mode === 'create' && canTransfer ? (
                <Card>
                  <Pressable onPress={() => { setIsTransfer((value) => !value); setTransferPartyId(''); }} accessibilityRole="switch" accessibilityState={{ checked: isTransfer }} testID="entry-transfer-toggle" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={{ color: colors.foreground, fontWeight: '800' }}>অ্যাডজাস্টমেন্ট</Text>
                      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>অন্য একই ধরনের খাতার সঙ্গে মিলিয়ে নিন</Text>
                    </View>
                    <Text style={{ color: isTransfer ? colors.primary : colors.mutedForeground, fontWeight: '800' }}>{isTransfer ? 'চালু' : 'বন্ধ'}</Text>
                  </Pressable>
                  {isTransfer ? (
                    <View style={{ gap: 8 }}>
                      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '700' }}>
                        অন্য {selectedParty?.role === 'SUPPLIER' ? 'সরবরাহকারী' : 'কাস্টমার'} বেছে নিন
                      </Text>
                      {transferTargets.map((target) => (
                        <Pressable key={target.id} onPress={() => setTransferPartyId(target.id)} accessibilityRole="radio" accessibilityState={{ selected: transferPartyId === target.id }} style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: transferPartyId === target.id ? colors.primary : colors.border, backgroundColor: transferPartyId === target.id ? colors.secondary : colors.card }}>
                          <Text style={{ color: colors.foreground, fontWeight: '700' }}>{target.name}</Text>
                        </Pressable>
                      ))}
                      {adjustmentTargets.isLoading && identity?.role === 'staff' ? <LoadingState label="অনুমোদিত হিসাব লোড হচ্ছে…" /> : null}
                      {transferTargets.length === 0 ? <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>ট্রান্সফারের জন্য অন্য কোনো অনুমোদিত হিসাব নেই।</Text> : null}
                    </View>
                  ) : null}
                </Card>
              ) : null}

              {mode === 'edit' ? <AppButton title="লেনদেন স্থায়ীভাবে মুছুন" icon="trash-2" variant="danger" onPress={confirmDelete} loading={deleteEntry.isPending} testID="entry-delete" /> : null}
            </View>
          </Animated.View>
        </>
      )}
    </FormPage>
      )}
    </Calculator>
  );
}