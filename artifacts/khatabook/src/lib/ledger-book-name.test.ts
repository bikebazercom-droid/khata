import { describe, expect, it } from 'vitest';
import { resolveLedgerBookName } from './ledger-book-name';
import { escapeHtml } from './utils';

describe('resolveLedgerBookName', () => {
  it('prefers the saved per-book name over business and profile fallbacks', () => {
    expect(resolveLedgerBookName('  Updated book  ', 'Business name', 'Profile name'))
      .toBe('Updated book');
  });

  it('skips blank values and uses the next available book label', () => {
    expect(resolveLedgerBookName('  ', undefined, ' Saved business book '))
      .toBe('Saved business book');
  });

  it('returns undefined when no usable label is available', () => {
    expect(resolveLedgerBookName('', null, '  ')).toBeUndefined();
  });

  it('escapes user-supplied names before inserting them into PDF HTML', () => {
    expect(escapeHtml(`<Ledger & "Books">'`)).toBe('&lt;Ledger &amp; &quot;Books&quot;&gt;&#39;');
  });
});
