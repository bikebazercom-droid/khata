import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  getGetOwnerActivityQueryKey,
  getGetOwnerPartiesQueryKey,
  getGetOwnerWorkersQueryKey,
  useCreateOwnerWorker,
  useDeleteOwnerWorker,
  useGetOwnerActivity,
  useGetOwnerParties,
  useGetOwnerWorkers,
  useUpdateOwnerWorker,
} from '@workspace/api-client-react';
import type {
  OwnerActivityEntry as ApiOwnerActivityEntry,
  OwnerParty as ApiOwnerParty,
  OwnerWorker as ApiOwnerWorker,
} from '@workspace/api-client-react';
import { AppButton, Card, EmptyState, Field, IconButton, LoadingState, Notice, PageHeader } from '@/components/Kit';
import { useAuth } from '@/contexts/AuthContext';
import { useBusinessScope } from '@/contexts/BusinessScopeContext';
import { useColors } from '@/hooks/useColors';
import { errorMessage, formatMoney } from '@/lib/domain';
import { isValidWorkerIdentity, nextWorkerStatus, toggleAccessId, workerStatusLabel } from '@/lib/ownerAccess';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';

type Tab = 'parties' | 'staff' | 'activity';
type OwnerWorker = ApiOwnerWorker;
type OwnerParty = ApiOwnerParty;
type OwnerActivityEntry = ApiOwnerActivityEntry;

const workerQueryKey = (businessId: string | null) =>
  [...getGetOwnerWorkersQueryKey(), businessId ?? ''] as const;
const partiesQueryKey = (businessId: string | null) =>
  [...getGetOwnerPartiesQueryKey(), businessId ?? ''] as const;
const activityQueryKey = (businessId: string | null) =>
  [...getGetOwnerActivityQueryKey(), businessId ?? ''] as const;

function invalidateOwnerAccess(queryClient: QueryClient, businessId: string | null) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: workerQueryKey(businessId) }),
    queryClient.invalidateQueries({ queryKey: activityQueryKey(businessId) }),
  ]);
}

export default function OwnerAccessScreen() {
  const colors = useColors();
  const { identity } = useAuth();
  const { selectedBusinessId } = useBusinessScope();
  const [activeTab, setActiveTab] = useState<Tab>('parties');
  const [partySearch, setPartySearch] = useState('');
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const isOwner = identity?.role === 'owner';
  const businessReady = !!selectedBusinessId;

  const workersQuery = useGetOwnerWorkers({
    query: {
      enabled: isOwner && businessReady,
      queryKey: workerQueryKey(selectedBusinessId),
    },
  });
  const partiesQuery = useGetOwnerParties({
    query: {
      enabled: isOwner && businessReady,
      queryKey: partiesQueryKey(selectedBusinessId),
      staleTime: 0,
      refetchOnMount: 'always',
    },
  });
  const activityQuery = useGetOwnerActivity({
    query: {
      enabled: isOwner && businessReady && activeTab === 'activity',
      queryKey: activityQueryKey(selectedBusinessId),
      staleTime: 60_000,
    },
  });

  const workers = workersQuery.data?.workers ?? [];
  const parties = partiesQuery.data ?? [];
  const activity = activityQuery.data?.entries ?? [];
  const selectedParty = parties.find((party) => party.id === selectedPartyId);
  const selectedWorker = workers.find((worker) => worker.id === selectedWorkerId);
  const filteredParties = useMemo(
    () => parties.filter((party) => party.name.toLowerCase().includes(partySearch.trim().toLowerCase())),
    [parties, partySearch],
  );
  const refreshing = workersQuery.isRefetching || partiesQuery.isRefetching || activityQuery.isRefetching;
  const refetchAll = () => {
    if (!isOwner || !businessReady) return;
    void Promise.all([workersQuery.refetch(), partiesQuery.refetch(), activityQuery.refetch()]);
  };

  if (!isOwner) {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: colors.background }]}>
        <View style={styles.pageContent}>
          <PageHeader title="খাতা ও অ্যাক্সেস" onBack={() => router.back()} />
          <Notice message="এই পৃষ্ঠা শুধু ব্যবসার মালিক ব্যবহার করতে পারবেন।" />
          <AppButton title="ফিরে যান" icon="arrow-left" variant="outline" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.background, borderBottomColor: colors.border }, Platform.OS === 'web' ? styles.webHeader : null]}>
        <PageHeader
          title="খাতা ও অ্যাক্সেস"
          subtitle="আপনার খাতার কন্ট্রোল ও অ্যাক্টিভিটি"
          onBack={() => router.back()}
          right={activeTab === 'staff' && businessReady ? (
            <IconButton
              icon="plus"
              label="নতুন স্টাফ যোগ করুন"
              onPress={() => setInviteOpen(true)}
              testID="owner-access-add"
              color={colors.primary}
            />
          ) : null}
        />
        <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
          <AccessTab label="খাতা অ্যাক্সেস" value="parties" activeTab={activeTab} onPress={setActiveTab} />
          <AccessTab label="স্টাফ তালিকা" value="staff" activeTab={activeTab} onPress={setActiveTab} />
          <AccessTab label="অ্যাক্টিভিটি" value="activity" activeTab={activeTab} onPress={setActiveTab} />
        </View>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetchAll} tintColor={colors.primary} />}
        contentContainerStyle={[styles.content, Platform.OS === 'web' ? styles.webContent : null]}
      >
        {!businessReady ? (
          <Notice message="নির্বাচিত ব্যবসার তথ্য প্রস্তুত হলে স্টাফ অ্যাক্সেস দেখানো হবে।" tone="info" />
        ) : activeTab === 'parties' ? (
          <PartyAccessList
            parties={filteredParties}
            workers={workers}
            isLoading={partiesQuery.isLoading || (partiesQuery.isFetching && parties.length === 0)}
            isError={partiesQuery.isError}
            onRetry={() => void partiesQuery.refetch()}
            search={partySearch}
            onSearchChange={setPartySearch}
            onSelectParty={(party) => setSelectedPartyId(party.id)}
          />
        ) : activeTab === 'staff' ? (
          <WorkerList
            workers={workers}
            isLoading={workersQuery.isLoading}
            isError={workersQuery.isError}
            onRetry={() => void workersQuery.refetch()}
            onAdd={() => setInviteOpen(true)}
            onSelect={(worker) => setSelectedWorkerId(worker.id)}
          />
        ) : (
          <ActivityList
            entries={activity}
            isLoading={activityQuery.isLoading}
            isError={activityQuery.isError}
            onRetry={() => void activityQuery.refetch()}
          />
        )}
      </ScrollView>

      {inviteOpen ? (
        <InviteWorkerSheet
          parties={parties}
          partiesPending={partiesQuery.isLoading || (partiesQuery.isFetching && parties.length === 0)}
          partiesError={partiesQuery.isError}
          onRetryParties={() => void partiesQuery.refetch()}
          onClose={() => setInviteOpen(false)}
        />
      ) : null}
      {selectedWorker ? (
        <WorkerDetailSheet
          key={selectedWorker.id}
          worker={selectedWorker}
          parties={parties}
          partiesPending={partiesQuery.isLoading || (partiesQuery.isFetching && parties.length === 0)}
          partiesError={partiesQuery.isError}
          onRetryParties={() => void partiesQuery.refetch()}
          onClose={() => setSelectedWorkerId(null)}
        />
      ) : null}
      {selectedParty ? (
        <PartyDetailSheet
          key={selectedParty.id}
          party={selectedParty}
          parties={parties}
          workers={workers}
          partiesPending={partiesQuery.isLoading || (partiesQuery.isFetching && parties.length === 0)}
          partiesError={partiesQuery.isError}
          onRetryParties={() => void partiesQuery.refetch()}
          onClose={() => setSelectedPartyId(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

function AccessTab({
  label,
  value,
  activeTab,
  onPress,
}: {
  label: string;
  value: Tab;
  activeTab: Tab;
  onPress: (tab: Tab) => void;
}) {
  const colors = useColors();
  const active = value === activeTab;
  return (
    <Pressable
      onPress={() => onPress(value)}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      testID={`owner-access-tab-${value}`}
      style={[styles.tab, { borderBottomColor: active ? colors.primary : 'transparent' }]}
    >
      <Text style={[styles.tabText, { color: active ? colors.primary : colors.mutedForeground }]}>{label}</Text>
    </Pressable>
  );
}

function PartyAccessList({
  parties,
  workers,
  isLoading,
  isError,
  onRetry,
  search,
  onSearchChange,
  onSelectParty,
}: {
  parties: OwnerParty[];
  workers: OwnerWorker[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  onSelectParty: (party: OwnerParty) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <View style={[styles.searchField, { backgroundColor: colors.card, borderColor: colors.input }]}>
        <Feather name="search" size={17} color={colors.mutedForeground} />
        <TextInput
          value={search}
          onChangeText={onSearchChange}
          placeholder="কাস্টমার/সাপ্লায়ার খুঁজুন..."
          placeholderTextColor={colors.mutedForeground}
          accessibilityLabel="কাস্টমার বা সাপ্লায়ার খুঁজুন"
          testID="owner-access-party-search"
          style={[styles.searchInput, { color: colors.foreground }]}
        />
        {search ? <IconButton icon="x" label="খোঁজা মুছুন" onPress={() => onSearchChange('')} /> : null}
      </View>
      {isLoading ? <LoadingState label="খাতার তথ্য লোড হচ্ছে…" /> : null}
      {isError ? <Notice message="খাতার তথ্য লোড করতে সমস্যা হয়েছে।" onRetry={onRetry} /> : null}
      {!isLoading && !isError && parties.length === 0 ? (
        <EmptyState
          title={search ? 'কোনো খাতা পাওয়া যায়নি' : 'কোনো কাস্টমার/সাপ্লায়ার নেই'}
          description={search ? 'অন্য নামে খুঁজে দেখুন।' : 'খাতা তৈরি হলে এখানে স্টাফ অ্যাক্সেস পরিচালনা করতে পারবেন।'}
          icon="book-open"
        />
      ) : null}
      {!isLoading && !isError ? parties.map((party) => {
        const assignedWorkers = workers.filter((worker) => worker.partyIds.includes(party.id));
        return (
          <Pressable
            key={party.id}
            onPress={() => onSelectParty(party)}
            accessibilityRole="button"
            testID={`owner-access-party-${party.id}`}
            style={({ pressed }) => [
              styles.partyCard,
              { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <View style={styles.row}>
              <View style={[styles.partyAvatar, { backgroundColor: party.role === 'CUSTOMER' ? `${colors.success}18` : `${colors.destructive}18` }]}>
                <Text style={{ color: party.role === 'CUSTOMER' ? colors.success : colors.destructive, fontSize: 16, fontWeight: '800' }}>
                  {party.name.trim().slice(0, 1) || 'খ'}
                </Text>
              </View>
              <View style={styles.grow}>
                <Text style={[styles.partyName, { color: colors.foreground }]}>{party.name}</Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {party.role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'} · {party.id.slice(-4)}
                </Text>
              </View>
              <View style={[styles.countBadge, { backgroundColor: colors.secondary }]}>
                <Feather name="users" size={14} color={colors.primary} />
                <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>{assignedWorkers.length}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </View>
            <View style={[styles.assignedLine, { borderTopColor: colors.border }]}>
              {assignedWorkers.length === 0 ? (
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>কাউকে অ্যাক্সেস দেওয়া নেই</Text>
              ) : assignedWorkers.map((worker) => (
                <StatusPill key={worker.id} status={worker.status} label={worker.identity} />
              ))}
            </View>
          </Pressable>
        );
      }) : null}
    </View>
  );
}

function WorkerList({
  workers,
  isLoading,
  isError,
  onRetry,
  onAdd,
  onSelect,
}: {
  workers: OwnerWorker[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onAdd: () => void;
  onSelect: (worker: OwnerWorker) => void;
}) {
  const colors = useColors();
  if (isLoading) return <LoadingState label="স্টাফ তালিকা লোড হচ্ছে…" />;
  if (isError) return <Notice message="স্টাফ তালিকা লোড করতে সমস্যা হয়েছে।" onRetry={onRetry} />;
  if (workers.length === 0) {
    return (
      <View style={styles.section}>
        <EmptyState title="কোনো স্টাফ যুক্ত নেই" description="নতুন স্টাফ যুক্ত করে খাতার অ্যাক্সেস দিন।" icon="shield" />
        <AppButton title="স্টাফ যোগ করুন" icon="user-plus" onPress={onAdd} testID="owner-access-empty-add" />
      </View>
    );
  }
  return (
    <View style={styles.section}>
      {workers.map((worker) => (
        <Pressable
          key={worker.id}
          onPress={() => onSelect(worker)}
          accessibilityRole="button"
          testID={`owner-access-worker-${worker.id}`}
          style={({ pressed }) => [
            styles.workerCard,
            { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.86 : 1 },
          ]}
        >
          <View style={styles.row}>
            <View style={[styles.workerAvatar, { backgroundColor: colors.secondary }]}>
              <Feather name={worker.identity.includes('@') ? 'mail' : 'phone'} size={17} color={colors.primary} />
            </View>
            <View style={styles.grow}>
              <Text style={[styles.partyName, { color: colors.foreground }]} numberOfLines={1}>{worker.identity}</Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {worker.partyIds.length.toLocaleString('bn-BD')} টি খাতার অ্যাক্সেস
              </Text>
            </View>
            <StatusPill status={worker.status} label={workerStatusLabel(worker.status)} />
          </View>
          <View style={[styles.workerMeta, { borderTopColor: colors.border }]}>
            {worker.lastLogin ? <Text style={[styles.meta, { color: colors.mutedForeground }]}>সর্বশেষ লগইন: {formatTimestamp(worker.lastLogin)}</Text> : null}
            {worker.lastLogout ? <Text style={[styles.meta, { color: colors.mutedForeground }]}>সর্বশেষ লগআউট: {formatTimestamp(worker.lastLogout)}</Text> : null}
            {worker.invitedAt && worker.status === 'pending' ? <Text style={[styles.meta, { color: colors.mutedForeground }]}>আমন্ত্রণ: {formatDate(worker.invitedAt)}</Text> : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function ActivityList({
  entries,
  isLoading,
  isError,
  onRetry,
}: {
  entries: OwnerActivityEntry[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const colors = useColors();
  if (isLoading) return <LoadingState label="অ্যাক্টিভিটি লোড হচ্ছে…" />;
  if (isError) return <Notice message="অ্যাক্টিভিটি লোড করতে সমস্যা হয়েছে।" onRetry={onRetry} />;
  if (entries.length === 0) {
    return <EmptyState title="কোনো অ্যাক্টিভিটি নেই" description="স্টাফরা লেনদেন করলে সাম্প্রতিক কাজ এখানে দেখা যাবে।" icon="clock" />;
  }
  return (
    <View style={styles.section}>
      {entries.map((entry) => (
        <Card key={entry.id} style={styles.activityCard}>
          <View style={styles.activityHeader}>
            <Text style={[styles.activityTitle, { color: colors.foreground, flex: 1 }]}>
              {entry.description || 'অ্যাক্টিভিটি'}
            </Text>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>{relativeTime(entry.createdAt)}</Text>
          </View>
          <Text style={[styles.activityMeta, { color: colors.mutedForeground }]}>
            খাতা: <Text style={[styles.activityStrong, { color: colors.foreground }]}>{entry.partyName}</Text>
          </Text>
          <Text style={[styles.activityMeta, { color: colors.mutedForeground }]}>
            ব্যবহারকারী: <Text style={[styles.activityStrong, { color: colors.foreground }]}>{entry.actorIdentity}</Text>
          </Text>
          {entry.amount != null ? (
            <Text style={[styles.activityMeta, { color: colors.mutedForeground }]}>
              অ্যামাউন্ট: <Text style={[styles.activityStrong, { color: colors.foreground }]}>{formatMoney(entry.amount)}</Text>
            </Text>
          ) : null}
        </Card>
      ))}
    </View>
  );
}

function StatusPill({ status, label }: { status: OwnerWorker['status']; label: string }) {
  const colors = useColors();
  const color = status === 'active' ? colors.success : status === 'pending' ? colors.accent : colors.destructive;
  return (
    <View style={[styles.statusPill, { backgroundColor: `${color}18` }]}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusText, { color }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function PermissionRow({
  party,
  hasLedgerAccess,
  hasAdjustmentAccess,
  onToggleLedger,
  onToggleAdjustment,
  disabled = false,
  testPrefix,
}: {
  party: OwnerParty;
  hasLedgerAccess: boolean;
  hasAdjustmentAccess: boolean;
  onToggleLedger: () => void;
  onToggleAdjustment: () => void;
  disabled?: boolean;
  testPrefix: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.permissionRow, { backgroundColor: colors.muted, borderColor: colors.border }]}>
      <Text style={[styles.permissionPartyName, { color: colors.foreground }]}>
        {party.name} <Text style={{ color: colors.mutedForeground, fontWeight: '500' }}>· {party.role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'}</Text>
      </Text>
      <View style={styles.permissionControls}>
        <PermissionToggle
          label="খাতা অ্যাক্সেস"
          checked={hasLedgerAccess}
          onPress={onToggleLedger}
          disabled={disabled}
          testID={`${testPrefix}-ledger-${party.id}`}
        />
        <PermissionToggle
          label="অ্যাডজাস্টমেন্ট"
          checked={hasAdjustmentAccess}
          onPress={onToggleAdjustment}
          disabled={disabled}
          testID={`${testPrefix}-adjustment-${party.id}`}
        />
      </View>
    </View>
  );
}

function PermissionToggle({
  label,
  checked,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
  disabled: boolean;
  testID: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.permissionToggle, { opacity: disabled ? 0.5 : pressed ? 0.72 : 1 }]}
    >
      <Feather name={checked ? 'check-square' : 'square'} size={19} color={checked ? colors.primary : colors.mutedForeground} />
      <Text style={[styles.permissionLabel, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

function BottomSheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
  footer,
  testID,
}: React.PropsWithChildren<{
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: React.ReactNode;
  testID: string;
}>) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.sheetBackdrop, { backgroundColor: `${colors.foreground}80` }, Platform.OS === 'web' ? styles.webSheetBackdrop : null]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="বন্ধ করুন"
        />
        <View
          testID={testID}
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              paddingBottom: Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 12),
              maxHeight: Platform.OS === 'web' ? '86%' : '92%',
            },
          ]}
        >
          <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.mutedForeground }]} />
            <View style={styles.sheetTitleRow}>
              <View style={styles.grow}>
                <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{title}</Text>
                {subtitle ? <Text style={[styles.meta, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
              </View>
              <IconButton icon="x" label="বন্ধ করুন" onPress={onClose} />
            </View>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.sheetContent}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          {footer ? <View style={[styles.sheetFooter, { borderTopColor: colors.border }]}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

function InviteWorkerSheet({
  parties,
  partiesPending,
  partiesError,
  onRetryParties,
  onClose,
  initialPartyIds = [],
  title = 'নতুন স্টাফ যোগ করুন',
}: {
  parties: OwnerParty[];
  partiesPending: boolean;
  partiesError: boolean;
  onRetryParties: () => void;
  onClose: () => void;
  initialPartyIds?: string[];
  title?: string;
}) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { selectedBusinessId } = useBusinessScope();
  const createWorker = useCreateOwnerWorker();
  const [identity, setIdentity] = useState('');
  const [partyIds, setPartyIds] = useState<string[]>(initialPartyIds);
  const [adjustmentPartyIds, setAdjustmentPartyIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const isEmail = identity.trim().includes('@');

  const close = () => {
    setIdentity('');
    setPartyIds(initialPartyIds);
    setAdjustmentPartyIds([]);
    setError('');
    onClose();
  };

  const submit = async () => {
    setError('');
    const value = identity.trim();
    if (!isValidWorkerIdentity(value)) return;
    try {
      await createWorker.mutateAsync({
        data: {
          ...(value.includes('@') ? { email: value } : { phone: value }),
          partyIds,
          adjustmentPartyIds,
        },
      });
      await invalidateOwnerAccess(queryClient, selectedBusinessId);
      Alert.alert('স্টাফ যোগ করা হয়েছে', 'অ্যাপের লিংক ও সাইন-ইন নির্দেশিকা নিজে শেয়ার করুন।');
      close();
    } catch (requestError) {
      setError(errorMessage(requestError, 'স্টাফ যোগ করতে সমস্যা হয়েছে।'));
    }
  };

  return (
    <BottomSheet
      visible
      title={title}
      subtitle="স্টাফের ইমেইল বা বাংলাদেশি ফোন নম্বর দিন।"
      onClose={close}
      testID="owner-access-invite-sheet"
      footer={(
        <AppButton
          title="যুক্ত করুন"
          icon="user-plus"
          onPress={() => void submit()}
          disabled={!isValidWorkerIdentity(identity) || partiesPending || partiesError}
          loading={createWorker.isPending}
          testID="owner-access-invite-submit"
        />
      )}
    >
      {error ? <Notice message={error} /> : null}
      <Field
        label="স্টাফের ইমেইল বা ফোন"
        value={identity}
        onChangeText={(value) => { setIdentity(value); setError(''); }}
        placeholder="email@example.com অথবা 01712345678"
        keyboardType={isEmail ? 'default' : 'phone-pad'}
        autoCapitalize="none"
        testID="owner-access-invite-identity"
      />
      <View style={styles.section}>
        <Text style={[styles.sectionHeading, { color: colors.foreground }]}>খাতা ও অ্যাডজাস্টমেন্টের অনুমতি</Text>
        <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
          উৎসের খাতায় অ্যাক্সেস ও অ্যাডজাস্টমেন্ট অনুমতি লাগবে। গন্তব্যে শুধু অ্যাডজাস্টমেন্ট অনুমতি দিলেও হবে; এতে গন্তব্যের খাতা দেখা যাবে না।
        </Text>
        {partiesPending ? <LoadingState label="খাতার তালিকা লোড হচ্ছে…" /> : null}
        {partiesError ? <Notice message="খাতার তালিকা লোড করা যায়নি।" onRetry={onRetryParties} /> : null}
        {!partiesPending && !partiesError && parties.length === 0 ? (
          <EmptyState title="কোনো খাতা নেই" description="স্টাফ যোগ করার আগে একটি কাস্টমার বা সাপ্লায়ার খাতা তৈরি করুন।" icon="book-open" />
        ) : null}
        {!partiesPending && !partiesError ? parties.map((party) => (
          <PermissionRow
            key={party.id}
            party={party}
            hasLedgerAccess={partyIds.includes(party.id)}
            hasAdjustmentAccess={adjustmentPartyIds.includes(party.id)}
            onToggleLedger={() => setPartyIds((ids) => toggleAccessId(ids, party.id))}
            onToggleAdjustment={() => setAdjustmentPartyIds((ids) => toggleAccessId(ids, party.id))}
            testPrefix="owner-access-invite"
          />
        )) : null}
      </View>
      <Notice
        tone="info"
        message="আপনাকে নিজে অ্যাপের লিংক ও নির্দেশিকা স্টাফের সঙ্গে শেয়ার করতে হবে। স্টাফকে ঠিক এই ইমেইল বা ফোন নম্বর দিয়ে সাইন-ইন করতে হবে; ফোনে যাচাইকরণ কোড SMS-এ যাবে।"
      />
    </BottomSheet>
  );
}

function WorkerDetailSheet({
  worker,
  parties,
  partiesPending,
  partiesError,
  onRetryParties,
  onClose,
}: {
  worker: OwnerWorker;
  parties: OwnerParty[];
  partiesPending: boolean;
  partiesError: boolean;
  onRetryParties: () => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { selectedBusinessId } = useBusinessScope();
  const updateWorker = useUpdateOwnerWorker();
  const deleteWorker = useDeleteOwnerWorker();
  const [error, setError] = useState('');

  const changeStatus = async () => {
    setError('');
    try {
      await updateWorker.mutateAsync({ id: worker.id, data: { status: nextWorkerStatus(worker.status) } });
      await invalidateOwnerAccess(queryClient, selectedBusinessId);
      if (worker.status === 'pending') onClose();
    } catch (requestError) {
      setError(errorMessage(requestError, 'স্ট্যাটাস আপডেট করতে সমস্যা হয়েছে।'));
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'স্টাফ/আমন্ত্রণ স্থায়ীভাবে মুছবেন?',
      `${worker.identity} এর অ্যাক্সেস ও আমন্ত্রণ মুছে যাবে। আগের খাতার লেনদেন ও ইতিহাস অক্ষত থাকবে।`,
      [
        { text: 'ফিরে যান', style: 'cancel' },
        {
          text: 'হ্যাঁ, মুছুন',
          style: 'destructive',
          onPress: () => {
            void deleteWorker.mutateAsync({ id: worker.id }).then(async () => {
              await invalidateOwnerAccess(queryClient, selectedBusinessId);
              onClose();
            }).catch((requestError) => {
              setError(errorMessage(requestError, 'স্টাফ মুছতে সমস্যা হয়েছে।'));
            });
          },
        },
      ],
    );
  };

  const statusAction = worker.status === 'active' ? 'সাসপেন্ড করুন' : worker.status === 'pending' ? 'আমন্ত্রণ বাতিল করুন' : 'অ্যাক্টিভ করুন';
  return (
    <BottomSheet
      visible
      title={worker.identity}
      subtitle={`${workerStatusLabel(worker.status)} · ${worker.partyIds.length.toLocaleString('bn-BD')} টি খাতার অ্যাক্সেস`}
      onClose={onClose}
      testID="owner-access-worker-sheet"
    >
      {error ? <Notice message={error} /> : null}
      <Card style={styles.detailCard}>
        <View style={styles.row}>
          <StatusPill status={worker.status} label={workerStatusLabel(worker.status)} />
          <View style={styles.grow} />
          <AppButton
            title={statusAction}
            icon={worker.status === 'suspended' ? 'user-check' : 'user-x'}
            variant={worker.status === 'suspended' ? 'success' : 'outline'}
            compact
            onPress={() => void changeStatus()}
            loading={updateWorker.isPending}
            testID="owner-access-worker-toggle-status"
          />
        </View>
        <AppButton
          title="স্টাফ মুছুন"
          icon="trash-2"
          variant="danger"
          compact
          onPress={confirmDelete}
          loading={deleteWorker.isPending}
          testID="owner-access-worker-delete"
        />
      </Card>
      {worker.lastLogin ? <Text style={[styles.meta, { color: colors.mutedForeground }]}>সর্বশেষ লগইন: {formatTimestamp(worker.lastLogin)}</Text> : null}
      {worker.lastLogout ? <Text style={[styles.meta, { color: colors.mutedForeground }]}>সর্বশেষ লগআউট: {formatTimestamp(worker.lastLogout)}</Text> : null}
      {worker.invitedAt && worker.status === 'pending' ? <Text style={[styles.meta, { color: colors.mutedForeground }]}>আমন্ত্রণ: {formatDate(worker.invitedAt)}</Text> : null}
      <PermissionEditor
        worker={worker}
        parties={parties}
        partiesPending={partiesPending}
        partiesError={partiesError}
        onRetryParties={onRetryParties}
        onSaved={onClose}
        testPrefix="owner-access-worker-permission"
      />
    </BottomSheet>
  );
}

function PermissionEditor({
  worker,
  parties,
  partiesPending,
  partiesError,
  onRetryParties,
  onSaved,
  testPrefix,
}: {
  worker: OwnerWorker;
  parties: OwnerParty[];
  partiesPending: boolean;
  partiesError: boolean;
  onRetryParties: () => void;
  onSaved?: () => void;
  testPrefix: string;
}) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { selectedBusinessId } = useBusinessScope();
  const updateWorker = useUpdateOwnerWorker();
  const [search, setSearch] = useState('');
  const [draftPartyIds, setDraftPartyIds] = useState<string[]>(worker.partyIds);
  const [draftAdjustmentIds, setDraftAdjustmentIds] = useState<string[]>(worker.adjustmentPartyIds ?? []);
  const [error, setError] = useState('');
  const filteredParties = parties.filter((party) => party.name.toLowerCase().includes(search.trim().toLowerCase()));

  const reset = () => {
    setDraftPartyIds(worker.partyIds);
    setDraftAdjustmentIds(worker.adjustmentPartyIds ?? []);
    setSearch('');
    setError('');
  };

  const save = async () => {
    if (partiesPending || partiesError) return;
    setError('');
    try {
      const result = await updateWorker.mutateAsync({
        id: worker.id,
        data: { partyIds: draftPartyIds, adjustmentPartyIds: draftAdjustmentIds },
      });
      setDraftPartyIds(result.partyIds);
      setDraftAdjustmentIds(result.adjustmentPartyIds);
      await invalidateOwnerAccess(queryClient, selectedBusinessId);
      onSaved?.();
    } catch (requestError) {
      setError(errorMessage(requestError, 'অনুমতি সেভ করতে সমস্যা হয়েছে।'));
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.permissionHeading}>
        <Text style={[styles.sectionHeading, { color: colors.foreground }]}>খাতা ও অ্যাডজাস্টমেন্টের অনুমতি</Text>
        <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
          খাতা অ্যাক্সেস ও অ্যাডজাস্টমেন্ট আলাদা অনুমতি। গন্তব্য খাতায় শুধু অ্যাডজাস্টমেন্ট অনুমতি দিলেও সেই খাতার ব্যালেন্স বা লেনদেন দেখা যাবে না।
        </Text>
      </View>
      <View style={[styles.searchField, { backgroundColor: colors.card, borderColor: colors.input }]}>
        <Feather name="search" size={17} color={colors.mutedForeground} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="কাস্টমার/সাপ্লায়ার খুঁজুন..."
          placeholderTextColor={colors.mutedForeground}
          accessibilityLabel="কাস্টমার বা সাপ্লায়ার খুঁজুন"
          testID={`${testPrefix}-search-${worker.id}`}
          style={[styles.searchInput, { color: colors.foreground }]}
        />
      </View>
      {partiesPending ? <LoadingState label="খাতার তালিকা লোড হচ্ছে…" /> : null}
      {partiesError ? <Notice message="খাতার তালিকা লোড করা যায়নি।" onRetry={onRetryParties} /> : null}
      {!partiesPending && !partiesError && parties.length === 0 ? (
        <EmptyState title="কোনো খাতা নেই" description="কাস্টমার বা সাপ্লায়ার খাতা যোগ হলে এখানে অনুমতি দিতে পারবেন।" icon="book-open" />
      ) : null}
      {!partiesPending && !partiesError && parties.length > 0 && filteredParties.length === 0 ? (
        <EmptyState title="খুঁজে পাওয়া যায়নি" description="অন্য নামে খুঁজে দেখুন।" icon="search" />
      ) : null}
      {!partiesPending && !partiesError ? filteredParties.map((party) => (
        <PermissionRow
          key={party.id}
          party={party}
          hasLedgerAccess={draftPartyIds.includes(party.id)}
          hasAdjustmentAccess={draftAdjustmentIds.includes(party.id)}
          onToggleLedger={() => {
            setDraftPartyIds((ids) => toggleAccessId(ids, party.id));
            setError('');
          }}
          onToggleAdjustment={() => {
            setDraftAdjustmentIds((ids) => toggleAccessId(ids, party.id));
            setError('');
          }}
          disabled={updateWorker.isPending}
          testPrefix={`${testPrefix}-${worker.id}`}
        />
      )) : null}
      {error ? <Notice message={error} /> : null}
      <View style={styles.permissionActions}>
        <View style={styles.grow}>
          <AppButton title="বাতিল" variant="outline" onPress={reset} disabled={updateWorker.isPending} testID={`${testPrefix}-cancel-${worker.id}`} />
        </View>
        <View style={styles.grow}>
          <AppButton
            title="অনুমতি সেভ করুন"
            icon="check"
            onPress={() => void save()}
            disabled={partiesPending || partiesError}
            loading={updateWorker.isPending}
            testID={`${testPrefix}-save-${worker.id}`}
          />
        </View>
      </View>
    </View>
  );
}

function PartyDetailSheet({
  party,
  parties,
  workers,
  partiesPending,
  partiesError,
  onRetryParties,
  onClose,
}: {
  party: OwnerParty;
  parties: OwnerParty[];
  workers: OwnerWorker[];
  partiesPending: boolean;
  partiesError: boolean;
  onRetryParties: () => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { selectedBusinessId } = useBusinessScope();
  const createWorker = useCreateOwnerWorker();
  const updateWorker = useUpdateOwnerWorker();
  const [identity, setIdentity] = useState('');
  const [error, setError] = useState('');
  const assignedWorkers = workers.filter((worker) => worker.partyIds.includes(party.id));
  const unassignedWorkers = workers.filter((worker) => !worker.partyIds.includes(party.id));

  const inviteForParty = async () => {
    setError('');
    const value = identity.trim();
    if (!isValidWorkerIdentity(value)) return;
    try {
      await createWorker.mutateAsync({
        data: {
          ...(value.includes('@') ? { email: value } : { phone: value }),
          partyIds: [party.id],
          adjustmentPartyIds: [],
        },
      });
      setIdentity('');
      await invalidateOwnerAccess(queryClient, selectedBusinessId);
    } catch (requestError) {
      setError(errorMessage(requestError, 'স্টাফ যোগ করতে সমস্যা হয়েছে।'));
    }
  };

  const updateAssignment = async (worker: OwnerWorker, grant: boolean) => {
    setError('');
    try {
      await updateWorker.mutateAsync({
        id: worker.id,
        data: { partyIds: toggleAccessId(worker.partyIds, party.id) },
      });
      await invalidateOwnerAccess(queryClient, selectedBusinessId);
    } catch (requestError) {
      setError(errorMessage(requestError, grant ? 'অ্যাক্সেস দিতে সমস্যা হয়েছে।' : 'অ্যাক্সেস সরাতে সমস্যা হয়েছে।'));
    }
  };

  const toggleStatus = async (worker: OwnerWorker) => {
    setError('');
    try {
      await updateWorker.mutateAsync({ id: worker.id, data: { status: nextWorkerStatus(worker.status) } });
      await invalidateOwnerAccess(queryClient, selectedBusinessId);
    } catch (requestError) {
      setError(errorMessage(requestError, 'স্ট্যাটাস আপডেট করতে সমস্যা হয়েছে।'));
    }
  };

  return (
    <BottomSheet
      visible
      title={party.name}
      subtitle={party.role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'}
      onClose={onClose}
      testID="owner-access-party-sheet"
    >
      {error ? <Notice message={error} /> : null}
      <Card style={styles.detailCard}>
        <Text style={[styles.sectionHeading, { color: colors.foreground }]}>নতুন স্টাফকে এই খাতার অ্যাক্সেস দিন</Text>
        <Field
          label="স্টাফের ইমেইল বা ফোন"
          value={identity}
          onChangeText={(value) => { setIdentity(value); setError(''); }}
          placeholder="email@example.com অথবা 01712345678"
          keyboardType={identity.trim().includes('@') ? 'default' : 'phone-pad'}
          autoCapitalize="none"
          testID="owner-access-party-invite-identity"
        />
        <AppButton
          title="যুক্ত করুন"
          icon="user-plus"
          compact
          onPress={() => void inviteForParty()}
          disabled={!isValidWorkerIdentity(identity)}
          loading={createWorker.isPending}
          testID="owner-access-party-invite-submit"
        />
        <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
          অ্যাপের লিংক নিজে শেয়ার করুন। স্টাফকে এই ইমেইল বা ফোন দিয়ে সাইন-ইন করতে বলুন; ফোনে যাচাইকরণ কোড SMS-এ যাবে।
        </Text>
      </Card>

      <View style={styles.section}>
        <Text style={[styles.sectionHeading, { color: colors.foreground }]}>অ্যাসাইন করা স্টাফ</Text>
        {assignedWorkers.length === 0 ? (
          <EmptyState title="কাউকে এই খাতার অ্যাক্সেস দেওয়া নেই" description="উপরের ঘর থেকে স্টাফ যোগ করুন, অথবা অন্য স্টাফকে অ্যাক্সেস দিন।" icon="users" />
        ) : assignedWorkers.map((worker) => (
          <Card key={worker.id} style={styles.workerPermissionCard}>
            <View style={styles.row}>
              <View style={[styles.workerAvatar, { backgroundColor: colors.secondary }]}>
                <Feather name={worker.identity.includes('@') ? 'mail' : 'phone'} size={16} color={colors.primary} />
              </View>
              <View style={styles.grow}>
                <Text style={[styles.partyName, { color: colors.foreground }]} numberOfLines={1}>{worker.identity}</Text>
                <StatusPill status={worker.status} label={workerStatusLabel(worker.status)} />
              </View>
              <AppButton
                title="রিমুভ"
                variant="danger"
                compact
                onPress={() => void updateAssignment(worker, false)}
                loading={updateWorker.isPending}
                testID={`owner-access-party-remove-${worker.id}`}
              />
            </View>
            <AppButton
              title={worker.status === 'active' ? 'অ্যাকাউন্ট সাসপেন্ড' : worker.status === 'pending' ? 'আমন্ত্রণ বাতিল করুন' : 'অ্যাকাউন্ট অ্যাক্টিভ করুন'}
              variant={worker.status === 'suspended' ? 'success' : 'outline'}
              compact
              onPress={() => void toggleStatus(worker)}
              loading={updateWorker.isPending}
              testID={`owner-access-party-status-${worker.id}`}
            />
            <PermissionEditor
              key={worker.id}
              worker={worker}
              parties={parties}
              partiesPending={partiesPending}
              partiesError={partiesError}
              onRetryParties={onRetryParties}
              testPrefix="owner-access-party-worker"
            />
          </Card>
        ))}
      </View>

      {unassignedWorkers.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionHeading, { color: colors.foreground }]}>অন্যান্য স্টাফ থেকে অ্যাক্সেস দিন</Text>
          {unassignedWorkers.map((worker) => (
            <Card key={worker.id} style={styles.rowCard}>
              <View style={styles.grow}>
                <Text style={[styles.partyName, { color: colors.foreground }]} numberOfLines={1}>{worker.identity}</Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>{workerStatusLabel(worker.status)}</Text>
              </View>
              <AppButton
                title="অ্যাক্সেস দিন"
                icon="user-plus"
                variant="outline"
                compact
                onPress={() => void updateAssignment(worker, true)}
                loading={updateWorker.isPending}
                testID={`owner-access-party-restore-${worker.id}`}
              />
            </Card>
          ))}
        </View>
      ) : null}
    </BottomSheet>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('bn-BD', { dateStyle: 'medium' });
}

function relativeTime(value: string): string {
  const createdAt = new Date(value).getTime();
  if (Number.isNaN(createdAt)) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
  if (seconds < 60) return 'এখনই';
  if (seconds < 3600) return `${Math.floor(seconds / 60).toLocaleString('bn-BD')} মিনিট আগে`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600).toLocaleString('bn-BD')} ঘণ্টা আগে`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400).toLocaleString('bn-BD')} দিন আগে`;
  return formatDate(value);
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  webHeader: { paddingTop: 67 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, marginTop: 4 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 46, borderBottomWidth: 2, paddingHorizontal: 2 },
  tabText: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  content: { padding: 16, paddingBottom: 24, gap: 14 },
  webContent: { paddingBottom: 34 },
  pageContent: { paddingHorizontal: 20, paddingTop: 67, paddingBottom: 34, gap: 16 },
  section: { gap: 12 },
  searchField: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingLeft: 13, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 9 },
  searchInput: { flex: 1, minHeight: 46, fontSize: 15, paddingVertical: 8 },
  partyCard: { padding: 14, borderRadius: 16, borderWidth: 1, gap: 12 },
  partyAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  workerAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1, minWidth: 0, gap: 4 },
  partyName: { fontSize: 14, fontWeight: '800' },
  meta: { fontSize: 11, lineHeight: 16 },
  countBadge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  assignedLine: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 11, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, maxWidth: 180 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: '800' },
  workerCard: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 12 },
  workerMeta: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 3 },
  activityCard: { padding: 14, gap: 7 },
  activityHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  activityTitle: { fontSize: 14, fontWeight: '800', lineHeight: 20 },
  activityMeta: { fontSize: 12, lineHeight: 18 },
  activityStrong: { fontSize: 12, fontWeight: '800' },
  detailCard: { gap: 12 },
  sectionHeading: { fontSize: 15, fontWeight: '800', lineHeight: 22 },
  helperText: { fontSize: 12, lineHeight: 18 },
  permissionHeading: { gap: 5 },
  permissionRow: { padding: 11, borderRadius: 12, borderWidth: 1, gap: 10 },
  permissionPartyName: { fontSize: 13, fontWeight: '800', lineHeight: 19 },
  permissionControls: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 9 },
  permissionToggle: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 6 },
  permissionLabel: { fontSize: 12, fontWeight: '600' },
  permissionActions: { flexDirection: 'row', gap: 9 },
  workerPermissionCard: { padding: 13, gap: 12 },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end' },
  webSheetBackdrop: { paddingTop: 67, paddingBottom: 34 },
  sheet: { width: '100%', alignSelf: 'center', borderWidth: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  sheetHeader: { paddingHorizontal: 18, paddingTop: 9, paddingBottom: 13, borderBottomWidth: StyleSheet.hairlineWidth, gap: 11 },
  sheetHandle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2 },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sheetTitle: { fontSize: 18, fontWeight: '800', lineHeight: 24 },
  sheetContent: { padding: 16, gap: 14 },
  sheetFooter: { padding: 14, borderTopWidth: StyleSheet.hairlineWidth },
});