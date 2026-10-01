import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router } from 'expo-router';
import { AppButton, Card, Page, PageHeader } from '@/components/Kit';
import { useAuth } from '@/contexts/AuthContext';
import { errorMessage } from '@/lib/domain';
import { useColors } from '@/hooks/useColors';

export default function SettingsScreen() {
  const colors = useColors();
  const { identity, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  const confirmSignOut = () => {
    Alert.alert('সাইন আউট করবেন?', 'এই ডিভাইস থেকে আপনার ফোন সেশন বন্ধ হবে।', [
      { text: 'থাক', style: 'cancel' },
      {
        text: 'সাইন আউট',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void signOut().then((requestError) => {
            if (requestError) {
              Alert.alert('সাইন আউট সম্পন্ন', `এই ডিভাইস থেকে সাইন-ইন তথ্য মুছে গেছে, তবে সার্ভারে সেশন বাতিল করা যায়নি: ${errorMessage(requestError, 'সংযোগ সমস্যা')}`);
            }
            router.replace('/sign-in');
          }).finally(() => setBusy(false));
        },
      },
    ]);
  };

  return (
    <Page>
      <PageHeader title="সেটিংস" subtitle="আপনার অ্যাকাউন্ট ও সেশন" />
      <Card>
        <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: '800' }}>{identity?.businessName || 'বাংলাখাতা'}</Text>
        <View style={{ gap: 5 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>ফোন নম্বর</Text>
          <Text style={{ color: colors.foreground, fontSize: 15 }}>{identity?.phone || '—'}</Text>
        </View>
        <View style={{ gap: 5 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>অ্যাকাউন্ট</Text>
          <Text style={{ color: colors.foreground, fontSize: 15 }}>{identity?.role === 'owner' ? 'মালিক' : 'স্টাফ'}</Text>
        </View>
      </Card>
      <AppButton title="সাইন আউট" icon="log-out" variant="outline" onPress={confirmSignOut} loading={busy} testID="settings-sign-out" />
    </Page>
  );
}