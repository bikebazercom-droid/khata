#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { chromium as playwrightChromium } from 'playwright-core';

const sizes = [
  { width: 390, height: 844 },
  { width: 412, height: 915 },
];

const routes = [
  {
    name: 'landing',
    webPath: '/',
    expoPath: '/',
  },
  {
    name: 'sign-in',
    webPath: '/sign-in',
    expoPath: '/sign-in',
    knownDifference: 'Expo uses its separate mobile sign-in screen.',
  },
  {
    name: 'party-ledger',
    webPath: '/src/visual-fixtures/index.html?screen=party-ledger',
    expoPath: '/?visualFixture=party-ledger',
    fixtureTestId: 'fixture-party-ledger',
  },
  {
    name: 'transaction-report',
    webPath: '/src/visual-fixtures/index.html?screen=transaction-report',
    expoPath: '/?visualFixture=transaction-report',
    fixtureTestId: 'fixture-transaction-report',
  },
];

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--') continue;
    if (!item.startsWith('--')) continue;
    const separator = item.indexOf('=');
    if (separator > 0) {
      options[item.slice(2, separator)] = item.slice(separator + 1);
    } else {
      options[item.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

function requireUrl(value, flag) {
  if (!value) throw new Error(`Missing required --${flag} URL.`);
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`--${flag} must use http or https.`);
  }
  return url;
}

async function waitForRoute(page, route, platform) {
  if (route.name === 'sign-in') {
    if (platform === 'web') {
      await page.getByRole('button', { name: 'Phone Number', exact: true }).click();
      await page.getByTestId('input-phone').waitFor({ state: 'visible' });
    } else {
      await page.getByTestId('auth-tab-phone').click();
      await page.getByTestId('sign-in-phone').waitFor({ state: 'visible' });
    }
    return;
  }

  if (platform === 'web') {
    if (route.fixtureTestId) {
      await page.getByTestId(route.fixtureTestId).waitFor({ state: 'visible' });
    } else {
      await page.getByText('বাংলা খাতা', { exact: true }).first().waitFor({ state: 'visible' });
    }
    return;
  }

  const appFrame = page.frameLocator('iframe[title="BanglaKhata"]');
  if (route.fixtureTestId) {
    await appFrame.getByTestId(route.fixtureTestId).waitFor({ state: 'visible' });
  } else {
    await appFrame.getByText('বাংলা খাতা', { exact: true }).first().waitFor({ state: 'visible' });
  }
  await page.getByText(/বাংলাখাতা খোলা হচ্ছে/).waitFor({ state: 'hidden' });
  await page.getByText('ওয়েবসাইট খোলা যায়নি').waitFor({ state: 'hidden' });
}

async function captureScreenshot({ browser, url, output, viewport, route, platform, timeoutMs }) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (response && response.status() >= 400) {
      throw new Error(`${platform} returned HTTP ${response.status()} for ${url}`);
    }
    await waitForRoute(page, route, platform);
    await page.screenshot({ path: output, animations: 'disabled', fullPage: false });
  } finally {
    await context.close();
  }
}

function compareScreenshots({ magick, webImage, expoImage, diffImage }) {
  const result = spawnSync(
    magick,
    ['compare', '-metric', 'AE', webImage, expoImage, diffImage],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`ImageMagick could not compare screenshots.\n${result.stderr || result.stdout}`);
  }

  const metric = `${result.stderr || ''}\n${result.stdout || ''}`.trim();
  const normalized = metric.match(/\(([\d.]+)\)/)?.[1];
  if (!normalized) throw new Error(`Could not parse ImageMagick difference metric: ${metric}`);
  return Number(normalized) * 100;
}

function makeUrl(baseUrl, path) {
  const url = new URL(path, baseUrl);
  return url.toString();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const webBase = requireUrl(options['web-url'], 'web-url');
  const expoBase = requireUrl(options['expo-url'], 'expo-url');
  const executablePath = options.chromium || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
  const magick = options.magick || 'magick';
  const timeoutMs = Number(options['capture-timeout-ms'] || 45000);
  const maxDiffPercent = Number(options['max-diff-percent'] || 1.5);
  const outputDir = resolve(
    options['output-dir'] || mkdtempSync(join(tmpdir(), 'banglakhata-visual-parity-')),
  );

  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
    throw new Error('--capture-timeout-ms must be at least 1000.');
  }
  if (!Number.isFinite(maxDiffPercent) || maxDiffPercent < 0) {
    throw new Error('--max-diff-percent must be zero or greater.');
  }
  mkdirSync(outputDir, { recursive: true });

  const browser = await playwrightChromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars'],
  });
  let failures = 0;

  try {
    console.log(`Saving screenshots and difference images to ${outputDir}`);
    for (const viewport of sizes) {
      for (const route of routes) {
        const webImage = join(outputDir, `${route.name}-${viewport.width}x${viewport.height}-web.png`);
        const expoImage = join(outputDir, `${route.name}-${viewport.width}x${viewport.height}-expo.png`);
        const diffImage = join(outputDir, `${route.name}-${viewport.width}x${viewport.height}-diff.png`);
        const common = { browser, route, viewport, timeoutMs };

        await Promise.all([
          captureScreenshot({
            ...common,
            url: makeUrl(webBase, route.webPath),
            output: webImage,
            platform: 'web',
          }),
          captureScreenshot({
            ...common,
            url: makeUrl(expoBase, route.expoPath),
            output: expoImage,
            platform: 'expo',
          }),
        ]);

        const diffPercent = compareScreenshots({ magick, webImage, expoImage, diffImage });
        const viewportLabel = `${viewport.width}×${viewport.height}`;

        if (route.knownDifference && diffPercent > maxDiffPercent) {
          console.log(
            `KNOWN DIFFERENCE ${route.name} ${viewportLabel}: ${diffPercent.toFixed(2)}% — ${route.knownDifference} (${basename(diffImage)})`,
          );
        } else if (diffPercent > maxDiffPercent) {
          failures += 1;
          console.error(
            `MISMATCH ${route.name} ${viewportLabel}: ${diffPercent.toFixed(2)}% exceeds ${maxDiffPercent.toFixed(2)}% (${basename(diffImage)})`,
          );
        } else {
          console.log(`MATCH ${route.name} ${viewportLabel}: ${diffPercent.toFixed(2)}%`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (failures > 0) {
    console.error(`${failures} unexpected visual mismatch(es).`);
    process.exitCode = 1;
  } else {
    console.log('No unexpected web/Expo visual mismatches found.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
