import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
const streams = vi.hoisted(() => ({ created: [] as Array<{
  url: string; businessId: string | null; close: ReturnType<typeof vi.fn>;
  handlers: Record<string, (event: MessageEvent) => void>;
}> }));
vi.mock('./fetchEventStream', () => ({
  createFetchEventStream: (url: string, businessId: string | null) => {
    const stream = { url, businessId, close: vi.fn(), handlers: {} as Record<string, (event: MessageEvent) => void> };
    streams.created.push(stream);
    return {
      close: stream.close,
      addEventListener: (type: string, handler: (event: MessageEvent) => void) => { stream.handlers[type] = handler; },
    };
  },
}));
import { useRealtimeSync } from './useRealtimeSync';
const online = vi.fn();
function Probe({ book }: { book: string }) {
  useRealtimeSync(true, online, undefined, book, 'staff-user');
  return null;
}
afterEach(() => {
  cleanup(); streams.created.length = 0; online.mockReset();
  vi.useRealTimers(); vi.unstubAllGlobals();
});
describe('live ledger cache sync', () => {
  it('refreshes party list and ledger details together and reconnects to the selected book', () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: React.PropsWithChildren) =>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const view = render(<Probe book="book-a" />, { wrapper });
    const a = streams.created[0]!;
    expect(a.businessId).toBe('book-a');
    act(() => a.handlers['ledger.created']!(new MessageEvent('ledger.created', { data: '{"partyId":"party-1"}' })));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/parties/party-1/ledger-entries'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/parties'] });
    view.rerender(<Probe book="book-b" />);
    expect(a.close).toHaveBeenCalledOnce();
    expect(streams.created[1]!.businessId).toBe('book-b');
  });

  it('keeps normal API access online and refreshes caches when a proxy breaks only streaming', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"status":"ok"}')));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(<QueryClientProvider client={client}><Probe book="book-a" /></QueryClientProvider>);
    act(() => streams.created[0]!.handlers.error!(new MessageEvent('error')));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(online).toHaveBeenCalledWith(true);
    expect(online).not.toHaveBeenCalledWith(false);
    expect(invalidate).toHaveBeenCalledWith();
  });
});
