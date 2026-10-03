import React from 'react';
import { useState } from 'react';
import { Alert, Modal, Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetBusinessSettingsQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetPartyQueryKey,
  getListGlobalLedgerEntriesQueryKey,
  getListLedgerEntriesQueryKey,
  getListPartiesQueryKey,
  useDeleteParty,
  useGetBusinessSettings,
  useGetParty,
  useListLedgerEntries,
} from '@workspace/api-client-react';
import { AppButton, Card, EmptyState, EntryRow, LoadingState, Notice, Page, PageHeader } from '@/components/Kit';
import { useAuth } from '@/contexts/AuthContext';
import { errorMessage, formatMoney, type LedgerRecord, type PartyRecord } from '@/lib/domain';
import { useColors } from '@/hooks/useColors';
import { useBusinessScope } from '@/contexts/BusinessScopeContext';
import { buildPartyReminderMessage, buildPartySmsMessage } from '@/lib/partyMessages';
import {
  buildPartyStatementHtml,
  calculatePartyStatement,
  embedPartyStatementBillImages,
  shareReportPdf,
} from '@/lib/reportPdf';

export default function PartyDetailScreen() {
  const colors = useColors();
  const { partyId } = useLocalSearchParams<{ partyId: string }>();
  const queryClient = useQueryClient();
  const { identity, getApiToken } = useAuth();
  const { selectedBusinessName } = useBusinessScope();
  const partyQuery = useGetParty(partyId);
  const entriesQuery = useListLedgerEntries(partyId);
  const settingsQuery = useGetBusinessSettings({
    query: { enabled: identity?.role === 'owner', queryKey: getGetBusinessSettingsQueryKey() },
  });
  const deleteParty = useDeleteParty();
  const party = partyQuery.data as PartyRecord | undefined;
  const entries = (entriesQuery.data ?? []) as LedgerRecord[];
  const [sharingReminder, setSharingReminder] = useState(false);
  const [reminderNotice, setReminderNotice] = useState('');
  const [smsMessage, setSmsMessage] = useState('');
  const [smsCopied, setSmsCopied] = useState(false);

  const removeParty = () => {
    Alert.alert(
      'হিসাবটি চিরতরে মুছবেন?',
      `${party?.name ?? 'এই পার্টি'} এবং তার সব লেনদেন স্থায়ীভাবে মুছে যাবে। এই কাজটি ফেরানো যাবে না।`,
      [
        { text: 'বাতিল', style: 'cancel' },
        {
          text: 'স্থায়ীভাবে মুছুন',
          style: 'destructive',
          onPress: () => {
            void deleteParty.mutateAsync({ partyId }).then(async () => {
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: getListPartiesQueryKey() }),
                queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
                queryClient.invalidateQueries({ queryKey: getListGlobalLedgerEntriesQueryKey({}) }),
              ]);
              router.replace('/(tabs)/parties');
            }).catch((error) => Alert.alert('মুছতে পারেনি', errorMessage(error, 'সার্ভারে আবার চেষ্টা করুন।')));
          },
        },
      ],
    );
  };

  const shareReminder = async () => {
    if (!party) return;
    setSharingReminder(true);
    setReminderNotice('');
    try {
      const statement = calculatePartyStatement(entries, 'all');
      const token = await getApiToken().catch(() => null);
      const { images, failedCount } = await embedPartyStatementBillImages(statement.entries, token);
      const storeName = settingsQuery.data?.storeName || selectedBusinessName || identity?.businessName || 'Banglakhata';
      const html = buildPartyStatementHtml({
        businessName: storeName,
        party,
        periodLabel: 'সকল লেনদেন',
        statement,
        billImages: images,
      });
      const message = buildPartyReminderMessage(storeName, party);
      let messageCopied = false;
      try {
        await Clipboard.setStringAsync(message);
        messageCopied = true;
      } catch {
        // PDF sharing remains useful even if clipboard access is unavailable.
      }
      await shareReportPdf(html, `${party.name} হিসাবের রিমাইন্ডার`);
      const copyStatus = messageCopied
        ? 'রিমাইন্ডার বার্তা কপি হয়েছে; WhatsApp বা SMS-এ পেস্ট করুন।'
        : 'রিমাইন্ডার বার্তাটি কপি করা যায়নি।';
      setReminderNotice(failedCount > 0
        ? `PDF শেয়ার করা হয়েছে। ${copyStatus} ${failedCount}টি বিলের ছবি PDF-এ যুক্ত হয়নি।`
        : `PDF শেয়ার করার জন্য প্রস্তুত। ${copyStatus}`);
    } catch (error) {
      setReminderNotice(errorMessage(error, 'রিমাইন্ডার তৈরি করা যায়নি। আবার চেষ্টা করুন।'));
    } finally {
      setSharingReminder(false);
    }
  };

  const openSmsMessage = () => {
    if (!party) return;
    setSmsMessage(buildPartySmsMessage(party));
    setSmsCopied(false);
  };

  const copySmsMessage = async () => {
    if (!smsMessage) return;
    try {
      await Clipboard.setStringAsync(smsMessage);
      setSmsCopied(true);
    } catch (error) {
      Alert.alert('কপি করা যায়নি', errorMessage(error, 'বার্তাটি কপি করতে আবার চেষ্টা করুন।'));
    }
  };

  if (partyQuery.isLoading) return <Page><LoadingState label="হিসাব লোড হচ্ছে…" /></Page>;
  if (partyQuery.isError || !party) return <Page><Notice message={errorMessage(partyQuery.error, 'এই হিসাবটি পাওয়া যায়নি।')} onRetry={() => { void partyQuery.refetch(); }} /></Page>;

  const gives = party.balanceType === 'YOU_WILL_GIVE';
  return (
    <Page onRefresh={() => { void Promise.all([partyQuery.refetch(), entriesQuery.refetch()]); }} refreshing={partyQuery.isRefetching || entriesQuery.isRefetching}>
      <PageHeader
        title={party.name}
        subtitle={party.role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'}
        onBack={() => router.back()}
        right={identity?.role === 'owner' ? <Text onPress={removeParty} style={{ color: colors.destructive, fontSize: 13, fontWeight: '700' }}>মুছুন</Text> : undefined}
      />
      {party.phone ? <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>{party.phone}</Text> : null}
      <Card style={{ backgroundColor: colors.primary, borderColor: colors.primary }}>
        <Text style={{ color: colors.primaryForeground, opacity: 0.8, fontSize: 13 }}>{party.currentBalance === 0 ? 'হিসাব সমান' : gives ? 'আপনি দেবেন' : 'আপনি পাবেন'}</Text>
        <Text style={{ color: colors.primaryForeground, fontSize: 30, fontWeight: '800' }}>{formatMoney(party.currentBalance)}</Text>
      </Card>
      {identity?.role === 'owner' ? (
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border }}>
          <Pressable
            onPress={() => router.push({ pathname: '/party/[partyId]/report', params: { partyId } })}
            accessibilityRole="button"
            testID="party-open-statement"
            style={({ pressed }) => ({ flex: 1, minHeight: 66, alignItems: 'center', justifyContent: 'center', gap: 5, opacity: pressed ? 0.65 : 1 })}
          >
            <Feather name="file-text" size={20} color={colors.mutedForeground} />
            <Text style={{ color: colors.foreground, fontSize: 11, fontWeight: '700' }}>রিপোর্ট</Text>
          </Pressable>
          <View style={{ width: 1, backgroundColor: colors.border, marginVertical: 9 }} />
          <Pressable
            onPress={() => { void shareReminder(); }}
            disabled={sharingReminder || entriesQuery.isLoading || entriesQuery.isError}
            accessibilityRole="button"
            testID="party-reminder"
            style={({ pressed }) => ({ flex: 1, minHeight: 66, alignItems: 'center', justifyContent: 'center', gap: 5, opacity: sharingReminder || entriesQuery.isLoading || entriesQuery.isError ? 0.55 : pressed ? 0.65 : 1 })}
          >
            <Feather name={sharingReminder ? 'loader' : 'message-circle'} size={20} color={colors.success} />
            <Text style={{ color: colors.foreground, fontSize: 11, fontWeight: '700' }}>{sharingReminder ? 'তৈরি হচ্ছে…' : 'রিমাইন্ডার'}</Text>
          </Pressable>
          <View style={{ width: 1, backgroundColor: colors.border, marginVertical: 9 }} />
          <Pressable
            onPress={openSmsMessage}
            accessibilityRole="button"
            testID="party-sms"
            style={({ pressed }) => ({ flex: 1, minHeight: 66, alignItems: 'center', justifyContent: 'center', gap: 5, opacity: pressed ? 0.65 : 1 })}
          >
            <Feather name="message-square" size={20} color={colors.mutedForeground} />
            <Text style={{ color: colors.foreground, fontSize: 11, fontWeight: '700' }}>এসএমএস</Text>
          </Pressable>
        </View>
      ) : (
        <AppButton
          title="স্টেটমেন্ট"
          icon="file-text"
          variant="secondary"
          onPress={() => router.push({ pathname: '/party/[partyId]/report', params: { partyId } })}
          testID="party-open-statement"
        />
      )}
      {reminderNotice ? <Notice message={reminderNotice} tone={reminderNotice.includes('যায়নি') ? 'error' : 'info'} /> : null}
      <AppButton
        title="লেনদেন লিখুন"
        icon="plus"
        onPress={() => router.push({ pathname: '/entry/new', params: { partyId } })}
        testID="party-add-entry"
      />
      {party.dueDate ? <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>বাকি পাওয়ার তারিখ: {party.dueDate}</Text> : null}
      <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: '800', marginTop: 4 }}>লেনদেনের ইতিহাস</Text>
      {entriesQuery.isLoading ? <LoadingState label="লেনদেন লোড হচ্ছে…" /> : null}
      {entriesQuery.isError ? <Notice message={errorMessage(entriesQuery.error, 'লেনদেন লোড করা যায়নি।')} onRetry={() => { void entriesQuery.refetch(); }} /> : null}
      {entries.map((entry) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          onPress={() => router.push({ pathname: '/entry/[entryId]', params: { entryId: entry.id, partyId } })}
        />
      ))}
      {entriesQuery.isSuccess && entries.length === 0 ? <EmptyState title="এখনও কোনো লেনদেন নেই" description="এই হিসাবের প্রথম এন্ট্রি যোগ করুন।" icon="file-text" /> : null}

      <Modal
        visible={!!smsMessage}
        transparent
        animationType="fade"
        onRequestClose={() => setSmsMessage('')}
      >
        <View style={{ flex: 1, justifyContent: 'center', padding: 22, backgroundColor: '#00000066' }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 20, padding: 18, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: '800' }}>এসএমএস বার্তা</Text>
              <Pressable onPress={() => setSmsMessage('')} accessibilityRole="button" accessibilityLabel="বন্ধ করুন">
                <Feather name="x" size={21} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <Text selectable style={{ color: colors.foreground, fontSize: 15, lineHeight: 25 }}>{smsMessage}</Text>
            <AppButton
              title={smsCopied ? 'কপি হয়েছে' : 'বার্তা কপি করুন'}
              icon={smsCopied ? 'check' : 'copy'}
              onPress={() => { void copySmsMessage(); }}
              testID="party-sms-copy"
            />
            <AppButton title="বন্ধ করুন" variant="secondary" onPress={() => setSmsMessage('')} />
          </View>
        </View>
      </Modal>
    </Page>
  );
}