import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthConnectivityGate } from '../components/auth-connectivity-gate';

describe('auth connectivity route gate', () => {
  it('keeps the Clerk sign-in interface available when connectivity is offline', () => {
    render(
      <AuthConnectivityGate
        path="/sign-in"
        phase="offline"
        hasOfflineIdentity={false}
        onRetry={vi.fn()}
      >
        <div>Clerk sign-in interface</div>
      </AuthConnectivityGate>,
    );

    expect(screen.getByText('Clerk sign-in interface')).toBeInTheDocument();
    expect(screen.queryByText('সার্ভারের সাথে সংযোগ নেই')).not.toBeInTheDocument();
  });

  it('keeps sign-in available while the health check is still pending', () => {
    render(
      <AuthConnectivityGate
        path="/sign-in"
        phase="probing"
        hasOfflineIdentity={false}
        onRetry={vi.fn()}
      >
        <div>Clerk sign-in interface</div>
      </AuthConnectivityGate>,
    );

    expect(screen.getByText('Clerk sign-in interface')).toBeInTheDocument();
  });

  it('shows the offline screen on a protected route and retries when requested', () => {
    const onRetry = vi.fn();
    render(
      <AuthConnectivityGate
        path="/dashboard"
        phase="offline"
        hasOfflineIdentity={false}
        onRetry={onRetry}
      >
        <div>Protected ledger</div>
      </AuthConnectivityGate>,
    );

    expect(screen.getByText('সার্ভারের সাথে সংযোগ নেই')).toBeInTheDocument();
    expect(screen.queryByText('Protected ledger')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'আবার চেষ্টা করুন' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
