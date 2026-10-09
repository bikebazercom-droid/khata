import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  businesses: [] as { id: string; name: string }[],
  getSettings: vi.fn(),
  setBusinesses: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock('@/lib/businessContext', () => ({
  useBusinessContext: () => ({
    selectedBusinessId: 'business-1',
    businesses: mocks.businesses,
    setBusinesses: mocks.setBusinesses,
  }),
}));

vi.mock('@workspace/api-client-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  return {
    ...actual,
    useGetBusinessSettings: mocks.getSettings,
    useUpdateBusinessSettings: (options: {
      mutation?: {
        onMutate?: (variables: { data: { storeName: string } }) => unknown;
        onSuccess?: (result: unknown, variables: unknown, context: unknown) => unknown;
        onError?: (error: unknown, variables: unknown, context: any) => unknown;
        onSettled?: () => unknown;
      };
    }) => ({
      mutate: vi.fn(),
      mutateAsync: async (variables: { data: { storeName: string } }) => {
        const context = await options.mutation?.onMutate?.(variables);
        try {
          const result = await mocks.saveSettings(variables);
          await options.mutation?.onSuccess?.(result, variables, context);
          return result;
        } catch (error) {
          await options.mutation?.onError?.(error, variables, context);
          throw error;
        } finally {
          await options.mutation?.onSettled?.();
        }
      },
    }),
  };
});

import { RenameStoreDialog } from './rename-store-dialog';

function renderOnboarding() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(['auth-me'], {
    role: 'owner',
    businessId: 'business-1',
    businessName: '',
    needsBookName: true,
  });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <RenameStoreDialog
        open
        onOpenChange={onOpenChange}
        isOnboarding
        businessId="business-1"
      />
    </QueryClientProvider>,
  );
  return { queryClient, onOpenChange };
}

describe('RenameStoreDialog first-book setup', () => {
  beforeEach(() => {
    mocks.businesses = [{ id: 'business-1', name: '' }];
    mocks.getSettings.mockReset().mockReturnValue({ data: { storeName: '' } });
    mocks.setBusinesses.mockReset();
    mocks.saveSettings.mockReset();
  });

  it('saves the entered name to the current primary book and clears onboarding state', async () => {
    mocks.saveSettings.mockResolvedValue({ storeName: 'Shakil Traders' });
    const { queryClient, onOpenChange } = renderOnboarding();

    fireEvent.change(screen.getByPlaceholderText('যেমন: শাকিল ট্রেডার্স'), {
      target: { value: '  Shakil Traders  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'খাতা তৈরি করুন' }));

    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledOnce());
    expect(mocks.saveSettings).toHaveBeenCalledWith({
      data: { storeName: 'Shakil Traders' },
    });
    expect(mocks.setBusinesses).toHaveBeenCalledWith([
      { id: 'business-1', name: 'Shakil Traders' },
    ]);
    expect(queryClient.getQueryData(['auth-me'])).toMatchObject({
      businessId: 'business-1',
      businessName: 'Shakil Traders',
      needsBookName: false,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps required setup open and restores the empty book name when saving fails', async () => {
    mocks.saveSettings.mockRejectedValue(new Error('offline'));
    const { queryClient, onOpenChange } = renderOnboarding();

    fireEvent.change(screen.getByPlaceholderText('যেমন: শাকিল ট্রেডার্স'), {
      target: { value: 'Shakil Traders' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'খাতা তৈরি করুন' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'খাতার নাম সংরক্ষণ করা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।',
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mocks.setBusinesses).toHaveBeenNthCalledWith(1, [
      { id: 'business-1', name: 'Shakil Traders' },
    ]);
    expect(mocks.setBusinesses).toHaveBeenNthCalledWith(2, [
      { id: 'business-1', name: '' },
    ]);
    expect(queryClient.getQueryData(['auth-me'])).toMatchObject({
      businessName: '',
      needsBookName: true,
    });
  });
});
