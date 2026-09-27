// Optional cross-platform CLI convenience. Android Studio uses android/gradlew
// directly; release embeds Hermes JS/assets and DOES NOT need Metro/Expo Go.
const { existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const config = require('../public-build.json');

const mobile = path.resolve(__dirname, '..');
const android = path.join(mobile, 'android');
let expoReady = false;
try { expoReady = existsSync(require.resolve('expo/package.json', { paths: [mobile] })); }
catch { /* dependencies are not installed */ }
if (!expoReady) {
  console.error('Install dependencies first: corepack pnpm install --frozen-lockfile (from ZIP root).');
  process.exit(1);
}
let validApiUrl = false;
try {
  const apiUrl = new URL(config.EXPO_PUBLIC_API_URL);
  validApiUrl = apiUrl.protocol === 'https:' && !!apiUrl.hostname;
} catch { /* invalid or missing public API URL */ }
if (!validApiUrl ||
    !/^pk_(?:live|test)_[A-Za-z0-9_-]+$/.test(config.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || '')) {
  console.error('Update mobile/public-build.json with the full HTTPS API URL and Clerk production publishable key.');
  process.exit(1);
}
if (!existsSync(path.join(android, 'gradle', 'wrapper', 'gradle-wrapper.jar'))) {
  console.error('Missing Gradle wrapper: extract the complete ZIP, including mobile/android.');
  process.exit(1);
}
const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const result = spawnSync(gradle, [':app:assembleRelease'], {
  cwd: android,
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);