import React from 'react';
import { LedgerEntryForm } from '@/components/LedgerEntryForm';
import { useLocalSearchParams } from 'expo-router';

export default function NewEntryScreen() {
  const { partyId } = useLocalSearchParams<{ partyId?: string }>();
  return <LedgerEntryForm mode="create" partyId={partyId} />;
}