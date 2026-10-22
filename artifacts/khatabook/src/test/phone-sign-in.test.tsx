import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMeQueryKey, authRouteMeQueryKey } from '../lib/authQueryKeys';

const phoneAuthMocks = vi.hoisted(() => ({
  sendOtp: vi.fn(),
  verifyOtp: vi.fn(),
  setLocation: vi.fn(),
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/sign-in', phoneAuthMocks.setLocation],
}));

vi.mock('../lib/phoneAuth', () => ({
  sendOtp: phoneAuthMocks.sendOtp,
  verifyOtp: phoneAuthMocks.verifyOtp,
}));

import { PhoneSignIn } from '../pages/sign-in';

const verifiedSession = {
  userId: 'owner-1',
  businessId: 'business-1',
  authMethod: 'phone' as const,
  role: 'owner' as const,
};

const expiredPhoneSession = {
  userId: 'expired-owner',
  businessId: 'expired-business',
  authMethod: 'phone' as const,
  role: 'owner' as const,
};

function renderPhoneSignIn(queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})) {
  render(
    <QueryClientProvider client={queryClient}>
      <PhoneSignIn />
    </QueryClientProvider>,
  );

  return queryClient;
}

describe('phone OTP sign-in auth cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    phoneAuthMocks.sendOtp.mockResolvedValue(undefined);
  });

  it('keeps the phone form available after a fresh sign-in check rejects a cached phone session', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(authMeQueryKey(), expiredPhoneSession);

    await expect(queryClient.fetchQuery({
      queryKey: authRouteMeQueryKey(null, 41),
      queryFn: async () => {
        throw Object.assign(new Error('Session expired'), { status: 401 });
      },
      retry: false,
    })).rejects.toMatchObject({ status: 401 });

    renderPhoneSignIn(queryClient);

    expect(screen.getByTestId('input-phone')).toBeInTheDocument();
    expect(screen.getByTestId('button-send-otp')).toBeEnabled();
    expect(queryClient.getQueryData(authMeQueryKey())).toEqual(expiredPhoneSession);
    expect(queryClient.getQueryData(authRouteMeQueryKey(null, 41))).toBeUndefined();
  });

  it('seeds the active no-Clerk auth query before routing to the ledger', async () => {
    phoneAuthMocks.verifyOtp.mockResolvedValue(verifiedSession);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(authMeQueryKey(), expiredPhoneSession);
    renderPhoneSignIn(queryClient);

    fireEvent.change(screen.getByTestId('input-phone'), { target: { value: '01712345678' } });
    fireEvent.click(screen.getByTestId('button-send-otp'));
    fireEvent.change(await screen.findByTestId('input-otp-code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('button-verify-otp'));

    await waitFor(() => {
      expect(queryClient.getQueryData(authMeQueryKey())).toEqual(verifiedSession);
    });
    expect(phoneAuthMocks.setLocation).toHaveBeenCalledWith('/dashboard');
  });

  it('converts Bengali OTP digits to ASCII before verification', async () => {
    phoneAuthMocks.verifyOtp.mockResolvedValue(verifiedSession);
    renderPhoneSignIn();

    fireEvent.change(screen.getByTestId('input-phone'), { target: { value: '০১৭১২৩৪৫৬৭৮' } });
    fireEvent.click(screen.getByTestId('button-send-otp'));
    fireEvent.change(await screen.findByTestId('input-otp-code'), { target: { value: '০১২৩৪৫' } });
    fireEvent.click(screen.getByTestId('button-verify-otp'));

    await waitFor(() => {
      expect(phoneAuthMocks.verifyOtp).toHaveBeenCalledWith('০১৭১২৩৪৫৬৭৮', '012345');
    });
  });

  it('does not set an authenticated query or navigate when OTP verification fails', async () => {
    phoneAuthMocks.verifyOtp.mockRejectedValue(new Error('Invalid code'));
    const queryClient = renderPhoneSignIn();

    fireEvent.change(screen.getByTestId('input-phone'), { target: { value: '01712345678' } });
    fireEvent.click(screen.getByTestId('button-send-otp'));
    fireEvent.change(await screen.findByTestId('input-otp-code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByTestId('button-verify-otp'));

    expect(await screen.findByText('Invalid code')).toBeInTheDocument();
    expect(queryClient.getQueryData(authMeQueryKey())).toBeUndefined();
    expect(phoneAuthMocks.setLocation).not.toHaveBeenCalled();
  });
});