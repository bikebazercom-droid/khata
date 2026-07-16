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
import { useGetBusinessSettings, useUpdateBusinessSettings } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useQueryClient } from '@tanstack/react-query';

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

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
        <Text style={s.title}>Settings</Text>
      </View>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[s.sectionLabel, { marginTop: 4 }]}>BUSINESS</Text>
        <View style={s.card}>
          <View style={s.row}>
            <Text style={s.rowLabel}>Store Name</Text>
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
          <View style={[s.row, s.rowBorder]}>
            <Text style={s.rowLabel}>Language</Text>
            <Text style={s.rowValue}>{settings?.language ?? 'EN'}</Text>
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
              <Text style={s.saveBtnText}>{updateSettings.isPending ? 'Saving…' : 'Save Changes'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.cancelBtn} onPress={() => { setEditing(false); setStoreName(settings?.storeName ?? ''); }}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </>
        )}

        <Text style={s.sectionLabel}>ABOUT</Text>
        <View style={s.aboutCard}>
          <Feather name="book-open" size={32} color={colors.primary} />
          <Text style={s.appName}>হাজারী খাতাবুক</Text>
          <Text style={s.appVersion}>Hazari Khatabook Mobile · v1.0</Text>
        </View>

        <View style={s.bottomPad} />
      </ScrollView>
    </View>
  );
}
