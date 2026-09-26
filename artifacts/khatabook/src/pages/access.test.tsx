import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AccessPage } from './access';

const owner = vi.hoisted(() => ({
  workers: [] as Array<{ id: string; identity: string; status: 'active' | 'pending'; partyIds: string[]; adjustmentPartyIds: string[]; lastLogin: null; lastLogout: null; invitedAt: null }>,
  parties: [] as Array<{ id: string; name: string; role: 'CUSTOMER' | 'SUPPLIER' }>,
  mutate: vi.fn(),
  partiesError: false,
}));

vi.mock('wouter', () => ({ useLocation: () => ['/', vi.fn()] }));
vi.mock('@/hooks/use-owner', () => ({
  useOwnerWorkers: () => ({ data: owner.workers, isLoading: false, isError: false }),
  useOwnerParties: () => ({ data: owner.parties, isLoading: false, isFetching: false, isError: owner.partiesError, refetch: vi.fn() }),
  useOwnerActivity: () => ({ data: { entries: [] }, isLoading: false, isError: false }),
  useCreateWorker: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateWorker: () => ({ mutate: owner.mutate, isPending: false }),
  useDeleteWorker: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const workerId = '33333333-3333-4333-8333-333333333333';

describe('party access worker adjustment editor', () => {
  beforeEach(() => {
    owner.workers = [{
      id: workerId, identity: 'milon@example.com', status: 'pending',
      partyIds: [a], adjustmentPartyIds: [a], lastLogin: null, lastLogout: null, invitedAt: null,
    }];
    owner.parties = [
      { id: a, name: 'Mohin', role: 'CUSTOMER' },
      { id: b, name: 'Supplier B', role: 'SUPPLIER' },
    ];
    owner.partiesError = false;
    owner.mutate.mockReset();
  });
  afterEach(cleanup);

  const openParty = () => {
    render(<AccessPage />);
    fireEvent.click(screen.getByText('Mohin'));
  };

  it('lists all owner parties, preselects pending grants, and cancels without a request', () => {
    openParty();
    const assigned = screen.getByTestId(`input-party-worker-adjustment-${workerId}-${a}`);
    const other = screen.getByTestId(`input-party-worker-adjustment-${workerId}-${b}`);
    expect(assigned).toHaveAttribute('data-state', 'checked');
    expect(other).not.toBeDisabled();
    fireEvent.click(screen.getByTestId(`input-party-worker-access-${workerId}-${b}`));
    fireEvent.click(other);
    expect(other).toHaveAttribute('data-state', 'checked');
    fireEvent.click(screen.getByTestId(`button-cancel-party-worker-permissions-${workerId}`));
    expect(other).not.toBeDisabled();
    expect(assigned).toHaveAttribute('data-state', 'checked');
    expect(owner.mutate).not.toHaveBeenCalled();
  });

  it('searches all parties but saves complete assignments and explicit adjustment grants', () => {
    openParty();
    fireEvent.change(screen.getByTestId(`input-party-worker-search-${workerId}`), { target: { value: 'Supplier' } });
    expect(screen.queryByTestId(`row-party-worker-permission-${workerId}-${a}`)).not.toBeInTheDocument();
    const row = screen.getByTestId(`row-party-worker-permission-${workerId}-${b}`);
    expect(within(row).getByText('Supplier B')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`input-party-worker-adjustment-${workerId}-${b}`));
    fireEvent.click(screen.getByTestId(`button-save-party-worker-permissions-${workerId}`));
    expect(owner.mutate).toHaveBeenCalledWith({
      id: workerId, payload: { partyIds: [a], adjustmentPartyIds: [a, b] },
    }, expect.any(Object));
  });

  it('disables saving on a failed party list and shows a retry action', () => {
    const view = render(<AccessPage />);
    fireEvent.click(screen.getByText('Mohin'));
    owner.partiesError = true;
    view.rerender(<AccessPage />);
    expect(screen.getByTestId(`button-retry-party-worker-parties-${workerId}`)).toBeInTheDocument();
    expect(screen.getByTestId(`button-save-party-worker-permissions-${workerId}`)).toBeDisabled();
  });

  it('handles an active worker and displays server save errors without discarding the draft', () => {
    owner.workers[0]!.status = 'active';
    owner.mutate.mockImplementation((_request, callbacks) => callbacks.onError(new Error('Invitation was already claimed')));
    openParty();
    expect(screen.getByText('অ্যাক্টিভ')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`input-party-worker-access-${workerId}-${b}`));
    fireEvent.click(screen.getByTestId(`button-save-party-worker-permissions-${workerId}`));
    expect(screen.getByTestId(`status-party-worker-save-error-${workerId}`)).toHaveTextContent('Invitation was already claimed');
    expect(screen.getByTestId(`input-party-worker-access-${workerId}-${b}`)).toHaveAttribute('data-state', 'checked');
  });
});