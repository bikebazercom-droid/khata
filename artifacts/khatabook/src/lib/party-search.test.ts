import { describe, expect, it } from 'vitest';
import { filterPartiesBySearch } from './party-search';

const parties = [
  { id: 'bn-name', name: 'শাকিল', phone: '+8801712345678' },
  { id: 'phone-match', name: 'Customer Two', phone: '+8801811112222' },
  { id: 'no-match', name: 'Supplier Three', phone: '+8801912340000' },
];

describe('filterPartiesBySearch', () => {
  it('matches Bengali names immediately from the loaded list', () => {
    expect(filterPartiesBySearch(parties, '  শাকিল  ').map(({ id }) => id))
      .toEqual(['bn-name']);
  });

  it('matches phone numbers and partial numeric input', () => {
    expect(filterPartiesBySearch(parties, '181111').map(({ id }) => id))
      .toEqual(['phone-match']);
  });

  it('returns all parties for a blank search without changing their order', () => {
    expect(filterPartiesBySearch(parties, '   ')).toEqual(parties);
  });
});
