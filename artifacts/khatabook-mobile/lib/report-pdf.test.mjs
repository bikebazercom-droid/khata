import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPdfFile, reportPdfName, shareReportPdf } from './report-pdf.ts';

function file(text = '%PDF-1.7\n', exists = true) {
  const bytes = new TextEncoder().encode(text);
  return {
    exists, size: bytes.length, closed: false,
    open() {
      return {
        readBytes: (length) => bytes.slice(0, length),
        close: () => { this.closed = true; },
      };
    },
  };
}

test('accepts a PDF signature and closes the native handle', () => {
  const pdf = file();
  assertPdfFile(pdf);
  assert.equal(pdf.closed, true);
});

test('rejects missing, empty, truncated, and non-PDF generated files', () => {
  for (const pdf of [file('', false), file(''), file('%PDF'), file('<html>error')]) {
    assert.throws(() => assertPdfFile(pdf), /missing or empty|not a PDF/);
  }
  const invalid = file('<html>error');
  assert.throws(() => assertPdfFile(invalid));
  assert.equal(invalid.closed, true);
});

test('closes the handle even when the native read fails', () => {
  let closed = false;
  assert.throws(() => assertPdfFile({
    exists: true, size: 100,
    open: () => ({
      readBytes() { throw new Error('read failed'); },
      close() { closed = true; },
    }),
  }), /read failed/);
  assert.equal(closed, true);
});

test('Bengali names remain readable and different parties cannot overwrite each other', () => {
  assert.equal(reportPdfName('12', 'করিম'), '12_করিম_report.pdf');
  assert.notEqual(reportPdfName('12', 'করিম'), reportPdfName('13', 'করিম'));
  assert.notEqual(reportPdfName('12', 'করিম'), reportPdfName('13', 'রহিম'));
  assert.ok(!reportPdfName('12', '../a/b\\c').includes('/'));
});

test('passes Android MIME and iOS UTI to the native sheet; dismissal is not a delivery claim', async () => {
  const calls = [];
  const result = await shareReportPdf('file:///report.pdf', file(), {
    isAvailableAsync: async () => true,
    shareAsync: async (...args) => { calls.push(args); },
  });
  assert.equal(result, 'dismissed');
  assert.equal(calls[0][0], 'file:///report.pdf');
  assert.equal(calls[0][1].mimeType, 'application/pdf');
  assert.equal(calls[0][1].UTI, 'com.adobe.pdf');
});

test('unavailable sharing does not attempt to open the sheet', async () => {
  assert.equal(await shareReportPdf('file:///report.pdf', file(), {
    isAvailableAsync: async () => false,
    shareAsync: async () => assert.fail('must not share'),
  }), 'unavailable');
});

test('a deleted or invalid saved PDF is never handed to another app', async () => {
  for (const pdf of [file('', false), file('not a pdf')]) {
    await assert.rejects(shareReportPdf('file:///report.pdf', pdf, {
      isAvailableAsync: async () => true,
      shareAsync: async () => assert.fail('must not share'),
    }));
  }
});

test('native share failures (including missing targets) are not swallowed as cancellation', async () => {
  await assert.rejects(shareReportPdf('file:///report.pdf', file(), {
    isAvailableAsync: async () => true,
    shareAsync: async () => { throw new Error('No share target'); },
  }), /No share target/);
});