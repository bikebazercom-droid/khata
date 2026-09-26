/* Focused protocol/DOM simulation only; this is NOT an Android/WebView device test. */
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const script = readFileSync(join(__dirname, '../app/src/main/assets/native-downloads.js'), 'utf8');
const pause = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await pause(); }
  throw Error('Timed out waiting for test condition');
}
function setup({weak = true, subframe = false} = {}) {
  const messages = [], alerts = [], urls = new Map(), listeners = {};
  let number = 0, holdBegin = false, denied = false, held;
  const bridge = {
    postMessage(raw) {
      const message = JSON.parse(raw);
      messages.push(message);
      const reply = () => bridge.onmessage({data: JSON.stringify({
        token: message.token, ok: !(denied && message.op === 'begin'), error: 'Storage permission denied'
      })});
      if (holdBegin && message.op === 'begin') held = reply;
      else queueMicrotask(reply);
    }
  };
  class Target {
    dispatchEvent(event) {
      listeners[event.type]?.({...event, target: this, preventDefault() {}, stopImmediatePropagation() {}});
      return true;
    }
  }
  class Anchor extends Target {
    constructor() { super(); this.href = ''; this.download = ''; }
    click() { this.dispatchEvent({type: 'click'}); }
    closest() { return this; }
  }
  const context = {
    Blob, DOMException, Uint8Array, WeakRef: weak ? WeakRef : undefined,
    Date, Promise, Map, String, JSON, console: {error() {}},
    btoa: text => Buffer.from(text, 'binary').toString('base64'),
    setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), clearTimeout,
    BKDownloads: bridge, navigator: {}, EventTarget: Target, HTMLAnchorElement: Anchor,
    document: {addEventListener: (type, fn) => { listeners[type] = fn; }},
    alert: error => alerts.push(error),
    URL: {
      createObjectURL(blob) { const url = `blob:https://hazarikhata.replit.app/${++number}`; urls.set(url, blob); return url; },
      revokeObjectURL(url) { urls.delete(url); }
    },
    fetch(url) {
      const blob = urls.get(url); // Capture before synchronous revoke, like a started blob fetch.
      return blob ? Promise.resolve({ok: true, blob: async () => blob}) : Promise.reject(Error('Revoked URL'));
    }
  };
  context.window = context; context.top = subframe ? {} : context;
  vm.runInNewContext(script, context);
  return {context, messages, alerts, Anchor,
    hold() { holdBegin = true; }, grant() { held(); }, deny() { denied = true; held(); }};
}
async function anchorCase(synthetic, weak) {
  const env = setup({weak}), {context: c, messages, Anchor} = env;
  const blob = new Blob(['%PDF-test-', 'x'.repeat(110000)], {type: 'application/pdf'});
  const a = new Anchor();
  a.href = c.URL.createObjectURL(blob); a.download = 'বাংলা-report.pdf';
  if (synthetic) a.dispatchEvent({type: 'click'}); else a.click();
  c.URL.revokeObjectURL(a.href);
  await waitFor(() => messages.some(m => m.op === 'end'));
  assert.equal(messages.filter(m => m.op === 'begin').length, 1, 'no duplicate click handling');
  const chunks = messages.filter(m => m.op === 'chunk');
  assert.equal(chunks.length, 3);
  assert.equal(Buffer.concat(chunks.map(m => Buffer.from(m.data, 'base64'))).toString(), await blob.text());
  assert.deepEqual(chunks.map(m => m.offset), [0, 49152, 98304]);
  assert.equal(messages[0].mode, 'download');
}
(async () => {
  await anchorCase(false, true);
  await anchorCase(true, true); // detached FileSaver dispatch
  await anchorCase(false, false); // older WebView WeakRef fallback
  const env = setup(), c = env.context;
  const file = new Blob(['%PDF-share'], {type: 'application/pdf'}); file.name = 'statement.pdf';
  assert.equal(c.navigator.canShare({files: [file]}), true);
  env.hold();
  const sharing = c.navigator.share({files: [file], text: 'Reminder'});
  await waitFor(() => env.messages.length === 1);
  await pause();
  assert.equal(env.messages[0].op, 'begin');
  assert.equal(env.messages.some(m => m.op === 'chunk'), false, 'wait for permission ACK');
  env.grant(); await sharing;
  assert.equal(env.messages[0].mode, 'share');
  assert.equal(env.messages[0].text, 'Reminder');
  assert.equal(env.messages.filter(m => m.op === 'begin').length, 1, 'share never duplicates a download');
  const refused = setup(); refused.hold();
  const rejection = refused.context.navigator.share({files: [file]}).then(
    () => { throw Error('Expected permission rejection'); }, error => assert.equal(error.name, 'AbortError'));
  await waitFor(() => refused.messages.length === 1);
  refused.deny(); await rejection;
  assert.equal(refused.messages.some(m => m.op === 'chunk'), false);
  assert.equal(refused.messages.some(m => m.op === 'cancel'), true);
  const oversized = new Blob(); Object.defineProperty(oversized, 'size', {value: 67108865});
  assert.equal(c.navigator.canShare({files: [oversized]}), false);
  assert.equal(c.navigator.canShare({files: [file, file]}), false);
  await assert.rejects(c.navigator.share({files: [oversized]}), {name: 'AbortError'});
  assert.equal(setup({subframe: true}).context.__bkDownloads, undefined);
  console.log('PASS: immediate revoke, detached FileSaver click, WeakRef fallback, chunk bytes/offsets, share-only, permission ACK/denial, size/file-count bounds, main-frame guard');
})().catch(error => { console.error(error); process.exitCode = 1; });