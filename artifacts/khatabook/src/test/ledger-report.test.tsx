/**
 * Unit tests for LedgerReportDocument (ledger-report.tsx)
 *
 * Verifies that bill-photo thumbnails are rendered as <img> elements inside
 * the hidden report DOM node for every ledger entry that has a billImage.
 * This DOM node is what html2canvas rasterizes — if the <img> is missing
 * here the thumbnail will never appear in the downloaded PDF regardless of
 * whether prefetchImagesForPdf ran correctly.
 *
 * The tests cover both storage formats the app may encounter:
 *   - Legacy base64 data URLs  (old entries uploaded before cloud storage)
 *   - /objects/… object paths  (new entries stored in cloud storage)
 * and confirm that entries WITHOUT a billImage produce no <img> element.
 */

import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { LedgerReportDocument, type ReportEntry, type ReportParty } from '../lib/ledger-report';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const PARTY: ReportParty = {
  name: 'রহিম উদ্দিন',
  phone: '01712345678',
  currentBalance: 5000,
  balanceType: 'YOU_WILL_GET',
};

function makeEntry(overrides: Partial<ReportEntry> = {}): ReportEntry {
  return {
    id: 'e1',
    type: 'YOU_GAVE',
    amount: 1000,
    description: 'টেস্ট লেনদেন',
    billReference: null,
    billImage: null,
    dueDate: '2026-07-01',
    createdAt: '2026-07-01T10:00:00.000Z',
    balanceAfter: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LedgerReportDocument — bill image thumbnails', () => {
  it('renders an <img> for entries with a legacy base64 billImage', () => {
    const dataUrl = 'data:image/jpeg;base64,/9j/fakedata';
    const { container } = render(
      <LedgerReportDocument
        storeName="টেস্ট স্টোর"
        party={PARTY}
        entries={[makeEntry({ billImage: dataUrl })]}
      />
    );

    const imgs = container.querySelectorAll('img[alt="বিল"]');
    expect(imgs).toHaveLength(1);
    expect((imgs[0] as HTMLImageElement).src).toContain('data:image/jpeg');
  });

  it('renders an <img> for entries with an /objects/ cloud storage path', () => {
    const { container } = render(
      <LedgerReportDocument
        storeName="টেস্ট স্টোর"
        party={PARTY}
        entries={[makeEntry({ billImage: '/objects/uploads/some-uuid' })]}
      />
    );

    const imgs = container.querySelectorAll('img[alt="বিল"]');
    expect(imgs).toHaveLength(1);
    // billImageSrc should have prepended /api/storage
    expect((imgs[0] as HTMLImageElement).src).toContain('/api/storage/objects/uploads/some-uuid');
  });

  it('renders NO <img> for entries without a billImage', () => {
    const { container } = render(
      <LedgerReportDocument
        storeName="টেস্ট স্টোর"
        party={PARTY}
        entries={[makeEntry({ billImage: null })]}
      />
    );

    expect(container.querySelectorAll('img[alt="বিল"]')).toHaveLength(0);
  });

  it('renders one <img> per entry that has a billImage, and none for entries without', () => {
    const entries: ReportEntry[] = [
      makeEntry({ id: 'e1', billImage: 'data:image/jpeg;base64,img1', dueDate: '2026-07-01', balanceAfter: 1000 }),
      makeEntry({ id: 'e2', billImage: null,                          dueDate: '2026-07-02', balanceAfter: 2000 }),
      makeEntry({ id: 'e3', billImage: '/objects/uploads/uuid-3',     dueDate: '2026-07-03', balanceAfter: 3000 }),
    ];

    const { container } = render(
      <LedgerReportDocument
        storeName="টেস্ট স্টোর"
        party={PARTY}
        entries={entries}
      />
    );

    // e1 and e3 have images; e2 does not
    expect(container.querySelectorAll('img[alt="বিল"]')).toHaveLength(2);
  });

  it('img elements have the expected thumbnail dimensions (48×48) and objectFit:cover', () => {
    const { container } = render(
      <LedgerReportDocument
        storeName="টেস্ট স্টোর"
        party={PARTY}
        entries={[makeEntry({ billImage: 'data:image/jpeg;base64,x' })]}
      />
    );

    const img = container.querySelector('img[alt="বিল"]') as HTMLImageElement;
    expect(img.style.width).toBe('48px');
    expect(img.style.height).toBe('48px');
    expect(img.style.objectFit).toBe('cover');
  });

  it('renders correctly when there are no entries (empty ledger)', () => {
    const { container } = render(
      <LedgerReportDocument
        storeName="টেস্ট স্টোর"
        party={PARTY}
        entries={[]}
      />
    );

    expect(container.querySelectorAll('img[alt="বিল"]')).toHaveLength(0);
  });
});
