import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(mobileRoot, '../..');
const appConfig = JSON.parse(
  readFileSync(resolve(mobileRoot, 'app.json'), 'utf8'),
) as {
  expo: {
    android: {
      softwareKeyboardLayoutMode: string;
    };
  };
};
const webAppScreen = readFileSync(
  resolve(mobileRoot, 'components/WebAppScreen.tsx'),
  'utf8',
);
const webHome = readFileSync(
  resolve(workspaceRoot, 'artifacts/khatabook/src/pages/home.tsx'),
  'utf8',
);
const websiteCss = readFileSync(
  resolve(workspaceRoot, 'artifacts/khatabook/src/index.css'),
  'utf8',
);

describe('mobile viewport contract', () => {
  it('lets the website own the native WebView viewport without duplicate insets', () => {
    const websiteShell = webAppScreen.slice(
      webAppScreen.indexOf('const websiteView ='),
      webAppScreen.indexOf('const styles = StyleSheet.create'),
    );

    expect(websiteShell).toMatch(/<View style=\{\[styles\.root,/);
    expect(websiteShell).not.toMatch(/<SafeAreaView|<KeyboardAvoidingView/);
    expect(websiteShell).toContain('automaticallyAdjustContentInsets={false}');
    expect(websiteShell).toContain('contentInsetAdjustmentBehavior="never"');
  });

  it('resizes the Android WebView for the software keyboard', () => {
    expect(appConfig.expo.android.softwareKeyboardLayoutMode).toBe('resize');
  });

  it('does not let the native WebView force stale API cache responses', () => {
    expect(webAppScreen).not.toMatch(/cacheMode\s*=/);
    expect(webHome.match(/request:\s*\{\s*cache:\s*'no-store'\s*\}/g)).toHaveLength(2);
  });

  it('keeps safe-area and short-keyboard viewport rules in the website CSS', () => {
    expect(websiteCss).toMatch(/--safe-top:\s*env\(safe-area-inset-top,\s*0px\)/);
    expect(websiteCss).toMatch(/--safe-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)/);
    expect(websiteCss).toMatch(
      /\.party-transaction-actions\s*\{[^}]*max\(var\(--safe-bottom\),\s*1\.5rem\)/s,
    );
    expect(websiteCss).toMatch(
      /@media \(max-width: 640px\) and \(max-height: 680px\)[\s\S]*?\.sign-in-page/,
    );
    expect(websiteCss).toMatch(
      /\.sign-in-page input\s*\{[^}]*scroll-margin-block:\s*16px/s,
    );
  });
});