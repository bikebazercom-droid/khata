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

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const router = useRouter();
  const { isEnglish, t, setLanguage } = useLanguage();

  const { isSignedIn } = useAuth();
  const { signOut } = useClerk();

  const { data: settings, isLoading } = useGetBusinessSettings();
  const updateSettings = useUpdateBusinessSettings();

  const [storeName, setStoreName] = useState('');
  const [editing, setEditing] = useState(false);

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

  async function handleLanguageChange(lang: 'বাংলা' | 'English') {
    // Apply immediately to context — this re-renders the whole app at once
    setLanguage(lang === 'English' ? 'en' : 'bn');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await updateSettings.mutateAsync({ data: { language: lang } });
      qc.invalidateQueries({ queryKey: ['/api/settings'] });
    } catch {
      // silent — UI already updated optimistically above
    }
  }

  async function handleLogout() {
    Alert.alert(
      t('signOutLabel'),
      isEnglish ? 'Are you sure you want to sign out?' : 'আপনি কি সাইন আউট করতে চান?',
      [
        { text: isEnglish ? 'Cancel' : 'বাতিল', style: 'cancel' },
        {
          text: t('signOutLabel'),
          style: 'destructive',
          onPress: async () => {
            try {
              qc.clear();
              if (isSignedIn) {
                await signOut();
              }
              await SecureStore.deleteItemAsync('phone_session_token').catch(() => {});
              const { setAuthTokenGetter } = await import('@workspace/api-client-react');
              setAuthTokenGetter(null);
              router.replace('/(auth)/sign-in' as any);
            } catch (err: any) {
              Alert.alert('Error', err?.message ?? 'Could not sign out');
            }
          },
        },
      ],
    );
  }

  const currentLang = settings?.language ?? 'বাংলা';

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
    langToggleRow: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    langToggleLabel: {
      fontSize: 15,
      fontFamily: 'Inter_500Medium',
      color: colors.foreground,
      marginBottom: 10,
    },
    langBtnRow: { flexDirection: 'row', gap: 10 },
    langBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 2,
      alignItems: 'center',
    },
    langBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
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

        {/* BUSINESS section */}
        <Text style={[s.sectionLabel, { marginTop: 4 }]}>{t('businessSection')}</Text>
        <View style={s.card}>
          {/* Store name row */}
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

          {/* Language toggle row */}
          <View style={s.langToggleRow}>
            <Text style={s.langToggleLabel}>{t('languageLabel')}</Text>
            <View style={s.langBtnRow}>
              {(['বাংলা', 'English'] as const).map((lang) => {
                const active = currentLang === lang;
                return (
                  <TouchableOpacity
                    key={lang}
                    style={[
                      s.langBtn,
                      {
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active ? colors.primary : colors.card,
                      },
                    ]}
                    onPress={() => handleLanguageChange(lang)}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[
                        s.langBtnText,
                        { color: active ? colors.primaryForeground : colors.mutedForeground },
                      ]}
                    >
                      {lang}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {editing && (
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
          <TouchableOpacity style={s.row} onPress={handleLogout} activeOpacity={0.7}>
            <Text style={[s.rowLabel, { color: '#ef4444' }]}>{t('signOutLabel')}</Text>
            <Feather name="log-out" size={18} color="#ef4444" />
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
