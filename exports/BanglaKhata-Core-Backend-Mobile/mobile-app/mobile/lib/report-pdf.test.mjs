import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPdfFile, reportPdfName, shareReportPdf, saveReportPdfToFolder, FolderPdfError, MAX_FOLDER_PDF_BYTES } from './report-pdf.ts';

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

function folderApi(overrides = {}) {
  const calls = [];
  const api = {
    requestDirectoryPermissionsAsync: async () => {
      calls.push('picker');
      return { granted: true, directoryUri: 'content://tree/folder' };
    },
    readAsStringAsync: async (uri, options) => {
      calls.push(['read', uri, options]);
      return 'JVBERi0xLjcK';
    },
    createFileAsync: async (...args) => {
      calls.push(['create', ...args]);
      return 'content://tree/folder/document/report';
    },
    writeAsStringAsync: async (...args) => { calls.push(['write', ...args]); },
    deleteAsync: async (...args) => { calls.push(['delete', ...args]); },
    getInfoAsync: async () => ({ exists: false }),
    ...overrides,
  };
  return { api, calls };
}
const saveFolder = (api, pdf = file(), platform = 'android') =>
  saveReportPdfToFolder(platform, 'file:///private.pdf', pdf, '12', 'করিম', api);

test('folder save grants scoped access, uses Bengali name/MIME and retains the private PDF', async () => {
  const { api, calls } = folderApi();
  const pdf = file();
  assert.equal(await saveFolder(api, pdf), 'saved');
  assert.deepEqual(calls.map(c => Array.isArray(c) ? c[0] : c), ['picker', 'read', 'create', 'write']);
  assert.deepEqual(calls[2], ['create', 'content://tree/folder', '12_করিম_report', 'application/pdf']);
  assert.deepEqual(calls[3], ['write', 'content://tree/folder/document/report', 'JVBERi0xLjcK', { encoding: 'base64' }]);
  assert.equal(pdf.exists, true);
});

test('iOS and web never request Android permissions or read/write a file', async () => {
  const { api, calls } = folderApi();
  for (const platform of ['ios', 'web']) assert.equal(await saveFolder(api, file(), platform), 'unsupported');
  assert.deepEqual(calls, []);
});

test('cancel/declined grant does not create or read a document', async () => {
  const { api, calls } = folderApi({
    requestDirectoryPermissionsAsync: async () => ({ granted: false }),
  });
  assert.equal(await saveFolder(api), 'not-granted');
  assert.deepEqual(calls, []);
});

test('invalid and oversized PDFs are rejected before the picker and base64 allocation', async () => {
  const { api, calls } = folderApi();
  for (const pdf of [file('bad'), { ...file(), size: MAX_FOLDER_PDF_BYTES + 1 }, { ...file(), size: NaN }]) {
    await assert.rejects(saveFolder(api, pdf));
  }
  assert.deepEqual(calls, []);
});

test('picker rejection, malformed grant, private read failure and creation denial are failures, not success', async () => {
  for (const override of [
    { requestDirectoryPermissionsAsync: async () => { throw new Error('Permission denied'); } },
    { requestDirectoryPermissionsAsync: async () => ({ granted: true }) },
    { readAsStringAsync: async () => { throw new Error('Read failed'); } },
    { createFileAsync: async () => { throw new Error('Provider unavailable'); } },
  ]) {
    const { api, calls } = folderApi(override);
    await assert.rejects(saveFolder(api), FolderPdfError);
    assert.ok(!calls.some(c => ['write', 'delete'].includes(c[0])));
  }
});

test('write rejection (low disk, lost permission, provider failure) cleans up only the external document', async () => {
  for (const reason of ['ENOSPC', 'Permission denied', 'Provider disconnected']) {
    const { api, calls } = folderApi({
      writeAsStringAsync: async () => { throw new Error(reason); },
    });
    await assert.rejects(saveFolder(api), error => error instanceof FolderPdfError && !error.cleanupFailed);
    assert.deepEqual(calls.at(-1), ['delete', 'content://tree/folder/document/report', { idempotent: true }]);
  }
});

test('failed cleanup including silent native delete failure warns about the partial document', async () => {
  for (const override of [
    { deleteAsync: async () => { throw new Error('delete denied'); } },
    { getInfoAsync: async () => ({ exists: true }) },
    { getInfoAsync: async () => { throw new Error('provider offline'); } },
  ]) {
    const { api } = folderApi({
      writeAsStringAsync: async () => { throw new Error('disk full'); },
      ...override,
    });
    await assert.rejects(saveFolder(api), error => error.cleanupFailed && /অসম্পূর্ণ/.test(error.message));
  }
});

test('does not report success while the external write is pending', async () => {
  let finishWrite;
  let started;
  const writing = new Promise(resolve => { started = resolve; });
  const { api } = folderApi({
    writeAsStringAsync: () => { started(); return new Promise(resolve => { finishWrite = resolve; }); },
  });
  let settled = false;
  const saving = saveFolder(api).then(result => { settled = true; return result; });
  await writing;
  assert.equal(settled, false);
  finishWrite();
  assert.equal(await saving, 'saved');
});