import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFetchEventStream } from './fetchEventStream';

const encoder = new TextEncoder();
const openStreams: Array<ReturnType<typeof createFetchEventStream>> = [];
function open() {
  const stream = createFetchEventStream('/api/events', 'assigned-book');
  openStreams.push(stream);
  return stream;
}
function response() {
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; } });
  return { writer, value: new Response(body, { headers: { 'content-type': 'text/event-stream' } }) };
}

afterEach(() => {
  openStreams.splice(0).forEach((stream) => stream.close());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('authenticated live event transport', () => {
  it('uses normal fetch with cookies and the assigned book header, parsing split Bengali event data', async () => {
    const r = response();
    const fetchMock = vi.fn().mockResolvedValue(r.value);
    vi.stubGlobal('fetch', fetchMock);
    const stream = open();
    const connected = vi.fn();
    const entry = vi.fn();
    stream.addEventListener('connected', connected);
    stream.addEventListener('ledger.created', entry);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith('/api/events', expect.objectContaining({
      credentials: 'include', cache: 'no-store',
      headers: { Accept: 'text/event-stream', 'x-business-id': 'assigned-book' },
    }));
    const message = encoder.encode('event: connected\r\ndata: {}\r\n\r\nevent: ledger.created\ndata: {"partyId":"ক"}\n\n');
    for (let i = 0; i < message.length; i++) r.writer.enqueue(message.slice(i, i + 1));
    await vi.waitFor(() => expect(entry).toHaveBeenCalledOnce());
    expect(connected).toHaveBeenCalledOnce();
    expect(JSON.parse(entry.mock.calls[0]![0].data)).toEqual({ partyId: 'ক' });
  });

  it('reconnects a dropped stream and stops all requests when the book is changed or closed', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error('Disconnected'));
    vi.stubGlobal('fetch', fetchMock);
    const stream = open();
    const errors = vi.fn();
    stream.addEventListener('error', errors);
    await vi.advanceTimersByTimeAsync(1);
    expect(errors).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stream.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports HTTP auth/proxy failures instead of treating an HTML response as a working connection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } }),
    ));
    const stream = open();
    const errors = vi.fn();
    stream.addEventListener('error', errors);
    await vi.waitFor(() => expect(errors).toHaveBeenCalledOnce());
  });
});
