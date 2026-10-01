import React, { useEffect } from 'react';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { AppButton, LoadingState, Notice, Page } from '@/components/Kit';
import { errorMessage } from '@/lib/domain';

export default function IndexScreen() {
  const { ready, token, identity, identityLoading, identityError, storageError, refreshIdentity } = useAuth();

  useEffect(() => {
    if (!ready) return;
    if (!token) {
      router.replace('/sign-in');
    } else if (identity) {
      router.replace('/(tabs)/home');
    }
  }, [ready, token, identity]);

  if (!ready || (token && identityLoading)) return <Page><LoadingState label="আপনার হিসাব খোলা হচ্ছে…" /></Page>;
  if (storageError) return <Page><Notice message={storageError} /></Page>;
  if (token && identityError) {
    return (
      <Page>
        <Notice message={errorMessage(identityError, 'সার্ভারের সঙ্গে সংযোগ করা যাচ্ছে না।')} tone="error" onRetry={() => { void refreshIdentity(); }} />
        <AppButton title="আবার চেষ্টা করুন" icon="refresh-cw" onPress={() => { void refreshIdentity(); }} />
      </Page>
    );
  }
  return <Page><LoadingState /></Page>;
}