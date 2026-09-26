(() => {
  'use strict';
  if (window !== window.top || window.__bkDownloads || !window.BKDownloads) return;
  window.__bkDownloads = true;
  const LIMIT = 64 * 1024 * 1024, CHUNK = 48 * 1024;
  const pending = new Map();
  let serial = 0, busy = false;
  BKDownloads.onmessage = event => {
    let reply;
    try { reply = JSON.parse(event.data); } catch (_) { return; }
    const request = pending.get(reply.token);
    if (!request) return;
    pending.delete(reply.token); clearTimeout(request.timer);
    if (reply.ok) request.resolve(reply);
    else request.reject(new DOMException(reply.error || 'Native download failed', 'AbortError'));
  };
  function send(payload) {
    return new Promise((resolve, reject) => {
      const token = String(++serial);
      const timer = setTimeout(() => {
        pending.delete(token);
        reject(new DOMException('Native download timed out. Please retry.', 'AbortError'));
      }, 120000);
      pending.set(token, {resolve, reject, timer});
      BKDownloads.postMessage(JSON.stringify({...payload, token}));
    });
  }
  function notify(error) {
    console.error('BanglaKhata download:', error);
    // Native protocol errors already display a toast; JS validation needs a visible error too.
    window.alert(error.message || String(error));
  }
  async function transfer(blob, name, mode, text) {
    if (busy) throw new DOMException('Another file is being saved. Please wait.', 'AbortError');
    if (!(blob instanceof Blob) || !blob.size || blob.size > LIMIT)
      throw new DOMException('File must be between 1 byte and 64 MiB.', 'AbortError');
    busy = true;
    const id = 'bk-' + Date.now() + '-' + serial;
    try {
      // Native waits for legacy storage permission BEFORE acknowledging begin.
      await send({op: 'begin', id, name: name || 'BanglaKhata-report', mime: blob.type,
        size: blob.size, mode, text: String(text || '').slice(0, 4000)});
      for (let offset = 0; offset < blob.size; offset += CHUNK) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + CHUNK).arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        await send({op: 'chunk', id, offset, data: btoa(binary)});
      }
      await send({op: 'end', id});
    } catch (error) {
      send({op: 'cancel', id}).catch(() => {});
      throw error;
    } finally { busy = false; }
  }
  // Retain the Blob itself until click starts, not just its soon-to-be-revoked URL.
  // WeakRef avoids retaining every website object URL indefinitely.
  const blobs = new Map();
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = blob => {
    const url = create(blob);
    if (blob instanceof Blob && typeof WeakRef === 'function') {
      if (blobs.size >= 256) blobs.delete(blobs.keys().next().value);
      blobs.set(url, new WeakRef(blob));
    }
    return url;
  };
  URL.revokeObjectURL = url => { blobs.delete(String(url)); return revoke(url); };
  function intercept(anchor) {
    if (!anchor || !anchor.href || !anchor.href.startsWith('blob:')) return false;
    const url = anchor.href, name = anchor.download;
    const blob = blobs.get(url)?.deref();
    // fetch starts synchronously before caller can immediately revoke the URL.
    const ready = blob ? Promise.resolve(blob) : fetch(url).then(r => {
      if (!r.ok) throw new Error('Cannot read generated file');
      return r.blob();
    });
    ready.then(b => transfer(b, name, 'download')).catch(notify);
    return true;
  }
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function() {
    if (!intercept(this)) return click.call(this);
  };
  // FileSaver commonly dispatches a synthetic MouseEvent on a detached anchor.
  const dispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function(event) {
    if (event.type === 'click' && this instanceof HTMLAnchorElement && intercept(this)) return true;
    return dispatch.call(this, event);
  };
  document.addEventListener('click', event => {
    const anchor = event.target?.closest?.('a');
    if (intercept(anchor)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  const originalShare = navigator.share?.bind(navigator);
  const originalCanShare = navigator.canShare?.bind(navigator);
  navigator.canShare = data => data?.files
    ? data.files.length === 1 && data.files[0] instanceof Blob &&
      data.files[0].size > 0 && data.files[0].size <= LIMIT
    : (originalCanShare ? originalCanShare(data) : false);
  navigator.share = async data => {
    if (!data?.files) {
      if (originalShare) return originalShare(data);
      throw new DOMException('Text sharing is unavailable on this WebView.', 'NotSupportedError');
    }
    if (!navigator.canShare(data)) {
      const error = new DOMException('Share supports one file, up to 64 MiB.', 'AbortError');
      notify(error); throw error;
    }
    try { await transfer(data.files[0], data.files[0].name, 'share', data.text); }
    catch (error) { notify(error); throw error; }
  };
})();