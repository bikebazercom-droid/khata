import { formatMoney, type PartyRecord } from '@/lib/domain';

type MessageParty = Pick<PartyRecord, 'name' | 'balanceType' | 'currentBalance'>;

export function buildPartyReminderMessage(storeName: string, party: MessageParty): string {
  const label = party.balanceType === 'YOU_WILL_GIVE' ? 'আপনি দেবেন' : 'আপনি পাবেন';
  return `প্রিয় ${party.name},\n${storeName}-এর হিসাব অনুযায়ী আপনার বর্তমান ব্যালেন্স: ${label} ${formatMoney(
    party.currentBalance,
  )}।\nবিস্তারিত হিসাবের রিপোর্ট (পিডিএফ) সংযুক্ত আছে।\nধন্যবাদান্তে, ${storeName}।`;
}

export function buildPartySmsMessage(party: MessageParty): string {
  const label = party.balanceType === 'YOU_WILL_GIVE' ? 'আপনি দেবেন' : 'আপনি পাবেন';
  return `প্রিয় ${party.name}, আপনার হিসাবে ${label} ${formatMoney(party.currentBalance)}। ধন্যবাদান্তে, Banglakhata।`;
}