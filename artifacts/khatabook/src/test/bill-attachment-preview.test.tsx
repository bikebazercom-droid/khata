import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BillAttachmentPreview } from '@/components/bill-attachment-preview';

describe('BillAttachmentPreview document opening', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as Window & { ReactNativeWebView?: unknown }).ReactNativeWebView;
  });

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
    fireEvent.click(screen.getByRole('button', { name: 'ফাইল খুলুন' }));

    const viewer = await screen.findByRole('dialog', { name: 'PDF viewer' });
    expect(fetch).toHaveBeenCalledWith('/api/storage/objects/uploads/opaque-id', {
      credentials: 'include',
      cache: 'no-store',
    });
    expect(viewer.querySelector('iframe')).toHaveAttribute('src', 'blob:authenticated-pdf');
    expect(viewer.querySelector('a[target="_blank"]')).toHaveAttribute('href', 'blob:authenticated-pdf');
    expect(viewer.querySelector('a[download]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'ফাইল বন্ধ করুন' }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:authenticated-pdf'));
  });

  it('opens image attachments from an authenticated blob in the lightbox', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      blob: async () => new Blob(['png-data'], { type: 'image/png' }),
    }));
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:authenticated-image'),
      revokeObjectURL: vi.fn(),
    });

    render(<BillAttachmentPreview src="/api/storage/objects/uploads/image-id" />);
    const thumbnail = screen.getByRole('img');
    fireEvent.load(thumbnail);
    fireEvent.click(screen.getByRole('button', { name: 'বিলের ছবি দেখুন' }));

    const viewer = await screen.findByRole('dialog', { name: 'সংযুক্ত ছবি' });
    expect(fetch).toHaveBeenCalledWith('/api/storage/objects/uploads/image-id', {
      credentials: 'include',
      cache: 'no-store',
    });
    expect(viewer.querySelector('img')).toHaveAttribute('src', 'blob:authenticated-image');
    fireEvent.click(screen.getByRole('button', { name: 'ফাইল বন্ধ করুন' }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:authenticated-image'));
  });

  it('sends the authenticated attachment to the Expo native share sheet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      blob: async () => new Blob(['png-data'], { type: 'image/png' }),
    }));
    const bridge = {
      postMessage: vi.fn((raw: string) => {
        const request = JSON.parse(raw) as { requestId: string };
        window.dispatchEvent(new CustomEvent('banglakhata-file-export-result', {
          detail: {
            type: 'banglakhata:file-export',
            requestId: request.requestId,
            ok: true,
          },
        }));
      }),
    };
    Object.defineProperty(window, 'ReactNativeWebView', { configurable: true, value: bridge });
    render(<BillAttachmentPreview src="/api/storage/objects/uploads/image-id" />);
    fireEvent.error(screen.getByRole('img'));
    fireEvent.click(screen.getByRole('button', { name: 'শেয়ার করুন' }));

    await waitFor(() => expect(bridge.postMessage).toHaveBeenCalledOnce());
    expect(JSON.parse(bridge.postMessage.mock.calls[0][0])).toMatchObject({
      fileName: 'attachment.png',
      mimeType: 'image/png',
      base64: window.btoa('png-data'),
    });
  });
});
