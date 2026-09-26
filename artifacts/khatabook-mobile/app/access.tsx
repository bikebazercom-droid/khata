import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useAuthRole } from '@/lib/auth-role';
import { customFetch } from '@/lib/api-transport';

type PartyRole = 'CUSTOMER' | 'SUPPLIER';
type OwnerParty = { id: string; name: string; role: PartyRole };
type Worker = {
  id: string;
  identity: string;
  status: 'active' | 'suspended' | 'pending';
  partyIds: string[];
  adjustmentPartyIds: string[];
  lastLogin: string | null;
  lastLogout: string | null;
  invitedAt: string | null;
};
type ActivityEntry = {
  id: string;
  partyId: string;
  partyName: string;
  partyRole: string;
  actorId: string;
  actorIdentity: string;
  type: string;
  amount: number | null;
  description: string;
  createdAt: string;
};

function businessHeaders(businessId: string) {
  return { 'X-Business-Id': businessId };
}

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' });
}

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : 'অজানা ত্রুটি';
}

export default function AccessScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { identity } = useAuthRole();
  const businessId = identity?.businessId ?? '';
  const [search, setSearch] = useState('');
  const [selectedParty, setSelectedParty] = useState<OwnerParty | null>(null);
  const [email, setEmail] = useState('');
  const [invitePartyIds, setInvitePartyIds] = useState<string[]>([]);
  const [inviteAdjustmentPartyIds, setInviteAdjustmentPartyIds] = useState<string[]>([]);
  const [expandedWorkerId, setExpandedWorkerId] = useState<string | null>(null);
  const [workerSearch, setWorkerSearch] = useState('');
  const [draftPartyIds, setDraftPartyIds] = useState<string[]>([]);
  const [draftAdjustmentIds, setDraftAdjustmentIds] = useState<string[]>([]);

  const partiesQuery = useQuery({
    queryKey: ['mobile-owner-parties', businessId],
    enabled: !!businessId,
    queryFn: () => customFetch<OwnerParty[]>('/api/owner/parties', {
      responseType: 'json',
      headers: businessHeaders(businessId),
    }),
  });
  const workersQuery = useQuery({
    queryKey: ['mobile-owner-workers', businessId],
    enabled: !!businessId,
    queryFn: async () => {
      const result = await customFetch<{ workers: Worker[] }>('/api/owner/workers', {
        responseType: 'json',
        headers: businessHeaders(businessId),
      });
      return result.workers ?? [];
    },
  });
  const activityQuery = useQuery({
    queryKey: ['mobile-owner-activity', businessId],
    enabled: !!businessId,
    queryFn: async () => {
      const result = await customFetch<{ entries: ActivityEntry[] }>('/api/owner/activity', {
        responseType: 'json',
        headers: businessHeaders(businessId),
      });
      return result.entries ?? [];
    },
  });

  const refreshOwnerData = () => {
    void queryClient.invalidateQueries({ queryKey: ['mobile-owner-workers', businessId] });
    void queryClient.invalidateQueries({ queryKey: ['mobile-owner-activity', businessId] });
  };
  const inviteMutation = useMutation({
    mutationFn: (payload: { email: string; partyIds: string[]; adjustmentPartyIds: string[] }) =>
      customFetch<Worker>('/api/owner/workers', {
        method: 'POST',
        responseType: 'json',
        headers: businessHeaders(businessId),
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      refreshOwnerData();
      setEmail('');
      setSelectedParty(null);
      setInvitePartyIds([]);
      setInviteAdjustmentPartyIds([]);
    },
    onError: (error: Error) => Alert.alert('সমস্যা হয়েছে', error.message),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { partyIds?: string[]; adjustmentPartyIds?: string[]; status?: 'suspended' } }) =>
      customFetch<Partial<Worker>>(`/api/owner/workers/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        responseType: 'json',
        headers: businessHeaders(businessId),
        body: JSON.stringify(payload),
      }),
    onSuccess: refreshOwnerData,
    onError: (error: Error) => Alert.alert('সমস্যা হয়েছে', error.message),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => customFetch<void>(`/api/owner/workers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: businessHeaders(businessId),
    }),
    onSuccess: (_, id) => {
      if (expandedWorkerId === id) setExpandedWorkerId(null);
      refreshOwnerData();
    },
    onError: (error: Error) => Alert.alert('মুছতে সমস্যা হয়েছে', error.message),
  });

  const parties = partiesQuery.data ?? [];
  const workers = workersQuery.data ?? [];
  const filteredParties = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return parties.filter((party) => !query || party.name.toLocaleLowerCase().includes(query));
  }, [parties, search]);

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingTop: Platform.OS === 'web' ? 67 : insets.top + 8,
      paddingHorizontal: 16,
      paddingBottom: 14,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.primary,
    },
    backButton: { padding: 8, marginRight: 8 },
    headerTitle: { color: colors.primaryForeground, fontFamily: 'Inter_700Bold', fontSize: 19 },
    headerSub: { color: colors.primaryForeground, opacity: 0.72, fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
    content: { padding: 16, paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 24 },
    sectionTitle: { color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 16, marginBottom: 4 },
    sectionHint: { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 12, marginBottom: 12 },
    ownerNote: {
      backgroundColor: colors.muted,
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
      borderRadius: colors.radius,
      padding: 12,
      marginBottom: 16,
    },
    ownerNoteText: { color: colors.foreground, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: colors.radius,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      height: 46,
      marginBottom: 10,
    },
    searchInput: { flex: 1, color: colors.foreground, fontFamily: 'Inter_400Regular', fontSize: 14, marginLeft: 9 },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 8,
      overflow: 'hidden',
    },
    partyRow: { flexDirection: 'row', alignItems: 'center', padding: 13 },
    avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
    partyName: { color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
    partyRole: { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
    partyCount: { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 3 },
    section: { marginTop: 24 },
    workerIdentity: { color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 14, flex: 1 },
    chip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20 },
    chipText: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
    metadata: { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 4 },
    workerActions: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, padding: 12 },
    actionText: { color: colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 12 },
    assignmentRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
    assignmentText: { flex: 1, color: colors.foreground, fontFamily: 'Inter_500Medium', fontSize: 13 },
    permissionHeader: { color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: 12, marginBottom: 5 },
    permissionHint: { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 12, marginBottom: 8 },
    checkboxRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, gap: 10 },
    checkboxText: { color: colors.foreground, flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13 },
    empty: { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'center', padding: 20, fontSize: 13 },
    modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
    modalCard: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      padding: 20,
      paddingBottom: Platform.OS === 'web' ? 24 : insets.bottom + 18,
    },
    modalTitle: { color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 18, marginBottom: 5 },
    modalHint: { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 12, marginBottom: 16 },
    emailInput: {
      height: 48,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      paddingHorizontal: 13,
      color: colors.foreground,
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
    },
    inviteButton: { backgroundColor: colors.primary, padding: 15, borderRadius: colors.radius, alignItems: 'center', marginTop: 14 },
    inviteText: { color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  });

  if (identity?.role !== 'owner') return null;

  function inviteSelectedParty() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!selectedParty || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      Alert.alert('ইমেইল যাচাই করুন', 'একটি বৈধ ইমেইল ঠিকানা লিখুন।');
      return;
    }
    if (invitePartyIds.length === 0) {
      Alert.alert('খাতা বেছে নিন', 'অন্তত একটি খাতার অ্যাক্সেস দিন।');
      return;
    }
    inviteMutation.mutate({
      email: normalizedEmail,
      partyIds: invitePartyIds,
      adjustmentPartyIds: inviteAdjustmentPartyIds.filter((id) => invitePartyIds.includes(id)),
    });
  }

  function openWorker(worker: Worker) {
    if (expandedWorkerId === worker.id) {
      setExpandedWorkerId(null);
      return;
    }
    setDraftPartyIds(worker.partyIds);
    setDraftAdjustmentIds(worker.adjustmentPartyIds ?? []);
    setWorkerSearch('');
    setExpandedWorkerId(worker.id);
  }

  function toggleWorkerParty(partyId: string) {
    if (draftPartyIds.includes(partyId)) {
      setDraftPartyIds((ids) => ids.filter((id) => id !== partyId));
      setDraftAdjustmentIds((ids) => ids.filter((id) => id !== partyId));
    } else {
      setDraftPartyIds((ids) => [...ids, partyId]);
    }
  }

  function toggleAdjustmentParty(partyId: string) {
    if (!draftPartyIds.includes(partyId)) return;
    setDraftAdjustmentIds((ids) => ids.includes(partyId) ? ids.filter((id) => id !== partyId) : [...ids, partyId]);
  }

  function saveWorkerPermissions(worker: Worker) {
    if (partiesQuery.isLoading || partiesQuery.isError) return;
    updateMutation.mutate({
      id: worker.id,
      payload: { partyIds: draftPartyIds, adjustmentPartyIds: draftAdjustmentIds.filter((id) => draftPartyIds.includes(id)) },
    }, {
      onSuccess: () => {
        setExpandedWorkerId(null);
        Alert.alert('সেভ হয়েছে', 'নির্বাচিত খাতা ও অ্যাডজাস্টমেন্টের অনুমতি সেভ হয়েছে।');
      },
    });
  }

  function revokeWorker(worker: Worker) {
    Alert.alert('অ্যাক্সেস বন্ধ করবেন?', `${worker.identity}-এর অ্যাক্সেস বন্ধ করা হবে।`, [
      { text: 'বাতিল', style: 'cancel' },
      {
        text: worker.status === 'pending' ? 'আমন্ত্রণ বাতিল' : 'অ্যাক্সেস বন্ধ',
        style: 'destructive',
        onPress: () => updateMutation.mutate({ id: worker.id, payload: { status: 'suspended' } }),
      },
    ]);
  }

  function deleteWorker(worker: Worker) {
    Alert.alert(
      'স্টাফ মুছে ফেলবেন?',
      `${worker.identity}-এর ${worker.status === 'pending' ? 'পেন্ডিং আমন্ত্রণ' : 'স্টাফ অ্যাক্সেস'} মুছে যাবে। আগের লেনদেনের ইতিহাস থাকবে; চাইলে পরে আবার আমন্ত্রণ জানাতে পারবেন।`,
      [
        { text: 'বাতিল', style: 'cancel' },
        { text: 'মুছে ফেলুন', style: 'destructive', onPress: () => deleteMutation.mutate(worker.id) },
      ],
    );
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity testID="access-back" onPress={() => router.back()} style={s.backButton} accessibilityLabel="পেছনে">
          <Feather name="arrow-left" size={21} color={colors.primaryForeground} />
        </TouchableOpacity>
        <View>
          <Text style={s.headerTitle}>খাতার অ্যাক্সেস</Text>
          <Text style={s.headerSub}>কাস্টমার ও সাপ্লায়ার পারমিশন</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={s.sectionTitle}>পার্টি বেছে নিন</Text>
        <Text style={s.sectionHint}>একটি খাতা খুঁজে স্টাফের ইমেইল পরিচয়কে অ্যাক্সেস দিন</Text>
        <View style={s.searchBox}>
          <Feather name="search" size={17} color={colors.mutedForeground} />
          <TextInput
            testID="access-party-search"
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="কাস্টমার বা সাপ্লায়ার খুঁজুন"
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="search"
          />
        </View>
        <View style={s.ownerNote}>
          <Text style={s.ownerNoteText}>
            অ্যাক্সেস দেওয়ার পর স্টাফকে অ্যাপের সাইন-ইন পথ নিজে জানান। কোনো আমন্ত্রণ ইমেইল পাঠানো হয় না; একই যাচাইকৃত ইমেইল দিয়ে সাইন ইন করতে হবে। নতুন অ্যাকাউন্টের জন্য ওয়েব সাইন-আপ ব্যবহার করুন—মোবাইলে সাইন-আপ নেই।
          </Text>
        </View>
        {partiesQuery.isLoading ? <ActivityIndicator color={colors.primary} style={{ padding: 20 }} /> :
          partiesQuery.isError ? <Text style={s.empty}>খাতার তালিকা লোড করা যায়নি: {messageFor(partiesQuery.error)}</Text> :
          filteredParties.length === 0 ? <Text style={s.empty}>কোনো খাতা পাওয়া যায়নি</Text> :
            filteredParties.map((party) => {
              const assignedCount = workers.filter((worker) => worker.partyIds.includes(party.id) && worker.status !== 'suspended').length;
              const accent = party.role === 'CUSTOMER' ? colors.willGet : colors.willGive;
              return (
                <TouchableOpacity
                  key={party.id}
                  testID={`access-party-${party.id}`}
                  style={s.card}
                  activeOpacity={0.72}
                  onPress={() => {
                    setSelectedParty(party);
                    setEmail('');
                    setInvitePartyIds([party.id]);
                    setInviteAdjustmentPartyIds([]);
                  }}
                >
                  <View style={s.partyRow}>
                    <View style={[s.avatar, { backgroundColor: party.role === 'CUSTOMER' ? colors.willGetBg : colors.willGiveBg }]}>
                      <Feather name={party.role === 'CUSTOMER' ? 'user' : 'truck'} size={17} color={accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.partyName} numberOfLines={1}>{party.name}</Text>
                      <Text style={s.partyRole}>{party.role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'} খাতা</Text>
                      <Text style={s.partyCount}>{assignedCount} জন স্টাফের অ্যাক্সেস</Text>
                    </View>
                    <Feather name="plus-circle" size={21} color={colors.primary} />
                  </View>
                </TouchableOpacity>
              );
            })}

        <View style={s.section}>
          <Text style={s.sectionTitle}>স্টাফ ও অ্যাক্সেস</Text>
          <Text style={s.sectionHint}>খাতা ও অ্যাডজাস্টমেন্টের অনুমতি পরিবর্তন করুন, অথবা স্টাফ মুছে ফেলুন</Text>
          {workersQuery.isLoading ? <ActivityIndicator color={colors.primary} style={{ padding: 20 }} /> :
            workersQuery.isError ? <Text style={s.empty}>স্টাফ তালিকা লোড করা যায়নি: {messageFor(workersQuery.error)}</Text> :
            workers.length === 0 ? <Text style={[s.card, s.empty]}>এখনো কোনো স্টাফ যুক্ত নেই</Text> :
              workers.map((worker) => {
                const expanded = expandedWorkerId === worker.id;
                const statusLabel = worker.status === 'active' ? 'সক্রিয়' : worker.status === 'pending' ? 'পেন্ডিং' : 'বন্ধ';
                const statusColor = worker.status === 'active' ? colors.willGet : worker.status === 'pending' ? colors.mutedForeground : colors.destructive;
                return (
                  <View key={worker.id} style={s.card}>
                    <TouchableOpacity
                      style={s.partyRow}
                      activeOpacity={0.7}
                       onPress={() => openWorker(worker)}
                    >
                      <View style={[s.avatar, { backgroundColor: colors.muted }]}>
                        <Feather name="mail" size={17} color={colors.mutedForeground} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.workerIdentity} numberOfLines={1}>{worker.identity}</Text>
                        <Text style={s.metadata}>{worker.partyIds.length}টি খাতার অ্যাক্সেস</Text>
                      </View>
                      <View style={[s.chip, { backgroundColor: `${statusColor}18` }]}>
                        <Text style={[s.chipText, { color: statusColor }]}>{statusLabel}</Text>
                      </View>
                      <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} style={{ marginLeft: 8 }} />
                    </TouchableOpacity>
                    {expanded && (
                      <>
                        {(formatDate(worker.lastLogin) || formatDate(worker.lastLogout)) ? (
                          <View style={{ paddingHorizontal: 13, paddingBottom: 10 }}>
                            {formatDate(worker.lastLogin) ? <Text style={s.metadata}>শেষ লগইন: {formatDate(worker.lastLogin)}</Text> : null}
                            {formatDate(worker.lastLogout) ? <Text style={s.metadata}>শেষ সাইন আউট: {formatDate(worker.lastLogout)}</Text> : null}
                          </View>
                        ) : null}
                         <Text style={[s.permissionHint, { paddingHorizontal: 12 }]}>প্রথমে খাতা অ্যাক্সেস দিন, তারপর শুধু অনুমোদিত খাতায় অ্যাডজাস্টমেন্ট বেছে নিন। উৎস ও গন্তব্য উভয় খাতায় অনুমতি লাগবে।</Text>
                         <TextInput
                           testID={`access-worker-search-${worker.id}`}
                           style={[s.emailInput, { marginHorizontal: 12, marginBottom: 10 }]}
                           value={workerSearch}
                           onChangeText={setWorkerSearch}
                           placeholder="কাস্টমার/সাপ্লায়ার খুঁজুন..."
                           placeholderTextColor={colors.mutedForeground}
                         />
                         {partiesQuery.isLoading ? <ActivityIndicator color={colors.primary} /> :
                           partiesQuery.isError ? <Text style={s.empty}>খাতা লোড করা যায়নি: {messageFor(partiesQuery.error)}</Text> :
                             parties.filter((party) => party.name.toLocaleLowerCase().includes(workerSearch.trim().toLocaleLowerCase())).map((party) => {
                               const assigned = draftPartyIds.includes(party.id);
                               const allowed = draftAdjustmentIds.includes(party.id);
                               return (
                                 <View key={party.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 7 }}>
                                   <Text style={[s.assignmentText, { paddingHorizontal: 12 }]}>{party.name} · {party.role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'}</Text>
                                   <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                                     <TouchableOpacity
                                       testID={`access-party-${worker.id}-${party.id}`}
                                       style={[s.assignmentRow, { flex: 1, minWidth: 125, borderTopWidth: 0 }]}
                                       disabled={updateMutation.isPending}
                                       onPress={() => toggleWorkerParty(party.id)}
                                     >
                                       <Feather name={assigned ? 'check-square' : 'square'} size={21} color={assigned ? colors.primary : colors.mutedForeground} />
                                       <Text style={[s.assignmentText, { marginLeft: 7 }]}>খাতা অ্যাক্সেস</Text>
                                     </TouchableOpacity>
                                     <TouchableOpacity
                                       testID={`access-adjustment-${worker.id}-${party.id}`}
                                       style={[s.assignmentRow, { flex: 1, minWidth: 130, borderTopWidth: 0, opacity: assigned ? 1 : 0.5 }]}
                                       disabled={!assigned || updateMutation.isPending}
                                       onPress={() => toggleAdjustmentParty(party.id)}
                                     >
                                       <Feather name={allowed ? 'check-square' : 'square'} size={21} color={allowed ? colors.primary : colors.mutedForeground} />
                                       <Text style={[s.assignmentText, { marginLeft: 7 }]}>অ্যাডজাস্টমেন্ট</Text>
                                     </TouchableOpacity>
                                   </View>
                                 </View>
                               );
                             })}
                         <TouchableOpacity
                           testID={`access-save-${worker.id}`}
                           style={[s.inviteButton, { marginHorizontal: 12, marginBottom: 12 }]}
                           disabled={updateMutation.isPending || partiesQuery.isLoading || partiesQuery.isError}
                           onPress={() => saveWorkerPermissions(worker)}
                         >
                           <Text style={s.inviteText}>{updateMutation.isPending ? 'সেভ হচ্ছে...' : 'অনুমতি সেভ করুন'}</Text>
                         </TouchableOpacity>
                        {worker.status !== 'suspended' && (
                          <View style={s.workerActions}>
                            <TouchableOpacity testID={`access-revoke-${worker.id}`} disabled={updateMutation.isPending || deleteMutation.isPending} onPress={() => revokeWorker(worker)}>
                              <Text style={[s.actionText, { color: colors.destructive }]}>{worker.status === 'pending' ? 'আমন্ত্রণ বাতিল' : 'অ্যাক্সেস বন্ধ করুন'}</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                        <View style={s.workerActions}>
                          <TouchableOpacity testID={`access-delete-${worker.id}`} disabled={updateMutation.isPending || deleteMutation.isPending} onPress={() => deleteWorker(worker)}>
                            <Text style={[s.actionText, { color: colors.destructive }]}>স্টাফ মুছে ফেলুন</Text>
                          </TouchableOpacity>
                        </View>
                      </>
                    )}
                  </View>
                );
              })}
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>সাম্প্রতিক কার্যকলাপ</Text>
          <Text style={s.sectionHint}>স্টাফের খাতায় করা সাম্প্রতিক পরিবর্তন</Text>
          {activityQuery.isLoading ? <ActivityIndicator color={colors.primary} style={{ padding: 20 }} /> :
            activityQuery.isError ? <Text style={s.empty}>কার্যকলাপ লোড করা যায়নি: {messageFor(activityQuery.error)}</Text> :
            activityQuery.data?.length ? activityQuery.data.map((entry) => (
              <View key={entry.id} style={[s.card, { padding: 13 }]}>
                <Text style={s.partyName}>{entry.partyName} · {entry.partyRole === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'}</Text>
                <Text style={s.metadata}>
                  {entry.actorIdentity} · {entry.type}{entry.amount === null ? '' : ` · ৳${entry.amount}`}
                </Text>
                {entry.description ? <Text style={s.metadata}>{entry.description}</Text> : null}
                <Text style={s.metadata}>{formatDate(entry.createdAt) ?? entry.createdAt}</Text>
              </View>
            )) : <Text style={[s.card, s.empty]}>এখনো কোনো কার্যকলাপ নেই</Text>}
        </View>
      </ScrollView>

      <Modal visible={!!selectedParty} transparent animationType="slide" onRequestClose={() => setSelectedParty(null)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <TouchableOpacity onPress={() => setSelectedParty(null)} style={{ alignSelf: 'flex-end', padding: 4 }} accessibilityLabel="বন্ধ করুন">
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
            <Text style={s.modalTitle}>খাতায় স্টাফ যুক্ত করুন</Text>
            <Text style={s.modalHint}>
              {selectedParty?.name} · {selectedParty?.role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'} — এই ইমেইল পরিচয়কে অ্যাক্সেস দিন।
              {'\n\n'}এখান থেকে কোনো ইমেইল পাঠানো হয় না। স্টাফকে অ্যাপের সাইন-ইন পথ নিজে জানান এবং একই যাচাইকৃত ইমেইল দিয়ে সাইন ইন করতে বলুন। অ্যাকাউন্ট না থাকলে ওয়েবে সাইন-আপ করতে হবে; মোবাইলে সাইন-আপ এখনো নেই।
            </Text>
            <TextInput
              testID="access-invite-email"
              style={s.emailInput}
              value={email}
              onChangeText={setEmail}
              placeholder="email@example.com"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="send"
              onSubmitEditing={inviteSelectedParty}
            />
            <ScrollView style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              <Text style={s.permissionHeader}>খাতার অ্যাক্সেস</Text>
              {parties.map((party) => {
                const checked = invitePartyIds.includes(party.id);
                return (
                  <TouchableOpacity key={party.id} testID={`access-invite-party-${party.id}`} style={s.checkboxRow} onPress={() => {
                    setInvitePartyIds((ids) => checked ? ids.filter((id) => id !== party.id) : [...ids, party.id]);
                    if (checked) setInviteAdjustmentPartyIds((ids) => ids.filter((id) => id !== party.id));
                  }}>
                    <Feather name={checked ? 'check-square' : 'square'} size={19} color={checked ? colors.primary : colors.mutedForeground} />
                    <Text style={s.checkboxText}>{party.name}</Text>
                  </TouchableOpacity>
                );
              })}
              <Text style={s.permissionHeader}>অ্যাডজাস্টমেন্টের অনুমতি</Text>
              <Text style={s.permissionHint}>শুধু অ্যাক্সেস দেওয়া খাতাগুলো থেকে বেছে নিন। অ্যাডজাস্টমেন্টের দুই খাতাতেই অনুমতি লাগবে।</Text>
              {parties.filter((party) => invitePartyIds.includes(party.id)).map((party) => {
                const checked = inviteAdjustmentPartyIds.includes(party.id);
                return (
                  <TouchableOpacity key={party.id} testID={`access-invite-adjustment-${party.id}`} style={s.checkboxRow} onPress={() =>
                    setInviteAdjustmentPartyIds((ids) => checked ? ids.filter((id) => id !== party.id) : [...ids, party.id])
                  }>
                    <Feather name={checked ? 'check-square' : 'square'} size={19} color={checked ? colors.primary : colors.mutedForeground} />
                    <Text style={s.checkboxText}>{party.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              testID="access-invite-submit"
              style={[s.inviteButton, inviteMutation.isPending && { opacity: 0.65 }]}
              disabled={inviteMutation.isPending}
              onPress={inviteSelectedParty}
            >
              {inviteMutation.isPending ? <ActivityIndicator color={colors.primaryForeground} /> :
                <Text style={s.inviteText}>এই ইমেইল পরিচয়কে অ্যাক্সেস দিন</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}