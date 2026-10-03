import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { AppButton, LoadingState, Notice, Page } from '@/components/Kit';
import { errorMessage, isUnauthorized } from '@/lib/domain';

export default function IndexScreen() {
  const { ready, hasSession, accountDeleted, identity, identityLoading, identityError, storageError, refreshIdentity } = useAuth();
  const isWeb = Platform.OS === 'web';

  useEffect(() => {
    if (!ready) return;
    if (isWeb) {
      if (accountDeleted) router.replace('/sign-in');
      else if (identity) router.replace('/(tabs)/parties');
      else if (!identityLoading && identityError && isUnauthorized(identityError)) router.replace('/sign-in');
      return;
    }
    if (!hasSession) {
      router.replace('/sign-in');
    } else if (identity) {
      router.replace('/(tabs)/parties');
    }
  }, [ready, isWeb, hasSession, accountDeleted, identity, identityLoading, identityError]);

  if (!ready || (isWeb ? !accountDeleted && identityLoading : hasSession && identityLoading)) return <Page><LoadingState label="আপনার হিসাব খোলা হচ্ছে…" /></Page>;
  if (storageError) return <Page><Notice message={storageError} /></Page>;
  if (isWeb && identityError && !isUnauthorized(identityError)) {
    return (
      <Page>
        <Notice message={errorMessage(identityError, 'সার্ভারের সঙ্গে সংযোগ করা যাচ্ছে না।')} tone="error" onRetry={() => { void refreshIdentity(); }} />
        <AppButton title="আবার চেষ্টা করুন" icon="refresh-cw" onPress={() => { void refreshIdentity(); }} />
      </Page>
    );
  }
  if (hasSession && identityError) {
    return (
      <Page>
        <Notice message={errorMessage(identityError, 'সার্ভারের সঙ্গে সংযোগ করা যাচ্ছে না।')} tone="error" onRetry={() => { void refreshIdentity(); }} />
        <AppButton title="আবার চেষ্টা করুন" icon="refresh-cw" onPress={() => { void refreshIdentity(); }} />
      </Page>
    );
  }
  return <Page><LoadingState /></Page>;
}