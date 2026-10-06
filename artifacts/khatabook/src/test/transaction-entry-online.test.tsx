import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  LedgerEntryType,
  PartyRole,
  getGetDashboardSummaryQueryKey,
  getGetPartyQueryKey,
  getListLedgerEntriesQueryKey,
  getListPartiesQueryKey,
} from '@workspace/api-client-react';

const mocks = vi.hoisted(() => ({
  createLedgerEntry: vi.fn(),
  useListAdjustmentTargets: vi.fn(),
  uploadBillImage: vi.fn(),
  scanDocument: vi.fn(),
  queueEntry: vi.fn(),
  playCalculatorTapSound: vi.fn(),
  playTransactionSuccessSound: vi.fn(),
}));

vi.mock('@workspace/api-client-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  return {
    ...actual,
    createLedgerEntry: mocks.createLedgerEntry,
    useListAdjustmentTargets: mocks.useListAdjustmentTargets,
  };
});

vi.mock('@/App', () => ({
  useAppAuth: () => ({
    role: 'owner',
    adjustmentPartyIds: [],
    userId: 'user-1',
  }),
}));

vi.mock('@/lib/businessContext', () => ({
  useBusinessContext: () => ({ selectedBusinessId: 'business-1' }),
}));

vi.mock('@/context/connection-state', () => ({
  useConnectionState: () => ({ isOnline: true }),
}));

vi.mock('@/lib/billImageStorage', () => ({
  uploadBillImage: mocks.uploadBillImage,
  billImageSrc: (value: string | null | undefined) => value ?? null,
}));

vi.mock('@/lib/document-scan', () => ({
  scanDocument: mocks.scanDocument,
}));

vi.mock('@/lib/entryOutbox', () => ({
  queueEntry: mocks.queueEntry,
}));

vi.mock('@/lib/calculator-sound', () => ({
  playCalculatorTapSound: mocks.playCalculatorTapSound,
}));

vi.mock('@/lib/transaction-success-sound', () => ({
  playTransactionSuccessSound: mocks.playTransactionSuccessSound,
}));

import { TransactionEntryScreen } from '../components/modals/transaction-entry-screen';

const PARTY_ID = 'source-party';

function setBrowserOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

function renderEntry(partyRole: PartyRole = PartyRole.CUSTOMER) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  const onClose = vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TransactionEntryScreen
        partyId={PARTY_ID}
        partyName="রহিম"
        partyRole={partyRole}
        type={LedgerEntryType.YOU_GAVE}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { ...view, queryClient, invalidateQueries, onClose };
}

function enterAmount(amount = '1') {
  for (const digit of amount) fireEvent.click(screen.getByRole('button', { name: digit }));
}

function pressCalculatorKey(value: string) {
  fireEvent.click(screen.getByTestId(`calculator-key-${value}`));
}

function saveEntry() {
  fireEvent.click(screen.getByRole('button', { name: 'এন্ট্রি নিশ্চিত করুন' }));
}

async function attachBillImage() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  const file = new File(['bill'], 'bill.jpg', { type: 'image/jpeg' });
  fireEvent.change(input!, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByAltText('সংযুক্ত বিল')).toBeInTheDocument());
}

describe('browser ledger entry submission', () => {
  beforeEach(() => {
    setBrowserOnline(true);
    mocks.createLedgerEntry.mockReset();
    mocks.useListAdjustmentTargets.mockReset();
    mocks.useListAdjustmentTargets.mockReturnValue({
      data: [{ id: 'target-party', name: 'করিম', role: PartyRole.CUSTOMER }],
    });
    mocks.uploadBillImage.mockReset();
    mocks.uploadBillImage.mockResolvedValue({ ok: true, objectPath: '/objects/uploads/bill-1' });
    mocks.scanDocument.mockReset();
    mocks.scanDocument.mockResolvedValue('data:image/jpeg;base64,captured-bill');
    mocks.queueEntry.mockReset();
    mocks.playCalculatorTapSound.mockReset();
    mocks.playTransactionSuccessSound.mockReset();
    mocks.createLedgerEntry.mockResolvedValue({ id: 'entry-1' });
  });

  afterEach(() => {
    setBrowserOnline(true);
  });

  it('queues a new entry locally while offline and closes the form', async () => {
    setBrowserOnline(false);
    const { onClose } = renderEntry();

    enterAmount();
    saveEntry();

    await waitFor(() => expect(mocks.queueEntry).toHaveBeenCalledOnce());
    expect(mocks.createLedgerEntry).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    expect(mocks.queueEntry.mock.calls[0][0]).toMatchObject({
      actorId: 'user-1',
      businessId: 'business-1',
      partyId: PARTY_ID,
      status: 'pending',
    });
  });

  it('supports manual typing, cursor insertion, selection replacement, and one-character keypad backspace', () => {
    renderEntry();
    const amount = screen.getByRole('textbox', { name: 'পরিমাণ লিখুন' }) as HTMLInputElement;
    expect(amount).toHaveClass('text-left');
    expect(amount).not.toHaveClass('text-right');

    fireEvent.change(amount, { target: { value: '১২৩৪' } });
    expect(amount.value).toBe('১২৩৪');

    amount.setSelectionRange(2, 2);
    fireEvent.select(amount);
    pressCalculatorKey('9');
    expect(amount.value).toBe('১২৯৩৪');
    expect(amount.selectionStart).toBe(3);

    pressCalculatorKey('DEL');
    expect(amount.value).toBe('১২৩৪');

    amount.setSelectionRange(1, 3);
    fireEvent.select(amount);
    pressCalculatorKey('7');
    expect(amount.value).toBe('১৭৪');

    pressCalculatorKey('DEL');
    expect(amount.value).toBe('১৪');
  });

  it('lets every digit, decimal, and arithmetic operator update the editable expression', () => {
    renderEntry();
    const amount = screen.getByRole('textbox', { name: 'পরিমাণ লিখুন' }) as HTMLInputElement;

    for (const digit of '0123456789') pressCalculatorKey(digit);
    expect(amount.value).toBe('০১২৩৪৫৬৭৮৯');
    pressCalculatorKey('C');
    expect(amount.value).toBe('');

    for (const key of ['1', '0', '+', '5', '.', '5', '-', '2', '*', '3', '/', '2']) {
      pressCalculatorKey(key);
    }
    expect(amount.value).toBe('১০+৫.৫−২×৩÷২');

    pressCalculatorKey('=');
    expect(amount.value).toBe('২০.২৫');
  });

  it('plays a tap sound for keypad presses and the MRC control', () => {
    renderEntry();

    pressCalculatorKey('1');
    pressCalculatorKey('M+');
    fireEvent.click(screen.getByRole('button', { name: /MRC =/ }));

    expect(mocks.playCalculatorTapSound).toHaveBeenCalledTimes(3);
  });

  it('POSTs the transfer and uploaded bill object path directly, then closes and invalidates ledger views', async () => {
    const { onClose, invalidateQueries } = renderEntry();
    enterAmount();
    await attachBillImage();
    fireEvent.click(screen.getByTestId('button-toggle-adjustment'));
    fireEvent.click(screen.getByTestId('button-adjustment-party-target-party'));

    saveEntry();

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mocks.playTransactionSuccessSound).toHaveBeenCalledOnce();
    expect(mocks.uploadBillImage).toHaveBeenCalledWith('data:image/jpeg;base64,captured-bill');
    expect(mocks.createLedgerEntry).toHaveBeenCalledOnce();
    expect(mocks.createLedgerEntry).toHaveBeenCalledWith(
      PARTY_ID,
      expect.objectContaining({
        type: LedgerEntryType.YOU_GAVE,
        amount: 1,
        isTransfer: true,
        transferPartyId: 'target-party',
        billImage: '/objects/uploads/bill-1',
        clientRequestId: expect.any(String),
      }),
      { headers: { 'x-business-id': 'business-1' } },
    );
    expect(mocks.createLedgerEntry.mock.calls[0][1]).not.toHaveProperty('imageBase64');
    expect(mocks.queueEntry).not.toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: getListLedgerEntriesQueryKey(PARTY_ID),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: getGetPartyQueryKey(PARTY_ID) });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: getListPartiesQueryKey() });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: getGetDashboardSummaryQueryKey(),
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(4);
  });

  it('keeps supplier context in the target query and excludes customer destinations', async () => {
    mocks.useListAdjustmentTargets.mockReturnValue({
      data: [
        { id: 'customer-target', name: 'গ্রাহক', role: PartyRole.CUSTOMER },
        { id: 'supplier-target', name: 'সরবরাহকারী', role: PartyRole.SUPPLIER },
      ],
    });
    const { onClose } = renderEntry(PartyRole.SUPPLIER);
    expect(mocks.useListAdjustmentTargets).toHaveBeenCalledWith(
      { partyRole: PartyRole.SUPPLIER },
      expect.anything(),
    );

    enterAmount();
    fireEvent.click(screen.getByTestId('button-toggle-adjustment'));
    expect(screen.getByPlaceholderText('সরবরাহকারীর নাম লিখুন…')).toBeInTheDocument();
    expect(screen.queryByTestId('button-adjustment-party-customer-target')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-adjustment-party-supplier-target'));
    saveEntry();

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mocks.createLedgerEntry).toHaveBeenCalledWith(
      PARTY_ID,
      expect.objectContaining({ isTransfer: true, transferPartyId: 'supplier-target' }),
      expect.anything(),
    );
  });

  it('keeps the form open on a server validation failure and reuses the same request ID for retry', async () => {
    mocks.createLedgerEntry
      .mockRejectedValueOnce(Object.assign(new Error('invalid entry'), { status: 400 }))
      .mockResolvedValueOnce({ id: 'entry-1' });
    const { onClose } = renderEntry();
    enterAmount();

    saveEntry();
    await waitFor(() => expect(mocks.createLedgerEntry).toHaveBeenCalledOnce());
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.playTransactionSuccessSound).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'এন্ট্রি নিশ্চিত করুন' })).toBeInTheDocument();

    saveEntry();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mocks.playTransactionSuccessSound).toHaveBeenCalledOnce();

    const firstRequest = mocks.createLedgerEntry.mock.calls[0][1];
    const retryRequest = mocks.createLedgerEntry.mock.calls[1][1];
    expect(retryRequest.clientRequestId).toBe(firstRequest.clientRequestId);
    expect(mocks.queueEntry).not.toHaveBeenCalled();
  });

  it('saves the entry and bill photo locally when the image upload fails', async () => {
    mocks.uploadBillImage.mockResolvedValue({ ok: false, reason: 'upload-failed' });
    const { onClose } = renderEntry();
    enterAmount();
    await attachBillImage();

    saveEntry();

    await waitFor(() => expect(mocks.uploadBillImage).toHaveBeenCalledOnce());
    expect(mocks.createLedgerEntry).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.queueEntry).toHaveBeenCalledOnce());
    expect(mocks.queueEntry.mock.calls[0][0]).toMatchObject({
      partyId: PARTY_ID,
      imageBase64: 'data:image/jpeg;base64,captured-bill',
      status: 'pending',
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});