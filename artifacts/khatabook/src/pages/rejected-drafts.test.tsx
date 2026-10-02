import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  listRejectedEntries: vi.fn(),
  discardRejectedEntry: vi.fn(),
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/rejected-drafts', mocks.navigate],
}));

vi.mock('@/App', () => ({
  useAppAuth: () => ({ userId: 'owner-A' }),
}));

vi.mock('@/lib/businessContext', () => ({
  useBusinessContext: () => ({ selectedBusinessId: 'business-A' }),
}));

vi.mock('@/lib/authCache', () => ({
  readOfflineIdentity: () => null,
}));

vi.mock('@/lib/entryOutbox', () => ({
  ENTRY_OUTBOX_CHANGED: 'test-outbox-change',
  listRejectedEntries: mocks.listRejectedEntries,
  discardRejectedEntry: mocks.discardRejectedEntry,
}));

vi.mock('@workspace/api-client-react', () => ({
  useListParties: () => ({ data: [{ id: 'party-A', name: 'রহিম স্টোর' }] }),
  getListPartiesQueryKey: () => ['/api/parties'],
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

import { RejectedDraftsPage } from './rejected-drafts';

const rejectedDraft = {
  id: 'draft-rejected',
  actorId: 'owner-A',
  businessId: 'business-A',
  partyId: 'party-A',
  data: { type: 'YOU_GOT', amount: 725, description: 'পণ্য ফেরত' },
  createdAt: '2026-10-01T10:00:00.000Z',
  status: 'rejected' as const,
  error: 'এই হিসাবে আপনার প্রবেশাধিকার নেই।',
};

describe('rejected browser drafts', () => {
  beforeEach(() => {
    mocks.listRejectedEntries.mockReset().mockResolvedValue([rejectedDraft]);
    mocks.discardRejectedEntry.mockReset().mockResolvedValue(true);
    mocks.navigate.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the rejected draft and the server-provided reason', async () => {
    render(<RejectedDraftsPage />);

    expect(await screen.findByText('রহিম স্টোর')).toBeTruthy();
    expect(screen.getByText('এই হিসাবে আপনার প্রবেশাধিকার নেই।')).toBeTruthy();
    expect(screen.getByText('পণ্য ফেরত')).toBeTruthy();
  });

  it('discards only after the owner confirms', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<RejectedDraftsPage />);

    const discardButton = await screen.findByRole('button', { name: 'খসড়া মুছুন' });
    fireEvent.click(discardButton);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.discardRejectedEntry).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(discardButton);
    await waitFor(() => expect(mocks.discardRejectedEntry).toHaveBeenCalledWith(
      'draft-rejected',
      'owner-A',
      'business-A',
      false,
    ));
  });
});