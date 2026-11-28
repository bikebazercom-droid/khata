/**
 * SSE over fetch, so the normal native authentication wrapper and the active
 * business header apply. EventSource cannot attach either request header.
 */
export function createFetchEventStream(url: string, businessId: string | null) {
  const events = new EventTarget();
  let closed = false;
  let controller: AbortController | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let retryMs = 1000;

  async function connect() {
    controller = new AbortController();
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const touch = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => controller?.abort(), 45_000);
    };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      touch();
      const response = await fetch(url, {
        credentials: 'include', cache: 'no-store', signal: controller.signal,
        headers: {
          Accept: 'text/event-stream',
          ...(businessId ? { 'x-business-id': businessId } : {}),
        },
      });
      if (!response.ok || !response.body ||
          !response.headers.get('content-type')?.includes('text/event-stream')) {
        await response.body?.cancel();
        throw new Error(`Live connection unavailable (${response.status})`);
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let type = 'message';
      let data: string[] = [];
      while (!closed) {
        const chunk = await reader.read();
        if (chunk.done) break;
        touch();
        buffer += decoder.decode(chunk.value, { stream: true });
        if (buffer.length > 256_000) throw new Error('Live event exceeded limit');
        let newline: number;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (!line) {
            if (data.length) events.dispatchEvent(new MessageEvent(type, { data: data.join('\n') }));
            type = 'message';
            data = [];
          } else if (line.startsWith('event:')) type = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
          else if (/^retry: ?\d+$/.test(line)) retryMs = Math.max(500, Math.min(5000, Number(line.slice(6))));
        }
      }
    } catch {
      // A dropped or proxy-buffered stream is recovered below, without writes.
    } finally {
      clearTimeout(watchdog);
      void reader?.cancel().catch(() => {});
      if (!closed) {
        events.dispatchEvent(new MessageEvent('error'));
        reconnect = setTimeout(() => { void connect(); }, retryMs);
      }
    }
  }
  // Let the caller register handlers before even a cached response resolves.
  void Promise.resolve().then(() => { if (!closed) void connect(); });
  return {
    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      events.addEventListener(type, listener as EventListener);
    },
    close() {
      closed = true;
      clearTimeout(reconnect);
      controller?.abort();
    },
  };
}
