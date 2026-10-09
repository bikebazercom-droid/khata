import { describe, expect, it } from 'vitest';
import { resolveVisualFixtureUrl } from './visualFixtureUrl';

describe('resolveVisualFixtureUrl', () => {
  it('selects an allowlisted fake-data screen in Expo Web development previews', () => {
    expect(
      resolveVisualFixtureUrl(
        'https://banglakhata.example/',
        '?visualFixture=party-ledger',
        'web',
        true,
      ),
    ).toBe('https://banglakhata.example/src/visual-fixtures/index.html?screen=party-ledger');
  });

  it.each(['short', 'long'] as const)(
    'passes the %s book selection to the active-header preview fixture',
    (book) => {
      expect(
        resolveVisualFixtureUrl(
          'https://banglakhata.example/',
          `?visualFixture=active-book-header&book=${book}`,
          'web',
          true,
        ),
      ).toBe(`https://banglakhata.example/src/visual-fixtures/index.html?screen=active-book-header&book=${book}`);
    },
  );

  it('does not alter normal browser URLs or native and production app URLs', () => {
    const baseUrl = 'https://banglakhata.example/';
    expect(resolveVisualFixtureUrl(baseUrl, '', 'web', true)).toBe(baseUrl);
    expect(resolveVisualFixtureUrl(baseUrl, '?visualFixture=unknown', 'web', true)).toBe(baseUrl);
    expect(resolveVisualFixtureUrl(baseUrl, '?visualFixture=party-ledger', 'ios', true)).toBe(baseUrl);
    expect(resolveVisualFixtureUrl(baseUrl, '?visualFixture=party-ledger', 'web', false)).toBe(baseUrl);
    expect(resolveVisualFixtureUrl(null, '?visualFixture=party-ledger', 'web', true)).toBeNull();
  });
});