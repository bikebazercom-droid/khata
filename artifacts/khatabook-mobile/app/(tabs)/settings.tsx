import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useDeleteUserAccount } from '@workspace/api-client-react';
import { AppButton, Card, Page, PageHeader } from '@/components/Kit';
import { useAuth } from '@/contexts/AuthContext';
import { errorMessage } from '@/lib/domain';
import { useColors } from '@/hooks/useColors';

export default function SettingsScreen() {
  const colors = useColors();
  const { identity, signOut, clearAfterAccountDeletion } = useAuth();
  const [busy, setBusy] = useState(false);
  const deleteAccountMutation = useDeleteUserAccount();

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
              Alert.alert(
                'সাইন আউট সম্পন্ন হয়নি',
                `সার্ভার সেশন বাতিল বা ডিভাইসের সাইন-ইন তথ্য পরিষ্কার করা যায়নি। আপনার সেশন সক্রিয় থাকতে পারে; সংযোগ ফিরলে আবার চেষ্টা করুন। ${errorMessage(requestError, 'সংযোগ সমস্যা')}`,
              );
              return;
            }
            router.replace('/sign-in');
          }).finally(() => setBusy(false));
        },
      },
    ]);
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      'স্থায়ীভাবে অ্যাকাউন্ট মুছবেন?',
      'এতে আপনার ব্যবসা, সব খাতা, লেনদেন, বিলের ছবি এবং কর্মীদের তথ্য স্থায়ীভাবে মুছে যাবে। এই কাজ ফেরানো যাবে না।',
      [
        { text: 'বাতিল', style: 'cancel' },
        {
          text: 'সব তথ্য মুছুন',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            void (async () => {
              try {
                await deleteAccountMutation.mutateAsync();
                const cleanupError = await clearAfterAccountDeletion();
                router.replace('/sign-in');
                if (cleanupError) {
                  Alert.alert(
                    'অ্যাকাউন্ট মুছে ফেলা হয়েছে',
                    `সার্ভারের তথ্য মুছে গেছে, তবে এই ডিভাইসের সাইন-ইন তথ্য পুরোপুরি পরিষ্কার করা যায়নি: ${errorMessage(cleanupError, 'সংযোগ সমস্যা')}`,
                  );
                }
              } catch (requestError) {
                Alert.alert(
                  'অ্যাকাউন্ট মুছতে পারেনি',
                  errorMessage(requestError, 'সার্ভারের সঙ্গে যোগাযোগ করা যায়নি। আবার চেষ্টা করুন।'),
                );
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
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
      {identity?.role === 'owner' ? (
        <Card>
          <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: '800' }}>অ্যাকাউন্ট মুছুন</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 19 }}>
            ব্যবসার সব খাতা, লেনদেন ও কর্মীদের তথ্য স্থায়ীভাবে মুছে যাবে।
          </Text>
          <AppButton
            title="অ্যাকাউন্ট স্থায়ীভাবে মুছুন"
            icon="trash-2"
            variant="outline"
            onPress={confirmDeleteAccount}
            loading={busy || deleteAccountMutation.isPending}
            testID="settings-delete-account"
          />
        </Card>
      ) : null}
    </Page>
  );
}