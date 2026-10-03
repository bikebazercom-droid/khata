import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Image, Linking, Platform, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
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

export function LedgerEntryForm({ mode, partyId: initialPartyId, entry, initialType }: Props) {
  const colors = useColors();
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
  const [pickedImage, setPickedImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [existingImage, setExistingImage] = useState<string | null>(entry?.billImage ?? null);
  const [removeImage, setRemoveImage] = useState(false);
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
        setPickedImage(result.assets[0]);
        setUploadedImagePath(null);
        setRemoveImage(false);
      }
    } catch (pickerError) {
      setError(errorMessage(pickerError, 'ছবি খোলা যায়নি।'));
    }
  };

  const promptForImage = () => {
    const actions: { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }[] = [
      { text: 'গ্যালারি থেকে নিন', onPress: () => { void chooseImage('library'); } },
    ];
    if (Platform.OS !== 'web') actions.unshift({ text: 'ক্যামেরা দিয়ে তুলুন', onPress: () => { void chooseImage('camera'); } });
    actions.push({ text: 'বাতিল', style: 'cancel' as const, onPress: () => undefined });
    Alert.alert('বিলের ছবি', 'ছবি কোথা থেকে নিতে চান?', actions);
  };

  const uploadSelectedImage = async (): Promise<string | null> => {
    if (!pickedImage) return removeImage ? null : existingImage;
    if (uploadedImagePath) return uploadedImagePath;
    const file = new File(pickedImage.uri);
    const name = pickedImage.fileName || `bill-${Date.now()}.jpg`;
    const contentType = pickedImage.mimeType || (name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
    const size = Math.max(1, pickedImage.fileSize ?? file.size);
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
    if (!response.ok) throw new Error(`Photo upload failed (${response.status})`);
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
      const billImage = await uploadSelectedImage();
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
  const imageUri = pickedImage?.uri ?? (removeImage ? null : existingImage);
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
                  <AppButton title={imageUri ? 'ছবি বদলান' : 'বিল সংযুক্ত করুন'} icon="camera" compact variant="secondary" onPress={promptForImage} testID="entry-add-photo" />
                </View>
                {imageUri ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    {pickedImage ? <Image source={{ uri: pickedImage.uri }} style={{ width: 84, height: 84, borderRadius: 12 }} /> : <BillPhoto path={existingImage} token={token} />}
                    <Pressable onPress={() => { setPickedImage(null); setUploadedImagePath(null); setExistingImage(null); setRemoveImage(true); }} accessibilityRole="button" testID="entry-remove-photo">
                      <Text style={{ color: colors.destructive, fontWeight: '700' }}>ছবি সরান</Text>
                    </Pressable>
                  </View>
                ) : null}
              </Card>

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