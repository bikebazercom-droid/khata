import { beforeEach, describe, expect, it, vi } from 'vitest';

const contactsApi = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getContactsAsync: vi.fn(),
}));

vi.mock('expo-contacts/legacy', () => ({
  Fields: {
    Name: 'name',
    PhoneNumbers: 'phoneNumbers',
  },
  ...contactsApi,
}));

import { getNativeContactsForWebView } from './nativeContacts';

describe('native contacts bridge reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests permission when needed and reads all pages of contacts', async () => {
    contactsApi.getPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: true,
    });
    contactsApi.requestPermissionsAsync.mockResolvedValue({ granted: true });
    contactsApi.getContactsAsync
      .mockResolvedValueOnce({
        data: [{ id: '1', name: 'Amina', phoneNumbers: [{ number: '+8801711000000' }] }],
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        data: [{ id: '2', name: 'রহিম', phoneNumbers: [{ number: '01800000000' }] }],
        hasNextPage: false,
      });

    await expect(getNativeContactsForWebView()).resolves.toEqual({
      ok: true,
      contacts: [
        { id: '1', name: 'Amina', phone: '+8801711000000' },
        { id: '2', name: 'রহিম', phone: '01800000000' },
      ],
    });
    expect(contactsApi.requestPermissionsAsync).toHaveBeenCalledOnce();
    expect(contactsApi.getContactsAsync).toHaveBeenNthCalledWith(1, {
      fields: ['name', 'phoneNumbers'],
      pageSize: 250,
      pageOffset: 0,
    });
    expect(contactsApi.getContactsAsync).toHaveBeenNthCalledWith(2, {
      fields: ['name', 'phoneNumbers'],
      pageSize: 250,
      pageOffset: 1,
    });
  });

  it('does not re-request permission when device settings already allow contacts', async () => {
    contactsApi.getPermissionsAsync.mockResolvedValue({
      granted: true,
      canAskAgain: false,
    });
    contactsApi.getContactsAsync.mockResolvedValue({
      data: [{ id: '1', name: 'Babu', phoneNumbers: [{ number: '01900000000' }] }],
      hasNextPage: false,
    });

    await expect(getNativeContactsForWebView()).resolves.toMatchObject({
      ok: true,
      contacts: [{ id: '1', name: 'Babu', phone: '01900000000' }],
    });
    expect(contactsApi.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns a clear error when contact permission is denied', async () => {
    contactsApi.getPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: true,
    });
    contactsApi.requestPermissionsAsync.mockResolvedValue({ granted: false });

    await expect(getNativeContactsForWebView()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('অনুমতি'),
    });
    expect(contactsApi.getContactsAsync).not.toHaveBeenCalled();
  });
});
