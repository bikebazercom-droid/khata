import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BillAttachmentPreview } from '@/components/bill-attachment-preview';
import { billImageSrc } from '@/lib/billImageStorage';

type LedgerRow = { id: string; partyId: string; billImage: string | null };

describe('synced transfer bill-photo reload flow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows and opens only the source party photo returned by a refreshed ledger', async () => {
    const refreshedRows: LedgerRow[] = [
      { id: 'source-entry', partyId: 'source-party', billImage: '/objects/uploads/synced-photo' },
      { id: 'counter-entry', partyId: 'counter-party', billImage: null },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => refreshedRows,
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        blob: async () => new Blob(['synced-photo-bytes'], { type: 'image/jpeg' }),
      });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:synced-photo'),
      revokeObjectURL: vi.fn(),
    });

    // A fresh ledger request after returning to the source party is the
    // browser equivalent of reloading after the offline outbox has synced.
    const response = await fetch('/api/parties/source-party/ledger-entries', {
      credentials: 'include',
      cache: 'no-store',
    });
    const rows = await response.json() as LedgerRow[];
    const sourcePhoto = billImageSrc(rows.find((row) => row.partyId === 'source-party')?.billImage);
    const counterpartyPhoto = billImageSrc(rows.find((row) => row.partyId === 'counter-party')?.billImage);

    render(
      <div>
        {sourcePhoto ? <BillAttachmentPreview src={sourcePhoto} /> : null}
        {counterpartyPhoto ? <BillAttachmentPreview src={counterpartyPhoto} /> : null}
      </div>,
    );

    const thumbnail = screen.getByRole('img', { name: 'সংযুক্ত বিল' });
    expect(screen.getAllByRole('img', { name: 'সংযুক্ত বিল' })).toHaveLength(1);
    fireEvent.load(thumbnail);
    fireEvent.click(screen.getByRole('button', { name: 'বিলের ছবি দেখুন' }));

    const viewer = await screen.findByRole('dialog', { name: 'সংযুক্ত ছবি' });
    expect(viewer.querySelector('img')).toHaveAttribute('src', 'blob:synced-photo');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/storage/objects/uploads/synced-photo',
      { credentials: 'include', cache: 'no-store' },
    );
  });
});
