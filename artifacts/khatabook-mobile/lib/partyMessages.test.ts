import { describe, expect, it } from 'vitest';
import { formatMoney } from '@/lib/domain';
import { buildPartyReminderMessage, buildPartySmsMessage } from '@/lib/partyMessages';

describe('party reminder messages', () => {
  const party = {
    name: 'মিনা ট্রেডার্স',
    balanceType: 'YOU_WILL_GET' as const,
    currentBalance: 2500,
  };

  it('builds the website-compatible reminder with the selected business name', () => {
    expect(buildPartyReminderMessage('আমার দোকান', party)).toBe(
      `প্রিয় মিনা ট্রেডার্স,\nআমার দোকান-এর হিসাব অনুযায়ী আপনার বর্তমান ব্যালেন্স: আপনি পাবেন ${formatMoney(2500)}।\nবিস্তারিত হিসাবের রিপোর্ট (পিডিএফ) সংযুক্ত আছে।\nধন্যবাদান্তে, আমার দোকান।`,
    );
  });

  it('builds the website-compatible SMS copy text', () => {
    expect(buildPartySmsMessage(party)).toBe(
      `প্রিয় মিনা ট্রেডার্স, আপনার হিসাবে আপনি পাবেন ${formatMoney(2500)}। ধন্যবাদান্তে, Banglakhata।`,
    );
  });

  it('uses the payable label for balances the owner owes', () => {
    expect(buildPartySmsMessage({ ...party, balanceType: 'YOU_WILL_GIVE' }))
      .toContain('আপনার হিসাবে আপনি দেবেন');
  });
});