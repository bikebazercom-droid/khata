import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
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

function makeLedgerEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    partyId: PARTY_ID,
    type: LedgerEntryType.YOU_GAVE,
    amount: 100,
    description: 'পুরনো বিবরণ',
    billReference: null,
    billImage: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    dueDate: null,
    isTransfer: false,
    transferPartyId: null,
    linkedEntryId: null,
    ...overrides,
  } as NonNullable<React.ComponentProps<typeof TransactionEntryScreen>['initialEntry']>;
}

function renderEditEntry(initialEntry = makeLedgerEntry()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const onClose = vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TransactionEntryScreen
        partyId={PARTY_ID}
        partyName="রহিম"
        partyRole={PartyRole.CUSTOMER}
        type={initialEntry.type}
        initialEntry={initialEntry}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { ...view, queryClient, onClose };
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
    mocks.playTransactionSuccessSound.mockReset();
    vi.restoreAllMocks();
    mocks.createLedgerEntry.mockResolvedValue({ id: 'entry-1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setBrowserOnline(true);
    vi.unstubAllGlobals();
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

  it('submits a twenty-billion amount online instead of misclassifying it as an offline draft', async () => {
    const { onClose } = renderEntry();
    fireEvent.change(screen.getByRole('textbox', { name: 'পরিমাণ লিখুন' }), {
      target: { value: '20000000000' },
    });

    saveEntry();

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mocks.createLedgerEntry).toHaveBeenCalledWith(
      PARTY_ID,
      expect.objectContaining({ amount: 20_000_000_000 }),
      expect.anything(),
    );
    expect(mocks.queueEntry).not.toHaveBeenCalled();
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

  it('appends a keypad digit to the end of a prefilled amount when editing', () => {
    renderEditEntry(makeLedgerEntry({ amount: 88 }));
    const amount = screen.getByRole('textbox', { name: 'পরিমাণ লিখুন' }) as HTMLInputElement;

    expect(amount.value).toBe('৮৮');
    pressCalculatorKey('5');

    expect(amount.value).toBe('৮৮৫');
    expect(amount.selectionStart).toBe(3);
  });

  it('matches the reference keypad shape, elevation, colors, and column alignment', () => {
    renderEntry();

    const shadowClass = 'shadow-[0_2px_4px_rgba(0,0,0,0.15)]';
    const mutedKeys = ['C', 'M+', 'M-', 'DEL', '/', '%', '*'];
    for (const value of mutedKeys) {
      expect(screen.getByTestId(`calculator-key-${value}`)).toHaveClass(
        'calculator-key',
        'h-11',
        'text-base',
        'rounded-[5px]',
        shadowClass,
        'bg-[#cbdced]',
      );
    }

    for (const digit of [...'0123456789', '=']) {
      expect(screen.getByTestId(`calculator-key-${digit}`)).toHaveClass(
        'calculator-key',
        'h-11',
        'text-base',
        'rounded-[5px]',
        shadowClass,
        'bg-white',
      );
    }

    for (const value of ['-', '+']) {
      expect(screen.getByTestId(`calculator-key-${value}`)).toHaveClass(
        'calculator-key',
        'h-11',
        'text-base',
        'rounded-[5px]',
        shadowClass,
        'bg-[#0d55ad]',
      );
    }

    const expectedGridRows = [
      screen.getByTestId('calculator-key-C').parentElement,
      screen.getByTestId('calculator-key-7').parentElement,
      screen.getByTestId('calculator-key-4').parentElement,
      screen.getByTestId('calculator-key-1').parentElement,
      screen.getByTestId('calculator-key-0').parentElement,
    ];
    for (const row of expectedGridRows) {
      expect(row).toHaveClass('grid', 'gap-1.5');
      expect(row).toHaveStyle({ gridTemplateColumns: 'repeat(4, 1fr)' });
      expect(row?.children).toHaveLength(4);
    }
    expect(expectedGridRows[1]?.parentElement).toHaveClass('space-y-1.5');
    expect(expectedGridRows[0]?.parentElement).toHaveClass(
      'max-h-[min(52dvh,22rem)]',
      'overflow-y-auto',
      'pt-2',
      'pr-2',
      'pl-2',
    );

    const splitOperatorCell = screen.getByTestId('calculator-key-/').parentElement;
    expect(splitOperatorCell).toHaveClass('flex', 'min-w-0', 'gap-1.5');
    expect(splitOperatorCell?.children).toHaveLength(2);
    expect(splitOperatorCell?.children[0]).toBe(screen.getByTestId('calculator-key-/'));
    expect(splitOperatorCell?.children[1]).toBe(screen.getByTestId('calculator-key-%'));
    expect(expectedGridRows[1]?.children[3]).toBe(splitOperatorCell);

    for (const value of ['DEL', '*', '-', '+']) {
      const button = screen.getByTestId(`calculator-key-${value}`);
      expect(button.parentElement?.children[3]).toBe(button);
    }

    pressCalculatorKey('5');
    pressCalculatorKey('M+');
    expect(screen.getByRole('button', { name: /MRC =/ })).toHaveClass('calculator-key');
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

  it('shows the full adjustment control and retargets an existing adjustment', async () => {
    mocks.useListAdjustmentTargets.mockReturnValue({
      data: [
        { id: 'target-party', name: 'করিম', role: PartyRole.CUSTOMER },
        { id: 'other-target', name: 'সালমা', role: PartyRole.CUSTOMER },
      ],
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeLedgerEntry({
        amount: 250,
        isTransfer: true,
        transferPartyId: 'other-target',
        linkedEntryId: 'counter-entry',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onClose } = renderEditEntry(
      makeLedgerEntry({
        isTransfer: true,
        transferPartyId: 'target-party',
        linkedEntryId: 'counter-entry',
      }),
    );

    expect(screen.getByTestId('button-toggle-adjustment')).toBeInTheDocument();
    expect(screen.getByTestId('input-adjustment-party-search')).toBeInTheDocument();
    expect(screen.getByTestId('button-adjustment-party-target-party')).toBeInTheDocument();
    expect(screen.getByTestId('button-adjustment-party-other-target')).toBeInTheDocument();
    expect(screen.getByTestId('calculator-key-M+')).toBeInTheDocument();
    expect(screen.getByTestId('calculator-key-M-')).toBeInTheDocument();
    expect(screen.getByTestId('calculator-live-display')).toHaveTextContent('১০০ = ১০০');

    fireEvent.change(screen.getByTestId('input-transaction-amount'), {
      target: { value: '200+50' },
    });
    expect(screen.getByTestId('calculator-live-display')).toHaveTextContent('২০০+৫০ = ২৫০');
    fireEvent.click(screen.getByTestId('button-adjustment-party-other-target'));

    fireEvent.click(screen.getByRole('button', { name: 'সংরক্ষণ করুন' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      amount: 250,
      type: LedgerEntryType.YOU_GAVE,
      isTransfer: true,
      transferPartyId: 'other-target',
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('lets a regular transaction become an adjustment while editing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeLedgerEntry({
        isTransfer: true,
        transferPartyId: 'target-party',
        linkedEntryId: 'counter-entry',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderEditEntry();

    expect(screen.getByTestId('button-toggle-adjustment')).toBeInTheDocument();
    expect(screen.queryByTestId('input-adjustment-party-search')).not.toBeInTheDocument();
    expect(screen.getByTestId('calculator-key-M+')).toBeInTheDocument();
    expect(screen.getByTestId('calculator-live-display')).toHaveTextContent('১০০ = ১০০');
    fireEvent.click(screen.getByTestId('button-toggle-adjustment'));
    fireEvent.click(screen.getByTestId('button-adjustment-party-target-party'));
    fireEvent.click(screen.getByRole('button', { name: 'সংরক্ষণ করুন' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      isTransfer: true,
      transferPartyId: 'target-party',
    });
  });

  it('confirms before unlinking an existing adjustment and sends the paired removal state', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeLedgerEntry({
        isTransfer: false,
        transferPartyId: null,
        linkedEntryId: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderEditEntry(makeLedgerEntry({
      isTransfer: true,
      transferPartyId: 'target-party',
      linkedEntryId: 'counter-entry',
    }));

    fireEvent.click(screen.getByTestId('button-toggle-adjustment'));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'অন্য পক্ষের খাতা থেকে মিলানো এন্ট্রিটি মুছে যাবে',
    );
    fireEvent.click(screen.getByRole('button', { name: 'না, লিংক রাখুন' }));
    expect(screen.getByTestId('input-adjustment-party-search')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('button-toggle-adjustment'));
    fireEvent.click(screen.getByRole('button', { name: 'হ্যাঁ, লিংক সরান' }));
    expect(screen.queryByTestId('input-adjustment-party-search')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'সংরক্ষণ করুন' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      isTransfer: false,
      transferPartyId: null,
    });
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

  it('shows an amount-limit toast for a server rejection and does not queue it offline', async () => {
    const errorToast = vi.spyOn(toast, 'error').mockImplementation(() => '' as never);
    mocks.createLedgerEntry.mockRejectedValueOnce(Object.assign(
      new Error('HTTP 400'),
      { status: 400, data: { error: 'Amount exceeds the supported limit' } },
    ));
    const { onClose } = renderEntry();
    enterAmount();

    saveEntry();

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith(
      'লেনদেনের পরিমাণ সীমা ছাড়িয়েছে',
      expect.objectContaining({ description: expect.stringContaining('পরিমাণ কমিয়ে') }),
    ));
    expect(mocks.queueEntry).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'এন্ট্রি নিশ্চিত করুন' })).toBeInTheDocument();
  });

  it('does not treat an HTTP 500 response as a connectivity failure', async () => {
    mocks.createLedgerEntry.mockImplementationOnce(async () => {
      setBrowserOnline(false);
      throw Object.assign(new Error('HTTP 500'), { status: 500 });
    });
    renderEntry();
    enterAmount();

    saveEntry();

    await waitFor(() => expect(mocks.createLedgerEntry).toHaveBeenCalledOnce());
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