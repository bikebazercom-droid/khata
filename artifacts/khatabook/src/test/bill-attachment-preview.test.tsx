import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BillAttachmentPreview } from '@/components/bill-attachment-preview';

describe('BillAttachmentPreview document opening', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fetches the PDF with the current session and opens an inline blob viewer without forcing a download', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/pdf' }),
      blob: async () => new Blob(['%PDF-1.7'], { type: 'application/pdf' }),
    }));
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:authenticated-pdf'),
      revokeObjectURL: vi.fn(),
    });

    render(<BillAttachmentPreview src="/api/storage/objects/uploads/opaque-id" />);
    fireEvent.error(screen.getByRole('img'));
    fireEvent.click(screen.getByRole('button', { name: 'ফাইল খুলুন বা ডাউনলোড করুন' }));

    const viewer = await screen.findByRole('dialog', { name: 'PDF viewer' });
    expect(fetch).toHaveBeenCalledWith('/api/storage/objects/uploads/opaque-id', {
      credentials: 'include',
    });
    expect(viewer.querySelector('iframe')).toHaveAttribute('src', 'blob:authenticated-pdf');
    expect(viewer.querySelector('a[target="_blank"]')).toHaveAttribute('href', 'blob:authenticated-pdf');
    expect(viewer.querySelector('a[download]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'PDF বন্ধ করুন' }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:authenticated-pdf'));
  });
});
