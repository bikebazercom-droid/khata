import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMeQueryKey } from '../lib/authQueryKeys';

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

function renderPhoneSignIn() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

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
    phoneAuthMocks.sendOtp.mockResolvedValue(undefined);
  });

  it('seeds the active no-Clerk auth query before routing to the ledger', async () => {
    phoneAuthMocks.verifyOtp.mockResolvedValue(verifiedSession);
    const queryClient = renderPhoneSignIn();

    fireEvent.change(screen.getByTestId('input-phone'), { target: { value: '01712345678' } });
    fireEvent.click(screen.getByTestId('button-send-otp'));
    fireEvent.change(await screen.findByTestId('input-otp-code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('button-verify-otp'));

    await waitFor(() => {
      expect(queryClient.getQueryData(authMeQueryKey())).toEqual(verifiedSession);
    });
    expect(phoneAuthMocks.setLocation).toHaveBeenCalledWith('/');
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