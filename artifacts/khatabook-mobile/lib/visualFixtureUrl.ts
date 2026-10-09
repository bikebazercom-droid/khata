const visualFixtures = new Set(['party-ledger', 'transaction-report', 'active-book-header']);

/**
 * Selects an isolated, fake-data fixture only for explicit Expo Web development
 * previews. Native builds, production builds, and regular browser visits keep
 * loading the normal website URL.
 */
export function resolveVisualFixtureUrl(
  webAppUrl: string | null,
  search: string,
  platform: string,
  isDevelopment: boolean,
): string | null {
  if (!webAppUrl || !isDevelopment || platform !== 'web') return webAppUrl;

  const fixture = new URLSearchParams(search).get('visualFixture');
  if (!fixture || !visualFixtures.has(fixture)) return webAppUrl;

  const url = new URL('/src/visual-fixtures/index.html', webAppUrl);
  url.searchParams.set('screen', fixture);
  if (fixture === 'active-book-header') {
    const book = new URLSearchParams(search).get('book');
    if (book === 'short' || book === 'long') url.searchParams.set('book', book);
  }
  return url.toString();
}