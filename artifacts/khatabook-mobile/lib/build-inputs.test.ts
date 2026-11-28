// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appRoot = new URL('../', import.meta.url);
const appRequire = createRequire(new URL('../package.json', import.meta.url));

describe('mobile build inputs', () => {
  it('loads the Worklets compiler with its declared Babel dependencies', () => {
    const babel = appRequire('@babel/core');
    const plugin = appRequire('react-native-worklets/plugin');
    const result = babel.transformSync(
      "function sampleWorklet() { 'worklet'; return 42; }",
      {
        filename: fileURLToPath(import.meta.url),
        plugins: [plugin],
        babelrc: false,
        configFile: false,
      },
    );
    expect(result.code).toContain('__workletHash');
  });

  it('uses separate square launcher artwork and a padded adaptive foreground', () => {
    const { expo } = JSON.parse(readFileSync(new URL('app.json', appRoot), 'utf8'));
    expect(expo.android.package).toBe('com.banglakhata.app');
    expect(expo.android.adaptiveIcon.foregroundImage).not.toBe(expo.icon);
    expect(expo.android.adaptiveIcon.backgroundColor).toBe('#194D8F');
    for (const asset of [expo.icon, expo.android.adaptiveIcon.foregroundImage]) {
      const png = readFileSync(fileURLToPath(new URL(asset, appRoot)));
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(png.readUInt32BE(16)).toBe(1024);
      expect(png.readUInt32BE(20)).toBe(1024);
    }
    const foreground = readFileSync(new URL(expo.android.adaptiveIcon.foregroundImage, appRoot));
    // RGBA is required to preserve the transparent Android mask padding.
    expect(foreground[25]).toBe(6);
  });
});
