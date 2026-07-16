/**
 * Unit tests for billImageStorage.ts
 *
 * Covers the two functions that feed bill-photo thumbnails into the PDF:
 *   - billImageSrc   — resolves a stored value to a renderable URL
 *   - prefetchImagesForPdf — replaces cloud-image <img> srcs with inline
 *                             base64 so html2canvas can rasterize them
 *
 * These tests verify the behaviour that protects thumbnail visibility in
 * both the handleReport (download) and handleReminderShare (share) PDF
 * code paths in party-view.tsx — both call prefetchImagesForPdf before
 * invoking html2pdf, so the same contract applies to each.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { billImageSrc, prefetchImagesForPdf } from '../lib/billImageStorage';

// ---------------------------------------------------------------------------
// billImageSrc
// ---------------------------------------------------------------------------

describe('billImageSrc', () => {
  it('returns null for null input', () => {
    expect(billImageSrc(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(billImageSrc(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(billImageSrc('')).toBeNull();
  });

  it('passes data URLs through unchanged (legacy base64 images)', () => {
    const dataUrl = 'data:image/jpeg;base64,/9j/abc123';
    expect(billImageSrc(dataUrl)).toBe(dataUrl);
  });

  it('prepends /api/storage for /objects/ paths (new cloud storage format)', () => {
    expect(billImageSrc('/objects/uploads/some-uuid')).toBe(
      '/api/storage/objects/uploads/some-uuid'
    );
  });

  it('returns arbitrary strings unchanged (forward-compat)', () => {
    expect(billImageSrc('https://example.com/image.jpg')).toBe(
      'https://example.com/image.jpg'
    );
  });
});

// ---------------------------------------------------------------------------
// prefetchImagesForPdf
// ---------------------------------------------------------------------------

/**
 * Builds a minimal HTMLElement containing <img> tags with the given srcs.
 * Uses actual DOM APIs (jsdom provides them).
 */
function makeContainer(srcs: string[]): HTMLElement {
  const div = document.createElement('div');
  for (const src of srcs) {
    const img = document.createElement('img');
    img.src = src;
    div.appendChild(img);
  }
  return div;
}

/**
 * Creates a minimal in-memory JPEG blob that can be decoded by the jsdom
 * Image element (jsdom doesn't actually decode pixels, but it fires onload
 * when given a Blob URL via URL.createObjectURL — which we stub below).
 */
function makeJpegBlob() {
  return new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' });
}

describe('prefetchImagesForPdf', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Stub URL.createObjectURL / revokeObjectURL (jsdom doesn't implement them)
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:fake-object-url'),
      revokeObjectURL: vi.fn(),
    });

    // Stub HTMLCanvasElement.getContext so scaleImageToDataUrl works
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    // Stub toDataURL to return a deterministic base64 string
    HTMLCanvasElement.prototype.toDataURL = vi
      .fn()
      .mockReturnValue('data:image/jpeg;base64,SCALED_THUMB');

    // Default fetch: succeeds, returns a JPEG blob
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(makeJpegBlob()),
    });
    vi.stubGlobal('fetch', fetchSpy);

    // jsdom's Image doesn't fire onload for blob URLs; patch it to auto-fire
    vi.stubGlobal(
      'Image',
      class MockImage {
        naturalWidth = 100;
        naturalHeight = 100;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        private _src = '';
        get src() {
          return this._src;
        }
        set src(val: string) {
          this._src = val;
          // Simulate successful decode on the next microtask
          Promise.resolve().then(() => this.onload?.());
        }
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('replaces cloud image srcs with base64 data URLs so html2canvas can render them', async () => {
    const container = makeContainer(['/api/storage/objects/uploads/abc']);
    const img = container.querySelector('img')!;

    const { failedCount } = await prefetchImagesForPdf(container);

    expect(failedCount).toBe(0);
    // src must have been replaced with the scaled JPEG data URL
    expect(img.src).toBe('data:image/jpeg;base64,SCALED_THUMB');
  });

  it('fetches cloud images with credentials:include so auth cookies are sent', async () => {
    const container = makeContainer(['/api/storage/objects/uploads/abc']);
    await prefetchImagesForPdf(container);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/storage/'),
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('does NOT touch non-storage images (base64, external URLs)', async () => {
    const dataUrl = 'data:image/jpeg;base64,existing';
    const external = 'https://example.com/photo.jpg';
    const container = makeContainer([dataUrl, external]);
    const imgs = container.querySelectorAll('img');

    await prefetchImagesForPdf(container);

    expect(imgs[0].src).toBe(dataUrl);
    expect(imgs[1].src).toBe(external);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('increments failedCount and inserts a placeholder SVG when fetch fails', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 403 });
    const container = makeContainer(['/api/storage/objects/uploads/secret']);
    const img = container.querySelector('img')!;

    const { failedCount } = await prefetchImagesForPdf(container);

    expect(failedCount).toBe(1);
    // Placeholder must be an SVG data URI — not a blank src — so the PDF
    // renders a visible "?" indicator rather than a completely blank cell.
    expect(img.src).toMatch(/^data:image\/svg\+xml/);
  });

  it('restore() puts original cloud src values back after PDF generation', async () => {
    const originalSrc = '/api/storage/objects/uploads/abc';
    // jsdom normalises relative src to absolute; we work around by setting
    // via a container that already carries the full URL pattern.
    const container = document.createElement('div');
    const img = document.createElement('img');
    // Force src to include the /api/storage/ substring that the filter checks
    Object.defineProperty(img, 'src', {
      get: vi.fn().mockReturnValue(`http://localhost${originalSrc}`),
      set: vi.fn(),
      configurable: true,
    });
    container.appendChild(img);

    const { restore } = await prefetchImagesForPdf(container);
    restore();

    // After restore the setter must have been called with the original src
    const setter = Object.getOwnPropertyDescriptor(img, 'src')!.set as ReturnType<typeof vi.fn>;
    expect(setter).toHaveBeenLastCalledWith(`http://localhost${originalSrc}`);
  });

  it('handles mixed success/failure: only failed images count, others get data URLs', async () => {
    fetchSpy
      .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(makeJpegBlob()) })  // first: ok
      .mockResolvedValueOnce({ ok: false, status: 404 });                                 // second: 404

    const container = makeContainer([
      '/api/storage/objects/uploads/ok',
      '/api/storage/objects/uploads/missing',
    ]);
    const imgs = container.querySelectorAll('img');

    const { failedCount } = await prefetchImagesForPdf(container);

    expect(failedCount).toBe(1);
    expect(imgs[0].src).toBe('data:image/jpeg;base64,SCALED_THUMB');
    expect(imgs[1].src).toMatch(/^data:image\/svg\+xml/);
  });
});
