import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { useGetBusinessSettings, useUpdateBusinessSettings } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, useClerk } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { useLanguage } from '@/lib/i18n';
import { notifyMobileIdentityChanged, useAuthRole } from '@/lib/auth-role';
import { customFetch } from '@/lib/api-transport';
import { revokeAndClearMobileSessions } from '@/lib/sign-out';

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const router = useRouter();
  const { t } = useLanguage();
  const { identity } = useAuthRole();

  const { isSignedIn, getToken } = useAuth();
  const { signOut } = useClerk();

  const { data: settings, isLoading } = useGetBusinessSettings({
    query: { enabled: identity?.role === 'owner', queryKey: ['/api/settings'] },
  });
  const updateSettings = useUpdateBusinessSettings();

  const [storeName, setStoreName] = useState('');
  const [editing, setEditing] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    if (settings?.storeName) setStoreName(settings.storeName);
  }, [settings?.storeName]);

  async function handleSave() {
    if (!storeName.trim()) {
      Alert.alert('Required', 'Store name cannot be empty.');
      return;
    }
    try {
      await updateSettings.mutateAsync({ data: { storeName: storeName.trim() } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['/api/settings'] });
    } catch {
      Alert.alert('Error', 'Could not save settings. Please try again.');
    }
  }

  async function handleLogout() {
    if (isSigningOut) return;
    Alert.alert(
      t('signOutLabel'),
      'আপনি কি সাইন আউট করতে চান?',
      [
        { text: 'বাতিল', style: 'cancel' },
        {
          text: t('signOutLabel'),
          style: 'destructive',
          onPress: async () => {
            setIsSigningOut(true);
            try {
              await revokeAndClearMobileSessions({
                isClerkSignedIn: !!isSignedIn,
                readPhoneToken: () => SecureStore.getItemAsync('phone_session_token'),
                revokePhone: async (phoneToken) => {
                  await customFetch('/api/auth/phone/logout', {
                  method: 'POST',
                  responseType: 'json',
                  headers: { Authorization: `Bearer ${phoneToken}` },
                  });
                },
                getClerkToken: getToken,
                revokeClerk: async (clerkToken) => {
                  await customFetch('/api/auth/logout-event', {
                    method: 'POST',
                    responseType: 'json',
                    headers: {
                      Authorization: `Bearer ${clerkToken}`,
                      ...(identity?.businessId ? { 'X-Business-Id': identity.businessId } : {}),
                    },
                  });
                },
                signOutClerk: signOut,
                deletePhoneToken: () => SecureStore.deleteItemAsync('phone_session_token'),
              });
              qc.clear();
              notifyMobileIdentityChanged();
              const { setAuthTokenGetter } = await import('@workspace/api-client-react');
              setAuthTokenGetter(null);
              router.replace('/(auth)/sign-in' as any);
            } catch {
              // Keep the credentials and current screen available to retry.
              Alert.alert('সাইন আউট হয়নি', 'সেশন বন্ধ করা যায়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।');
            } finally {
              setIsSigningOut(false);
            }
          },
        },
      ],
    );
  }

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingTop: Platform.OS === 'web' ? 67 : insets.top + 12,
      paddingHorizontal: 20,
      paddingBottom: 16,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.foreground },
    scroll: { flex: 1, padding: 20 },
    sectionLabel: {
      fontSize: 12,
      fontFamily: 'Inter_600SemiBold',
      color: colors.mutedForeground,
      letterSpacing: 0.8,
      marginTop: 24,
      marginBottom: 8,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
    rowLabel: { fontSize: 15, fontFamily: 'Inter_500Medium', color: colors.foreground, flex: 1 },
    rowValue: { fontSize: 15, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
    input: {
      flex: 1,
      fontSize: 15,
      fontFamily: 'Inter_400Regular',
      color: colors.foreground,
      padding: 0,
    },
    saveBtn: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      padding: 16,
      alignItems: 'center',
      marginTop: 16,
    },
    saveBtnText: { color: colors.primaryForeground, fontSize: 16, fontFamily: 'Inter_600SemiBold' },
    cancelBtn: { padding: 14, alignItems: 'center', marginTop: 4 },
    cancelText: { color: colors.mutedForeground, fontSize: 15, fontFamily: 'Inter_500Medium' },
    logoutBtn: {
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: '#ef4444',
      padding: 16,
      alignItems: 'center',
      marginTop: 8,
    },
    logoutText: { color: '#ef4444', fontSize: 16, fontFamily: 'Inter_600SemiBold' },
    aboutCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      alignItems: 'center',
    },
    appName: { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.foreground, marginTop: 8 },
    appVersion: { fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 2 },
    bottomPad: { height: Platform.OS === 'web' ? 84 : 90 },
  });

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>{t('mobileSettingsTitle')}</Text>
      </View>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>

        {identity?.role === 'owner' && (
          <>
            {/* BUSINESS section */}
            <Text style={[s.sectionLabel, { marginTop: 4 }]}>{t('businessSection')}</Text>
            <View style={s.card}>
              <View style={s.row}>
                <Text style={s.rowLabel}>{t('storeNameLabel')}</Text>
                {!editing && (
                  <>
                    {isLoading ? (
                      <ActivityIndicator size="small" color={colors.mutedForeground} />
                    ) : (
                      <Text style={s.rowValue} numberOfLines={1}>{settings?.storeName || '—'}</Text>
                    )}
                    <TouchableOpacity onPress={() => setEditing(true)} style={{ marginLeft: 10 }}>
                      <Feather name="edit-2" size={16} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </>
                )}
                {editing && (
                  <TextInput
                    style={s.input}
                    value={storeName}
                    onChangeText={setStoreName}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={handleSave}
                    textAlign="right"
                  />
                )}
              </View>
              <TouchableOpacity
                style={[s.row, s.rowBorder]}
                onPress={() => router.push('/access' as any)}
                activeOpacity={0.7}
                testID="settings-access"
              >
                <Text style={s.rowLabel}>খাতার অ্যাক্সেস</Text>
                <Feather name="users" size={18} color={colors.primary} />
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} style={{ marginLeft: 8 }} />
              </TouchableOpacity>
            </View>
          </>
        )}

        {identity?.role === 'owner' && editing && (
          <>
            <TouchableOpacity
              style={[s.saveBtn, updateSettings.isPending && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={updateSettings.isPending}
              activeOpacity={0.8}
            >
              <Text style={s.saveBtnText}>
                {updateSettings.isPending ? t('savingLabel') : t('saveChanges')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => { setEditing(false); setStoreName(settings?.storeName ?? ''); }}
            >
              <Text style={s.cancelText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ACCOUNT section */}
        <Text style={s.sectionLabel}>{t('accountSection')}</Text>
        <View style={s.card}>
          <TouchableOpacity style={s.row} onPress={handleLogout} disabled={isSigningOut} activeOpacity={0.7}>
            <Text style={[s.rowLabel, { color: '#ef4444' }]}>
              {isSigningOut ? 'সাইন আউট হচ্ছে…' : t('signOutLabel')}
            </Text>
            {isSigningOut ? <ActivityIndicator size="small" color="#ef4444" /> : <Feather name="log-out" size={18} color="#ef4444" />}
          </TouchableOpacity>
        </View>

        {/* ABOUT section */}
        <Text style={s.sectionLabel}>{t('aboutSection')}</Text>
        <View style={s.aboutCard}>
          <Feather name="book-open" size={32} color={colors.primary} />
          <Text style={s.appName}>{t('appNameMobile')}</Text>
          <Text style={s.appVersion}>BanglaKhata Mobile · v1.0</Text>
        </View>

        <View style={s.bottomPad} />
      </ScrollView>
    </View>
  );
}
