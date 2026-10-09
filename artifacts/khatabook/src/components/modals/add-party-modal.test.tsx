import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PartyRole } from '@workspace/api-client-react';

const mocks = vi.hoisted(() => ({
  canSelectDeviceContacts: vi.fn(),
  hasNativeDeviceContacts: vi.fn(),
  selectDeviceContacts: vi.fn(),
  useCreateParty: vi.fn(),
  createParty: vi.fn(),
}));

vi.mock('@/lib/device-contacts', () => ({
  canSelectDeviceContacts: mocks.canSelectDeviceContacts,
  hasNativeDeviceContacts: mocks.hasNativeDeviceContacts,
  selectDeviceContacts: mocks.selectDeviceContacts,
}));

vi.mock('@/lib/businessContext', () => ({
  useBusinessContext: () => ({ selectedBusinessId: 'business-1' }),
}));

vi.mock('@workspace/api-client-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  return { ...actual, useCreateParty: mocks.useCreateParty };
});

import { AddPartyModal } from './add-party-modal';

const contacts = [
  { id: 'abdul', name: 'Abdul Karim', phone: '+8801712345678' },
  { id: 'babul', name: 'Babul Traders', phone: '01777777777' },
  { id: 'phone-only', name: '+8801324740609', phone: '+8801324740609' },
  { id: 'bangla', name: 'রহিম স্টোর', phone: '01812345678' },
];

const scrolledElements: Element[] = [];

function renderPicker(defaultRole: PartyRole = PartyRole.CUSTOMER) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const onOpenChange = vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AddPartyModal open onOpenChange={onOpenChange} defaultRole={defaultRole} />
    </QueryClientProvider>,
  );
  return { ...view, onOpenChange, queryClient };
}

async function importContacts() {
  fireEvent.click(screen.getByTestId('button-import-device-contacts'));
  await waitFor(() => {
    expect(screen.getByTestId('button-select-contact-abdul')).toBeInTheDocument();
  });
}

describe('AddPartyModal contact picker', () => {
  beforeEach(() => {
    mocks.canSelectDeviceContacts.mockReset().mockReturnValue(true);
    mocks.hasNativeDeviceContacts.mockReset().mockReturnValue(false);
    mocks.selectDeviceContacts.mockReset().mockResolvedValue(contacts);
    mocks.createParty.mockReset();
    mocks.useCreateParty.mockReset().mockReturnValue({
      mutate: mocks.createParty,
      isPending: false,
    });
    scrolledElements.length = 0;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: function (this: HTMLElement) {
        scrolledElements.push(this);
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });

  it('keeps browser contact import behind a tap, then searches and selects a named contact', async () => {
    renderPicker(PartyRole.SUPPLIER);

    expect(mocks.hasNativeDeviceContacts).toHaveBeenCalled();
    expect(mocks.canSelectDeviceContacts).not.toHaveBeenCalled();
    expect(mocks.selectDeviceContacts).not.toHaveBeenCalled();

    await importContacts();
    expect(mocks.canSelectDeviceContacts).toHaveBeenCalledOnce();
    expect(mocks.selectDeviceContacts).toHaveBeenCalledOnce();

    fireEvent.change(screen.getByTestId('input-party-search'), {
      target: { value: 'Karim' },
    });
    expect(screen.getByTestId('button-select-contact-abdul')).toBeInTheDocument();
    expect(screen.queryByTestId('button-select-contact-babul')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('button-select-contact-abdul'));

    expect(screen.getByTestId('input-party-name')).toHaveValue('Abdul Karim');
    expect(screen.getByTestId('input-party-phone')).toHaveValue('01712345678');
    expect(screen.getByTestId('button-submit-party')).toHaveTextContent('সাপ্লায়ার যোগ করুন');

    fireEvent.click(screen.getByTestId('button-submit-party'));
    await waitFor(() => expect(mocks.createParty).toHaveBeenCalledOnce());
    expect(mocks.createParty).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Abdul Karim',
        phone: '+8801712345678',
        role: PartyRole.SUPPLIER,
      }),
    });
  });

  it('automatically requests native contacts when the picker opens and keeps them when returning from the form', async () => {
    mocks.hasNativeDeviceContacts.mockReturnValue(true);
    renderPicker();

    await waitFor(() => expect(mocks.selectDeviceContacts).toHaveBeenCalledOnce());
    expect(await screen.findByTestId('button-select-contact-abdul')).toBeInTheDocument();
    expect(screen.queryByTestId('button-import-device-contacts')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('button-select-contact-abdul'));
    fireEvent.click(screen.getByTestId('button-back-party-form'));

    expect(screen.getByTestId('button-select-contact-abdul')).toBeInTheDocument();
    expect(mocks.selectDeviceContacts).toHaveBeenCalledOnce();
  });

  it('shows and selects a phone-only contact with its number as the form name', async () => {
    renderPicker();
    await importContacts();

    fireEvent.change(screen.getByTestId('input-party-search'), {
      target: { value: '1324740609' },
    });
    const phoneOnlyContact = screen.getByTestId('button-select-contact-phone-only');
    expect(phoneOnlyContact).toHaveTextContent('+8801324740609');

    fireEvent.click(phoneOnlyContact);

    expect(screen.getByTestId('input-party-name')).toHaveValue('+8801324740609');
    expect(screen.getByTestId('input-party-phone')).toHaveValue('01324740609');
  });

  it('jumps to a contact group without changing supplier scope', async () => {
    renderPicker(PartyRole.SUPPLIER);
    await importContacts();

    fireEvent.click(screen.getByTestId('button-party-index-B'));

    const babulGroup = document.getElementById('party-letter-B');
    expect(babulGroup).not.toBeNull();
    expect(scrolledElements).toContain(babulGroup);

    fireEvent.click(screen.getByTestId('button-party-index-র'));
    const banglaGroup = document.getElementById('party-letter-র');
    expect(banglaGroup).not.toBeNull();
    expect(scrolledElements).toContain(banglaGroup);

    fireEvent.click(screen.getByTestId('button-party-index-#'));
    const phoneOnlyGroup = document.getElementById('party-letter-#');
    expect(phoneOnlyGroup).not.toBeNull();
    expect(scrolledElements).toContain(phoneOnlyGroup);
    expect(screen.getByRole('heading', { name: 'সাপ্লায়ার নির্বাচন করুন' })).toBeInTheDocument();
  });

  it('keeps manual add available when device contacts cannot be selected', async () => {
    mocks.canSelectDeviceContacts.mockReturnValue(false);
    renderPicker();

    fireEvent.click(screen.getByTestId('button-import-device-contacts'));

    expect(mocks.selectDeviceContacts).not.toHaveBeenCalled();
    expect(await screen.findByTestId('status-contact-import')).toHaveTextContent('ম্যানুয়ালি যোগ করুন');

    fireEvent.click(screen.getByTestId('button-party-add'));
    expect(screen.getByTestId('input-party-name')).toBeInTheDocument();
    expect(screen.getByTestId('input-party-phone')).toBeInTheDocument();
  });
});
