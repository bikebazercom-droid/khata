import { describe, expect, it } from 'vitest';
import { isLazyChunkLoadError } from '../lib/lazyWithChunkRecovery';

describe('lazy chunk recovery classification', () => {
  it('recognizes browser dynamic-import and chunk deployment failures', () => {
    expect(isLazyChunkLoadError(new TypeError('Failed to fetch dynamically imported module'))).toBe(true);
    expect(isLazyChunkLoadError(new Error('Loading chunk 42 failed'))).toBe(true);
    expect(isLazyChunkLoadError(new Error('Unable to preload CSS for /assets/home.css'))).toBe(true);
  });

  it('does not reload for ordinary application render errors', () => {
    expect(isLazyChunkLoadError(new Error("Cannot read properties of undefined (reading 'name')"))).toBe(false);
    expect(isLazyChunkLoadError('invalid OTP')).toBe(false);
  });
});