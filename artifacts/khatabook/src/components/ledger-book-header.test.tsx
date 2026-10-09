import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BusinessContextProvider, useBusinessContext } from '@/lib/businessContext';
import { BusinessSwitcherDrawer } from '@/components/modals/business-switcher-drawer';
import { LedgerBookHeader } from './ledger-book-header';

vi.mock('@/lib/i18n', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const SHORT_BOOK = 'আমার খাতা';
const LONG_BOOK = 'আমার খাতা Shakil Traders'.padEnd(40, 'X');
const BOOKS = [
  { id: 'book-short', name: SHORT_BOOK, partyCount: 2 },
  { id: 'book-long', name: LONG_BOOK, partyCount: 1 },
];

function HeaderWithSwitcher({ onRename }: { onRename: () => void }) {
  const {
    businesses,
    selectedBusinessId,
    openSwitcher,
  } = useBusinessContext();
  const activeBook = businesses.find((business) => business.id === selectedBusinessId);

  return (
    <>
      <div className="flex items-center justify-between gap-1 px-2">
        <LedgerBookHeader
          bookName={activeBook?.name ?? 'Loading'}
          isOwner
          onOpenSwitcher={openSwitcher}
          onRename={onRename}
        />
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" aria-label="Notifications">Bell</button>
          <button type="button" aria-label="Access">Access</button>
          <button type="button" aria-label="Duty folder">Folder</button>
        </div>
      </div>
      <BusinessSwitcherDrawer />
    </>
  );
}

describe('LedgerBookHeader', () => {
  afterEach(() => {
    cleanup();
    localStorage.removeItem('selected_business_id');
    vi.unstubAllGlobals();
  });

  it('keeps full names visible and updates immediately when switching books at phone width', async () => {
    expect(LONG_BOOK).toHaveLength(40);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    const onRename = vi.fn();
    const fetchBusinesses = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => BOOKS,
    });
    vi.stubGlobal('fetch', fetchBusinesses);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <BusinessContextProvider>
          <HeaderWithSwitcher onRename={onRename} />
        </BusinessContextProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId('active-book-switcher'));
    await waitFor(() => {
      expect(screen.getByTestId('active-book-name')).toHaveTextContent(SHORT_BOOK);
    });
    expect(fetchBusinesses).toHaveBeenCalledWith('/api/businesses', { credentials: 'include' });

    const bookTitle = screen.getByTestId('active-book-name');
    expect(bookTitle).toHaveClass('whitespace-normal', 'break-words');
    expect(bookTitle.className).toContain('[overflow-wrap:anywhere]');
    expect(bookTitle).not.toHaveClass('truncate', 'whitespace-nowrap');
    expect(screen.getByTestId('active-book-switcher')).not.toHaveClass('overflow-hidden');

    fireEvent.click(screen.getByText(LONG_BOOK));
    await waitFor(() => {
      expect(screen.getByTestId('active-book-name')).toHaveTextContent(LONG_BOOK);
    });
    expect(screen.getByTestId('active-book-switcher')).toHaveAttribute('aria-label', LONG_BOOK);

    fireEvent.click(screen.getByTestId('active-book-switcher'));
    await screen.findByText(SHORT_BOOK);
    fireEvent.click(screen.getByText(SHORT_BOOK));
    await waitFor(() => {
      expect(screen.getByTestId('active-book-name')).toHaveTextContent(SHORT_BOOK);
    });

    fireEvent.click(screen.getByTestId('business-book-rename'));
    expect(onRename).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Access' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duty folder' })).toBeInTheDocument();
  });
});
