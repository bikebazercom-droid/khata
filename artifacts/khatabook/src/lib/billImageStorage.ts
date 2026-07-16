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
 * Upload a scanned bill image (given as a base64 data URL) to cloud storage.
 *
 * Returns the `objectPath` (e.g. `/objects/uploads/some-uuid`) to be stored
 * in the database, or `null` if the upload fails (in which case the entry is
 * saved without an image rather than blocking the user).
 */
export async function uploadBillImage(base64DataUrl: string): Promise<string | null> {
  try {
    const blob = dataUrlToBlob(base64DataUrl);

    // Step 1: request a presigned upload URL from our API.
    const metaRes = await fetch(`${BASE}/api/storage/uploads/request-url`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'bill.jpg',
        size: blob.size,
        contentType: blob.type,
      }),
    });

    if (!metaRes.ok) {
      console.error('বিল আপলোডের URL পাওয়া যায়নি:', metaRes.status);
      return null;
    }

    const { uploadURL, objectPath } = (await metaRes.json()) as {
      uploadURL: string;
      objectPath: string;
    };

    // Step 2: upload the image bytes directly to GCS via the presigned URL.
    const uploadRes = await fetch(uploadURL, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': blob.type },
    });

    if (!uploadRes.ok) {
      console.error('বিল ছবি আপলোড ব্যর্থ:', uploadRes.status);
      return null;
    }

    return objectPath; // e.g. "/objects/uploads/some-uuid"
  } catch (err) {
    console.error('বিল ছবি আপলোড ব্যর্থ হয়েছে:', err);
    return null;
  }
}
