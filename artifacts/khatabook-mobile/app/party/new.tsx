import React, { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getGetDashboardSummaryQueryKey, getListPartiesQueryKey, useCreateParty } from '@workspace/api-client-react';
import { AppButton, Field, FormPage, PageHeader } from '@/components/Kit';
import { useColors } from '@/hooks/useColors';
import { errorMessage, isIsoDate } from '@/lib/domain';

type PartyRole = 'CUSTOMER' | 'SUPPLIER';
type BalanceType = 'YOU_WILL_GET' | 'YOU_WILL_GIVE';

export default function NewPartyScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const createParty = useCreateParty();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<PartyRole>('CUSTOMER');
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingBalanceType, setOpeningBalanceType] = useState<BalanceType>('YOU_WILL_GET');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState('');

  const save = async () => {
    setError('');
    const amount = Number(openingBalance.replace(/,/g, ''));
    if (!name.trim()) {
      setError('নাম লিখুন।');
      return;
    }
    if (openingBalance.trim() && (!Number.isFinite(amount) || amount < 0)) {
      setError('শুরুর বাকি সঠিকভাবে লিখুন।');
      return;
    }
    if (dueDate && !isIsoDate(dueDate)) {
      setError('তারিখ YYYY-MM-DD আকারে লিখুন।');
      return;
    }
    try {
      const party = await createParty.mutateAsync({
        data: {
          name: name.trim(),
          phone: phone.trim(),
          role,
          ...(openingBalance.trim() && amount > 0 ? { openingBalance: amount, openingBalanceType } : {}),
          dueDate: dueDate || null,
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListPartiesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
      ]);
      router.replace({ pathname: '/party/[partyId]', params: { partyId: party.id } });
    } catch (saveError) {
      setError(errorMessage(saveError, 'হিসাব তৈরি করা যায়নি। আবার চেষ্টা করুন।'));
    }
  };

  return (
    <FormPage>
      <PageHeader title="নতুন হিসাব" subtitle="কাস্টমার বা সাপ্লায়ারের তথ্য লিখুন" onBack={() => router.back()} />
      {error ? <Text style={{ color: colors.destructive, fontSize: 14 }}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {(['CUSTOMER', 'SUPPLIER'] as const).map((value) => {
          const active = role === value;
          return (
            <Pressable key={value} onPress={() => setRole(value)} accessibilityRole="button" testID={`party-role-${value}`} style={{ flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.secondary : colors.card, alignItems: 'center' }}>
              <Text style={{ color: active ? colors.primary : colors.foreground, fontWeight: '700' }}>{value === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'}</Text>
            </Pressable>
          );
        })}
      </View>
      <Field label="নাম *" value={name} onChangeText={setName} placeholder="যেমন: আব্দুল করিম" testID="party-name" />
      <Field label="ফোন নম্বর" value={phone} onChangeText={setPhone} placeholder="01XXXXXXXXX" keyboardType="phone-pad" testID="party-phone" />
      <Field label="শুরুর বাকি (ঐচ্ছিক)" value={openingBalance} onChangeText={setOpeningBalance} placeholder="0" keyboardType="numbers-and-punctuation" testID="party-opening-balance" />
      {openingBalance.trim() && Number(openingBalance.replace(/,/g, '')) > 0 ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {(['YOU_WILL_GET', 'YOU_WILL_GIVE'] as const).map((value) => {
            const active = openingBalanceType === value;
            return (
              <Pressable key={value} onPress={() => setOpeningBalanceType(value)} accessibilityRole="button" style={{ flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.secondary : colors.card, alignItems: 'center' }}>
                <Text style={{ color: active ? colors.primary : colors.foreground, fontWeight: '700' }}>{value === 'YOU_WILL_GET' ? 'আপনি পাবেন' : 'আপনি দেবেন'}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <Field label="বাকি পাওয়ার তারিখ (ঐচ্ছিক)" value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" testID="party-due-date" />
      <AppButton title="হিসাব তৈরি করুন" icon="check" onPress={() => { void save(); }} loading={createParty.isPending} disabled={!name.trim()} testID="party-save" />
    </FormPage>
  );
}