/**
 * Lightweight, fully-local "document scanner" pipeline built on the Canvas
 * API — no network calls, no native deps. Given a captured photo it:
 *   1. Auto-detects the paper/receipt region via edge-density analysis and
 *      crops the background out.
 *   2. Applies an adaptive contrast + soft-binarization filter so the result
 *      reads like a flatbed scan (clean white background, dark ink) instead
 *      of a phone photo.
 *
 * This is a heuristic approximation of a "real" scanner SDK (true 4-point
 * perspective correction needs corner detection we don't attempt here), but
 * it materially improves legibility and framing without any external
 * dependency.
 */

const MAX_OUTPUT_DIMENSION = 1600;
const ANALYSIS_MAX_DIMENSION = 480;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

function computeGrayscale(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return gray;
}

function sobelMagnitude(gray: Float32Array, width: number, height: number): Float32Array {
  const mag = new Float32Array(width * height);
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sx = 0;
      let sy = 0;
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = gray[(y + dy) * width + (x + dx)];
          sx += v * gx[k];
          sy += v * gy[k];
          k++;
        }
      }
      mag[y * width + x] = Math.sqrt(sx * sx + sy * sy);
    }
  }
  return mag;
}

function percentileOf(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

/** Finds the bounding box of the document within the frame using edge
 *  density, falling back to the full frame when no confident region is
 *  found (e.g. a receipt that already fills the shot). */
function detectDocumentBounds(mag: Float32Array, width: number, height: number) {
  const nonZero = Array.from(mag).filter((v) => v > 0).sort((a, b) => a - b);
  const fallback = { left: 0, top: 0, right: width, bottom: height };
  if (nonZero.length === 0) return fallback;

  const threshold = percentileOf(nonZero, 0.85);
  const colDensity = new Float32Array(width);
  const rowDensity = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mag[y * width + x] >= threshold) {
        colDensity[x]++;
        rowDensity[y]++;
      }
    }
  }

  const colCut = height * 0.02;
  const rowCut = width * 0.02;

  let left = 0;
  while (left < width && colDensity[left] < colCut) left++;
  let right = width - 1;
  while (right > left && colDensity[right] < colCut) right--;
  let top = 0;
  while (top < height && rowDensity[top] < rowCut) top++;
  let bottom = height - 1;
  while (bottom > top && rowDensity[bottom] < rowCut) bottom--;

  const w = right - left;
  const h = bottom - top;
  // Guard against a degenerate/too-aggressive crop.
  if (w < width * 0.4 || h < height * 0.4) return fallback;
  return { left, top, right, bottom };
}

/** In-place adaptive contrast + soft-binarization "document filter": stretches
 *  the histogram, gamma-lifts the background toward white, and darkens ink so
 *  the photo reads like a scanned document. */
function applyDocumentFilter(imageData: ImageData) {
  const { data, width, height } = imageData;
  const n = width * height;
  const gray = computeGrayscale(imageData);

  const sorted = Float32Array.from(gray).sort();
  const lo = percentileOf(sorted, 0.02);
  const hi = percentileOf(sorted, 0.98);
  const range = Math.max(1, hi - lo);
  // Separates "ink" from "paper" without fully collapsing to pure black/white.
  const mid = lo + range * 0.55;

  for (let p = 0; p < n; p++) {
    let v = ((gray[p] - lo) / range) * 255;
    v = Math.max(0, Math.min(255, v));
    v = Math.pow(v / 255, 0.85) * 255; // gamma-lift background toward white

    if (v > mid + 25) {
      v = Math.min(255, v * 1.08 + 10);
    } else if (v < mid - 25) {
      v *= 0.6;
    }
    v = Math.max(0, Math.min(255, v));

    const i = p * 4;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
}

/** Runs the full capture -> crop -> enhance pipeline and returns a JPEG data
 *  URL of the cleaned-up document. */
export async function scanDocument(imageSrc: string): Promise<string> {
  const img = await loadImage(imageSrc);

  // Downscale for the edge-detection pass — full-resolution Sobel is
  // needlessly slow, and the crop region maps back proportionally.
  const scale = Math.min(1, ANALYSIS_MAX_DIMENSION / Math.max(img.width, img.height));
  const analysisW = Math.max(1, Math.round(img.width * scale));
  const analysisH = Math.max(1, Math.round(img.height * scale));
  const analysisCanvas = document.createElement('canvas');
  analysisCanvas.width = analysisW;
  analysisCanvas.height = analysisH;
  const actx = analysisCanvas.getContext('2d');
  if (!actx) throw new Error('Canvas 2D context unavailable');
  actx.drawImage(img, 0, 0, analysisW, analysisH);
  const analysisData = actx.getImageData(0, 0, analysisW, analysisH);
  const gray = computeGrayscale(analysisData);
  const mag = sobelMagnitude(gray, analysisW, analysisH);
  const bounds = detectDocumentBounds(mag, analysisW, analysisH);

  const marginX = (bounds.right - bounds.left) * 0.02;
  const marginY = (bounds.bottom - bounds.top) * 0.02;
  const sx = Math.max(0, (bounds.left - marginX) / scale);
  const sy = Math.max(0, (bounds.top - marginY) / scale);
  const ex = Math.min(img.width, (bounds.right + marginX) / scale);
  const ey = Math.min(img.height, (bounds.bottom + marginY) / scale);
  const cropW = Math.max(1, ex - sx);
  const cropH = Math.max(1, ey - sy);

  const outScale = Math.min(1, MAX_OUTPUT_DIMENSION / Math.max(cropW, cropH));
  const outW = Math.max(1, Math.round(cropW * outScale));
  const outH = Math.max(1, Math.round(cropH * outScale));

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const octx = outCanvas.getContext('2d');
  if (!octx) throw new Error('Canvas 2D context unavailable');
  octx.drawImage(img, sx, sy, cropW, cropH, 0, 0, outW, outH);

  const outData = octx.getImageData(0, 0, outW, outH);
  applyDocumentFilter(outData);
  octx.putImageData(outData, 0, 0);

  return outCanvas.toDataURL('image/jpeg', 0.92);
}
