/**
 * Client-side helpers for bill image cloud storage.
 *
 * Upload flow (two-step presigned URL):
 *   1. POST /api/storage/uploads/request-url  — send metadata, receive presigned PUT URL + objectPath
 *   2. PUT <presigned-url>                     — upload image bytes directly to GCS
 *
 * The objectPath (e.g. "/objects/uploads/some-uuid") is stored in the
 * database.  To render it, call `billImageSrc(objectPath)` which prepends the
 * correct API base so the browser fetches from the auth-protected storage
 * endpoint on the same origin.
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * Resolve a stored billImage value to a renderable `<img src>` URL.
 *
 *  - `null` / `undefined`            → null  (no image)
 *  - `data:…` (legacy base64)        → returned as-is (still renderable)
 *  - `/objects/…`  (new objectPath)  → `${BASE}/api/storage/objects/…`
 *  - anything else                   → returned as-is
 */
export function billImageSrc(billImage: string | null | undefined): string | null {
  if (!billImage) return null;
  if (billImage.startsWith('data:')) return billImage;
  if (billImage.startsWith('/objects/')) {
    return `${BASE}/api/storage${billImage}`;
  }
  return billImage;
}

/**
 * Maximum pixel dimension (width or height) for bill image thumbnails embedded
 * in PDFs. Camera photos can be several megapixels; even though the PDF renders
 * them at 48×48 px, html2canvas rasterizes the full canvas at 2× scale and
 * must hold the decoded bitmap in memory. Capping at 200 px keeps peak RAM
 * well under the ~256 MB limit common on low-end Android WebViews while
 * preserving enough detail for a receipt thumbnail.
 */
const PDF_THUMB_MAX_PX = 200;

/**
 * Decodes a Blob into an HTMLImageElement (waits for load/error).
 */
function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image decode failed'));
    };
    img.src = url;
  });
}

/**
 * Scales a decoded image down so neither dimension exceeds `maxPx`, then
 * returns it as a JPEG data URL. If the image is already small enough it is
 * re-encoded without scaling (quality 0.85 is enough for a 48 px thumbnail).
 *
 * Using a canvas keeps the base64 payload small so html2canvas never has to
 * hold a multi-megapixel bitmap in memory during PDF rasterization.
 */
function scaleImageToDataUrl(imgEl: HTMLImageElement, maxPx: number): string {
  const scale = Math.min(1, maxPx / Math.max(imgEl.naturalWidth, imgEl.naturalHeight, 1));
  const w = Math.round(imgEl.naturalWidth * scale);
  const h = Math.round(imgEl.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(imgEl, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Pre-fetches every cloud image inside a DOM subtree and temporarily replaces
 * their `src` attributes with small inline base64 JPEG data URLs so that
 * html2canvas can rasterize them without network access (offline-safe PDF
 * generation) and without running out of memory on low-end devices.
 *
 * Each image is scaled down to at most PDF_THUMB_MAX_PX on its longest side
 * before encoding — camera photos can be several megapixels and html2canvas
 * silently drops them on memory-constrained Android WebViews even when they
 * are already base64-encoded. Scaling before rasterization keeps peak RAM
 * usage predictable regardless of the original upload resolution.
 *
 * Returns a restore function that puts the original `src` values back.
 * Also returns the count of images that could not be fetched (so the caller
 * can warn the user).
 *
 * Only images whose `src` contains "/api/storage/" are touched; base64 images
 * already embedded in the DOM are left unchanged.
 */
export async function prefetchImagesForPdf(container: HTMLElement): Promise<{
  restore: () => void;
  failedCount: number;
}> {
  const images = Array.from(container.querySelectorAll<HTMLImageElement>('img'));
  const cloudImages = images.filter((img) => img.src.includes('/api/storage/'));

  const originals = new Map<HTMLImageElement, string>();
  let failedCount = 0;

  await Promise.all(
    cloudImages.map(async (img) => {
      const originalSrc = img.src;
      originals.set(img, originalSrc);
      try {
        const res = await fetch(originalSrc, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        // Decode and scale down so html2canvas never holds a large bitmap in
        // memory (low-memory devices silently drop oversized images).
        const imgEl = await blobToImage(blob);
        const dataUrl = scaleImageToDataUrl(imgEl, PDF_THUMB_MAX_PX);
        img.src = dataUrl;
      } catch {
        failedCount++;
        // Replace with a transparent placeholder so html2canvas renders a
        // visible "image missing" indicator rather than a blank/broken cell.
        img.src =
          "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='%23f1f5f9' rx='3'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-size='18' fill='%2394a3b8'%3E%3F%3C/text%3E%3C/svg%3E";
      }
    })
  );

  return {
    restore: () => {
      for (const [img, src] of originals) {
        img.src = src;
      }
    },
    failedCount,
  };
}

/** Convert a base64 data URL to a `Blob` for direct upload. */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(',');
  const mimeMatch = header?.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bytes = atob(data ?? '');
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/**
 * Discriminated result for `uploadBillImage`:
 *   - `{ ok: true; objectPath: string }` — upload succeeded
 *   - `{ ok: false; reason: 'url-request-failed' }` — could not obtain a presigned URL
 *   - `{ ok: false; reason: 'upload-failed' }` — PUT to GCS failed after retries
 */
export type BillImageUploadResult =
  | { ok: true; objectPath: string }
  | { ok: false; reason: 'url-request-failed' | 'upload-failed' };

/**
 * Upload a scanned bill image (given as a base64 data URL) to cloud storage.
 *
 * Returns a `BillImageUploadResult` discriminated union so the caller can
 * distinguish between a presigned-URL failure (step 1) and an actual upload
 * failure (step 2).
 *
 * The PUT step (step 2) is retried once after a short delay before giving up,
 * so a momentary network hiccup does not permanently lose the image.
 */
export async function uploadBillImage(base64DataUrl: string): Promise<BillImageUploadResult> {
  try {
    const blob = dataUrlToBlob(base64DataUrl);

    // Step 1: request a presigned upload URL from our API.
    let metaRes: Response;
    try {
      metaRes = await fetch(`${BASE}/api/storage/uploads/request-url`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'bill.jpg',
          size: blob.size,
          contentType: blob.type,
        }),
      });
    } catch (err) {
      console.error('বিল আপলোডের URL পাওয়া যায়নি (network error):', err);
      return { ok: false, reason: 'url-request-failed' };
    }

    if (!metaRes.ok) {
      console.error('বিল আপলোডের URL পাওয়া যায়নি:', metaRes.status);
      return { ok: false, reason: 'url-request-failed' };
    }

    const { uploadURL, objectPath } = (await metaRes.json()) as {
      uploadURL: string;
      objectPath: string;
    };

    // Step 2: upload the image bytes directly to GCS via the presigned URL.
    // Retry once after a short delay — a momentary network interruption between
    // step 1 and step 2 should not permanently lose the photo.
    const attemptPut = (): Promise<Response> =>
      fetch(uploadURL, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': blob.type },
      });

    let uploadRes: Response;
    try {
      uploadRes = await attemptPut();
    } catch {
      // First attempt threw (network drop) — wait 1 s then retry once.
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      try {
        uploadRes = await attemptPut();
      } catch (retryErr) {
        console.error('বিল ছবি আপলোড ব্যর্থ (retry exhausted):', retryErr);
        return { ok: false, reason: 'upload-failed' };
      }
    }

    if (!uploadRes.ok) {
      // Non-2xx on first attempt — retry once for transient 5xx errors.
      if (uploadRes.status >= 500) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        let retryRes: Response;
        try {
          retryRes = await attemptPut();
        } catch (retryErr) {
          console.error('বিল ছবি আপলোড ব্যর্থ (retry exhausted):', retryErr);
          return { ok: false, reason: 'upload-failed' };
        }
        if (!retryRes.ok) {
          console.error('বিল ছবি আপলোড ব্যর্থ (after retry):', retryRes.status);
          return { ok: false, reason: 'upload-failed' };
        }
        return { ok: true, objectPath };
      }
      console.error('বিল ছবি আপলোড ব্যর্থ:', uploadRes.status);
      return { ok: false, reason: 'upload-failed' };
    }

    return { ok: true, objectPath }; // e.g. "/objects/uploads/some-uuid"
  } catch (err) {
    console.error('বিল ছবি আপলোড ব্যর্থ হয়েছে:', err);
    return { ok: false, reason: 'upload-failed' };
  }
}
