import React from 'react';
import { LedgerEntryForm } from '@/components/LedgerEntryForm';
import { useLocalSearchParams } from 'expo-router';

export default function NewEntryScreen() {
  const { partyId, type } = useLocalSearchParams<{ partyId?: string; type?: string }>();
  const initialType = type === 'YOU_GAVE' || type === 'YOU_GOT' ? type : undefined;
  return <LedgerEntryForm mode="create" partyId={partyId} initialType={initialType} />;
}