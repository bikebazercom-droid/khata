import '@testing-library/jest-dom';

/**
 * Vitest / jsdom global stubs needed by the modules under test.
 *
 * billImageStorage.ts reads `import.meta.env.BASE_URL` at module level.
 * jsdom doesn't set it, so we patch it here before any test file imports
 * the module.
 */
Object.defineProperty(import.meta, 'env', {
  value: { BASE_URL: '/' },
  writable: true,
});
