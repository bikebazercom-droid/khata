import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { useVerifyPhoneOtp } from '@workspace/api-client-react';
import { describe, expect, it } from 'vitest';

describe('generated API client query context', () => {
  it('uses the app QueryClientProvider instance for generated mutation hooks', () => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useVerifyPhoneOtp(), { wrapper });

    expect(result.current.mutate).toEqual(expect.any(Function));
    queryClient.clear();
  });
});