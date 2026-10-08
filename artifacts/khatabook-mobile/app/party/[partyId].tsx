import React, { useMemo, useState } from 'react';
import { Alert, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
  useListParties,
} from '@workspace/api-client-react';
import { AppButton, BillPhoto, Card, EmptyState, LoadingState, Notice, Page, PageHeader } from '@/components/Kit';
import { useAuth } from '@/contexts/AuthContext';
import { errorMessage, formatMoney, type LedgerRecord, type PartyRecord } from '@/lib/domain';
import { useColors } from '@/hooks/useColors';
import { useBusinessScope } from '@/contexts/BusinessScopeContext';
import {
  buildPartyLedgerTimeline,
  formatPartyLedgerDay,
  formatPartyLedgerEntryTime,
  getLocalTodayDateKey,
  groupPartyLedgerByDay,
} from '@/lib/partyLedger';
import { buildPartyReminderMessage, buildPartySmsMessage } from '@/lib/partyMessages';
import {
  buildPartyStatementHtml,
  calculatePartyStatement,
  embedPartyStatementBillImages,
  shareReportPdf,
} from '@/lib/reportPdf';

export default function PartyDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { partyId } = useLocalSearchParams<{ partyId: string }>();
  const queryClient = useQueryClient();
  const { identity, getApiToken, token } = useAuth();
  const { selectedBusinessName } = useBusinessScope();
  const partyQuery = useGetParty(partyId);
  const entriesQuery = useListLedgerEntries(partyId);
  const partiesQuery = useListParties(undefined, { query: { queryKey: getListPartiesQueryKey() } });
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
  const timeline = useMemo(
    () => party ? buildPartyLedgerTimeline(entries, party) : [],
    [entries, party],
  );
  const groupedEntries = useMemo(
    () => groupPartyLedgerByDay([...timeline].reverse()),
    [timeline],
  );
  const partyNames = useMemo(
    () => new Map(((partiesQuery.data ?? []) as PartyRecord[]).map((item) => [item.id, item.name])),
    [partiesQuery.data],
  );

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
        businessName: selectedBusinessName || storeName,
        party,
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
  const footerBottom = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 12);
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={partyQuery.isRefetching || entriesQuery.isRefetching}
            onRefresh={() => { void Promise.all([partyQuery.refetch(), entriesQuery.refetch()]); }}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={{ flexGrow: 1, padding: 16, paddingBottom: 26, gap: 13 }}
      >
        <PageHeader
          title={party.name}
          subtitle={party.role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'}
          onBack={() => router.back()}
          right={identity?.role === 'owner' ? (
            <Pressable onPress={removeParty} accessibilityRole="button" accessibilityLabel="হিসাব মুছুন">
              <Text style={{ color: colors.destructive, fontSize: 13, fontWeight: '700' }}>মুছুন</Text>
            </Pressable>
          ) : undefined}
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
        {party.dueDate ? <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>বাকি পাওয়ার তারিখ: {party.dueDate}</Text> : null}
        <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: '800', marginTop: 4 }}>লেনদেনের ইতিহাস</Text>
        {entriesQuery.isLoading ? <LoadingState label="লেনদেন লোড হচ্ছে…" /> : null}
        {entriesQuery.isError ? <Notice message={errorMessage(entriesQuery.error, 'লেনদেন লোড করা যায়নি।')} onRetry={() => { void entriesQuery.refetch(); }} /> : null}
        {entriesQuery.isSuccess && entries.length === 0 ? <EmptyState title="এখনও কোনো লেনদেন নেই" description="এই হিসাবের প্রথম এন্ট্রি যোগ করুন।" icon="file-text" /> : null}
        {entriesQuery.isSuccess && entries.length > 0 ? (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 8 }}>
              <Text style={{ flex: 1, color: colors.mutedForeground, fontSize: 11, fontWeight: '800' }}>লেনদেন</Text>
              <Text style={{ width: 78, textAlign: 'center', color: colors.destructive, fontSize: 11, fontWeight: '800' }}>আপনি দিয়েছেন</Text>
              <Text style={{ width: 78, textAlign: 'center', color: colors.success, fontSize: 11, fontWeight: '800' }}>আপনি পেয়েছেন</Text>
            </View>
            {groupedEntries.map((group) => (
              <View key={group.dayKey} style={{ gap: 5 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: '800' }}>
                    {formatPartyLedgerDay(group.dayKey)}{group.dayKey === getLocalTodayDateKey() ? ' · আজ' : ''}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{group.entries.length}টি লেনদেন</Text>
                </View>
                <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.card }}>
                  {group.entries.map((entry) => {
                    const gave = entry.type === 'YOU_GAVE';
                    const transferName = entry.transferPartyId ? partyNames.get(entry.transferPartyId) : undefined;
                    const title = entry.isTransfer
                      ? `${gave ? 'অ্যাডজাস্টমেন্ট' : 'অ্যাডজাস্টমেন্ট'}${transferName ? ` · ${transferName}` : ''}`
                      : entry.description || (gave ? 'আপনি দিয়েছেন' : 'আপনি পেয়েছেন');
                    const amountText = formatMoney(entry.amount);
                    const row = (
                      <View style={{ flexDirection: 'row', gap: 6, paddingVertical: 8, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <View style={{ flex: 1, minWidth: 0, justifyContent: 'center', gap: 3, paddingHorizontal: 4 }}>
                          <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: '700' }} numberOfLines={2}>{title}</Text>
                          <Text style={{ color: colors.mutedForeground, fontSize: 10 }} numberOfLines={1}>
                            {formatPartyLedgerDay(entry.businessDate)} · {formatPartyLedgerEntryTime(entry.createdAt)}
                          </Text>
                          {entry.billReference ? <Text style={{ color: colors.mutedForeground, fontSize: 10 }} numberOfLines={1}>রেফারেন্স: {entry.billReference}</Text> : null}
                          <Text style={{ color: entry.balanceAfter >= 0 ? colors.success : colors.destructive, fontSize: 10, fontWeight: '700' }} numberOfLines={1}>
                            বাকি: {formatMoney(entry.balanceAfter)}
                          </Text>
                          {entry.billImage ? <BillPhoto path={entry.billImage} token={token} /> : null}
                        </View>
                        <View style={{ width: 78, minHeight: 66, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, borderRadius: 8, backgroundColor: gave ? `${colors.destructive}12` : 'transparent' }}>
                          {gave ? <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={{ color: colors.destructive, fontSize: 13, fontWeight: '800' }}>{amountText}</Text> : null}
                        </View>
                        <View style={{ width: 78, minHeight: 66, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, borderRadius: 8, backgroundColor: gave ? 'transparent' : `${colors.success}12` }}>
                          {!gave ? <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={{ color: colors.success, fontSize: 13, fontWeight: '800' }}>{amountText}</Text> : null}
                        </View>
                      </View>
                    );
                    return identity?.role === 'owner' ? (
                      <Pressable
                        key={entry.id}
                        onPress={() => router.push({ pathname: '/entry/[entryId]', params: { entryId: entry.id, partyId } })}
                        accessibilityRole="button"
                        testID={`entry-${entry.id}`}
                        style={({ pressed }) => ({ opacity: pressed ? 0.78 : 1 })}
                      >
                        {row}
                      </Pressable>
                    ) : <View key={entry.id}>{row}</View>;
                  })}
                </View>
              </View>
            ))}
          </View>
        ) : null}

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
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingTop: 11, paddingBottom: footerBottom, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card }}>
        <Pressable
          onPress={() => router.push({ pathname: '/entry/new', params: { partyId, type: 'YOU_GAVE' } })}
          accessibilityRole="button"
          testID="party-entry-gave"
          style={({ pressed }) => ({ flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.destructive, opacity: pressed ? 0.8 : 1 })}
        >
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ color: colors.destructiveForeground, fontSize: 14, fontWeight: '800' }}>আপনি দিয়েছেন ৳</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push({ pathname: '/entry/new', params: { partyId, type: 'YOU_GOT' } })}
          accessibilityRole="button"
          testID="party-entry-got"
          style={({ pressed }) => ({ flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.success, opacity: pressed ? 0.8 : 1 })}
        >
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ color: colors.successForeground, fontSize: 14, fontWeight: '800' }}>আপনি পেয়েছেন ৳</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}