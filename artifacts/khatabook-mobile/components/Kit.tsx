import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { billImageUrl, formatDate, formatMoney, type LedgerRecord, type PartyRecord } from '@/lib/domain';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

type PageProps = React.PropsWithChildren<{
  onRefresh?: () => void;
  refreshing?: boolean;
  contentStyle?: object;
}>;

export function Page({ children, onRefresh, refreshing = false, contentStyle }: PageProps) {
  const colors = useColors();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: colors.background }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
        contentContainerStyle={[
          styles.pageContent,
          Platform.OS === 'web' ? styles.webPageContent : null,
          contentStyle,
        ]}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function FormPage({ children, footer }: React.PropsWithChildren<{ footer?: React.ReactNode }>) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pageContent = (
    <>
      <KeyboardAwareScrollViewCompat
        style={styles.fill}
        contentContainerStyle={[
          styles.formContent,
          footer ? styles.formContentWithFooter : null,
          Platform.OS === 'web' ? (footer ? styles.webFormContentWithFooter : styles.webPageContent) : null,
        ]}
        bottomOffset={footer ? 8 : 88}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </KeyboardAwareScrollViewCompat>
      {footer ? (
        <View style={[styles.formFooter, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 8) }]}>
          {footer}
        </View>
      ) : null}
    </>
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: colors.background }]}>
      {footer && Platform.OS !== 'web' ? (
        <KeyboardAvoidingView style={styles.fill} behavior="padding" keyboardVerticalOffset={0}>
          {pageContent}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.fill}>{pageContent}</View>
      )}
    </SafeAreaView>
  );
}

export function PageHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.headerRow}>
      <View style={styles.headerTitleRow}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="পেছনে যান" testID="back-button">
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
        ) : null}
        <View style={styles.fill}>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>{title}</Text>
          {subtitle ? <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
        </View>
      </View>
      {right}
    </View>
  );
}

export function AppButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  testID,
  compact = false,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'accent';
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Feather.glyphMap;
  testID?: string;
  compact?: boolean;
}) {
  const colors = useColors();
  const background = variant === 'primary' ? colors.primary
    : variant === 'danger' ? colors.destructive
      : variant === 'accent' ? colors.accent
        : variant === 'secondary' ? colors.secondary : 'transparent';
  const foreground = variant === 'primary' ? colors.primaryForeground
    : variant === 'danger' ? colors.destructiveForeground
      : variant === 'accent' ? colors.accentForeground
        : colors.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        compact ? styles.buttonCompact : null,
        { backgroundColor: background, borderColor: colors.border, opacity: disabled ? 0.48 : pressed ? 0.82 : 1 },
        variant === 'outline' ? styles.outlineButton : null,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={foreground} /> : icon ? <Feather name={icon} size={17} color={foreground} /> : null}
      <Text style={[styles.buttonText, { color: foreground }]}>{loading ? 'অপেক্ষা করুন…' : title}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  color,
  testID,
}: {
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  label: string;
  color?: string;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={label} testID={testID} style={styles.iconButton}>
      <Feather name={icon} size={20} color={color ?? colors.foreground} />
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline = false,
  editable = true,
  testID,
  autoCapitalize,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'phone-pad' | 'numeric' | 'number-pad' | 'numbers-and-punctuation';
  multiline?: boolean;
  editable?: boolean;
  testID?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  maxLength?: number;
}) {
  const colors = useColors();
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType}
        multiline={multiline}
        editable={editable}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        testID={testID}
        style={[
          styles.input,
          multiline ? styles.multilineInput : null,
          { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.input, opacity: editable ? 1 : 0.55 },
        ]}
      />
    </View>
  );
}

export function Card({ children, style }: React.PropsWithChildren<{ style?: object }>) {
  const colors = useColors();
  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, style]}>{children}</View>;
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const colors = useColors();
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      {action && onAction ? <Pressable onPress={onAction}><Text style={[styles.sectionAction, { color: colors.primary }]}>{action}</Text></Pressable> : null}
    </View>
  );
}

export function Notice({ message, tone = 'error', onRetry }: { message: string; tone?: 'error' | 'info'; onRetry?: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.notice, { backgroundColor: tone === 'error' ? `${colors.destructive}14` : colors.secondary }]}>
      <Text style={[styles.noticeText, { color: tone === 'error' ? colors.destructive : colors.foreground }]}>{message}</Text>
      {onRetry ? <Pressable onPress={onRetry} style={styles.noticeRetry}><Text style={{ color: colors.primary, fontWeight: '700' }}>আবার চেষ্টা করুন</Text></Pressable> : null}
    </View>
  );
}

export function LoadingState({ label = 'লোড হচ্ছে…' }: { label?: string }) {
  const colors = useColors();
  return <View style={styles.stateBox}><ActivityIndicator color={colors.primary} /><Text style={[styles.stateText, { color: colors.mutedForeground }]}>{label}</Text></View>;
}

export function EmptyState({ title, description, icon = 'inbox' }: { title: string; description: string; icon?: keyof typeof Feather.glyphMap }) {
  const colors = useColors();
  return (
    <View style={[styles.emptyBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Feather name={icon} size={24} color={colors.mutedForeground} />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.emptyDescription, { color: colors.mutedForeground }]}>{description}</Text>
    </View>
  );
}

export function StatCard({ label, amount, tone = 'primary' }: { label: string; amount: number; tone?: 'primary' | 'success' | 'warning' }) {
  const colors = useColors();
  const toneColor = tone === 'success' ? colors.success : tone === 'warning' ? colors.accent : colors.primary;
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.statDot, { backgroundColor: toneColor }]} />
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.statAmount, { color: colors.foreground }]}>{formatMoney(amount)}</Text>
    </View>
  );
}

export function PartyCard({ party, onPress }: { party: PartyRecord; onPress: () => void }) {
  const colors = useColors();
  const gives = party.balanceType === 'YOU_WILL_GIVE';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID={`party-${party.id}`} style={({ pressed }) => [styles.partyRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.82 : 1 }]}>
      <View style={[styles.avatar, { backgroundColor: colors.secondary }]}><Text style={[styles.avatarText, { color: colors.primary }]}>{party.name.trim().slice(0, 1) || 'খ'}</Text></View>
      <View style={styles.partyInfo}>
        <Text style={[styles.partyName, { color: colors.foreground }]} numberOfLines={1}>{party.name}</Text>
        <Text style={[styles.partyMeta, { color: colors.mutedForeground }]} numberOfLines={1}>{party.phone || (party.role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার')}</Text>
      </View>
      <View style={styles.partyBalance}>
        <Text style={[styles.partyAmount, { color: party.currentBalance === 0 ? colors.mutedForeground : gives ? colors.destructive : colors.success }]}>{formatMoney(party.currentBalance)}</Text>
        <Text style={[styles.partyMeta, { color: colors.mutedForeground }]}>{party.currentBalance === 0 ? 'হিসাব সমান' : gives ? 'আপনি দেবেন' : 'আপনি পাবেন'}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

export function EntryRow({
  entry,
  partyName,
  onPress,
}: {
  entry: LedgerRecord;
  partyName?: string;
  onPress: () => void;
}) {
  const colors = useColors();
  const gave = entry.type === 'YOU_GAVE';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID={`entry-${entry.id}`} style={({ pressed }) => [styles.entryRow, { borderColor: colors.border, opacity: pressed ? 0.78 : 1 }]}>
      <View style={[styles.entryIcon, { backgroundColor: gave ? `${colors.destructive}14` : `${colors.success}14` }]}>
        <Feather name={gave ? 'arrow-up-right' : 'arrow-down-left'} size={18} color={gave ? colors.destructive : colors.success} />
      </View>
      <View style={styles.entryInfo}>
        <Text style={[styles.entryTitle, { color: colors.foreground }]} numberOfLines={1}>
          {entry.isTransfer ? 'ট্রান্সফার' : entry.description || (gave ? 'আপনি দিয়েছেন' : 'আপনি পেয়েছেন')}
        </Text>
        <Text style={[styles.entryMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {[partyName, formatDate(entry.createdAt)].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Text style={[styles.entryAmount, { color: gave ? colors.destructive : colors.success }]}>{gave ? '−' : '+'}{formatMoney(entry.amount)}</Text>
    </Pressable>
  );
}

export function BillPhoto({
  path,
  localUri,
  token,
}: {
  path?: string | null;
  localUri?: string | null;
  token?: string | null;
}) {
  const colors = useColors();
  const [visible, setVisible] = useState(false);
  const uri = localUri ?? billImageUrl(path);
  if (!uri) return null;
  const source = {
    uri,
    ...(localUri || uri.startsWith('data:') || !token ? {} : { headers: { Authorization: `Bearer ${token}` } }),
  };
  return (
    <>
      <Pressable onPress={() => setVisible(true)} accessibilityRole="button" accessibilityLabel="বিলের ছবি বড় করে দেখুন" testID="bill-photo-preview">
        <Image source={source} resizeMode="cover" style={[styles.billThumb, { backgroundColor: colors.muted }]} />
      </Pressable>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View style={styles.photoOverlay}>
          <Pressable onPress={() => setVisible(false)} style={styles.photoClose} accessibilityRole="button" accessibilityLabel="ছবি বন্ধ করুন">
            <Feather name="x" size={24} color="#FFFFFF" />
          </Pressable>
          <Image source={source} resizeMode="contain" style={styles.billFull} />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pageContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 112, gap: 16 },
  formContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 30, gap: 16 },
  formContentWithFooter: { paddingBottom: 16 },
  webPageContent: { paddingTop: 67, paddingBottom: 120 },
  webFormContentWithFooter: { paddingTop: 67, paddingBottom: 16 },
  formFooter: { flexShrink: 0 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 },
  headerTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  pageTitle: { fontSize: 25, fontWeight: '800', letterSpacing: -0.5 },
  pageSubtitle: { fontSize: 13, marginTop: 3 },
  button: { minHeight: 50, paddingHorizontal: 16, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 },
  buttonCompact: { minHeight: 42, paddingHorizontal: 12, borderRadius: 10 },
  outlineButton: { borderWidth: 1 },
  buttonText: { fontSize: 15, fontWeight: '700' },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  fieldGroup: { gap: 7 },
  fieldLabel: { fontSize: 14, fontWeight: '700' },
  input: { minHeight: 50, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, fontSize: 16 },
  multilineInput: { minHeight: 88, paddingTop: 12, textAlignVertical: 'top' },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle: { fontSize: 17, fontWeight: '800' },
  sectionAction: { fontSize: 13, fontWeight: '700' },
  notice: { borderRadius: 11, padding: 13, gap: 8 },
  noticeText: { fontSize: 14, lineHeight: 20 },
  noticeRetry: { alignSelf: 'flex-start', paddingTop: 2 },
  stateBox: { paddingVertical: 32, alignItems: 'center', gap: 10 },
  stateText: { fontSize: 14 },
  emptyBox: { borderWidth: 1, borderRadius: 16, padding: 24, alignItems: 'center', gap: 9 },
  emptyTitle: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
  emptyDescription: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  statCard: { flex: 1, minWidth: 140, borderWidth: 1, borderRadius: 15, padding: 14, gap: 8 },
  statDot: { width: 8, height: 8, borderRadius: 4 },
  statLabel: { fontSize: 12, fontWeight: '600' },
  statAmount: { fontSize: 20, fontWeight: '800' },
  partyRow: { minHeight: 78, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '800' },
  partyInfo: { flex: 1, gap: 4 },
  partyName: { fontSize: 15, fontWeight: '700' },
  partyMeta: { fontSize: 12 },
  partyBalance: { alignItems: 'flex-end', gap: 4 },
  partyAmount: { fontSize: 14, fontWeight: '800' },
  entryRow: { minHeight: 72, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11 },
  entryIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  entryInfo: { flex: 1, gap: 4 },
  entryTitle: { fontSize: 14, fontWeight: '700' },
  entryMeta: { fontSize: 12 },
  entryAmount: { fontSize: 14, fontWeight: '800' },
  billThumb: { width: 92, height: 92, borderRadius: 12 },
  photoOverlay: { flex: 1, backgroundColor: 'rgba(8, 16, 28, 0.96)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  photoClose: { position: 'absolute', right: 18, top: Platform.OS === 'web' ? 70 : 54, zIndex: 2, padding: 8 },
  billFull: { width: '100%', height: '82%' },
});