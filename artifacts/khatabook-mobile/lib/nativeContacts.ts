// SDK 57 keeps getContactsAsync in the explicit legacy entrypoint. Importing
// that method from the package root now throws at runtime by design.
import * as Contacts from 'expo-contacts/legacy';

export const NATIVE_CONTACTS_REQUEST_TYPE = 'banglakhata:select-device-contacts';
export const NATIVE_CONTACTS_RESULT_EVENT = 'banglakhata-native-contacts-result';

export type NativeContactsRequest = {
  type: typeof NATIVE_CONTACTS_REQUEST_TYPE;
  requestId: string;
};

export type NativeContact = {
  id: string;
  name: string;
  phone: string;
};

export type NativeContactsResponse = {
  requestId: string;
  ok: boolean;
  complete: boolean;
  contacts?: NativeContact[];
  error?: string;
};

export function parseNativeContactsRequest(rawMessage: string): NativeContactsRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  if (
    value.type !== NATIVE_CONTACTS_REQUEST_TYPE
    || typeof value.requestId !== 'string'
    || value.requestId.length < 1
    || value.requestId.length > 128
  ) {
    return null;
  }

  return { type: NATIVE_CONTACTS_REQUEST_TYPE, requestId: value.requestId };
}

export async function getNativeContactsForWebView(): Promise<
  | { ok: true; contacts: NativeContact[] }
  | { ok: false; error: string }
> {
  let permission = await Contacts.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Contacts.requestPermissionsAsync();
  }
  if (!permission.granted) {
    return {
      ok: false,
      error: 'কন্টাক্ট ব্যবহারের অনুমতি নেই। অনুমতি দিন অথবা নাম দিয়ে ম্যানুয়ালি যোগ করুন।',
    };
  }

  const contacts: NativeContact[] = [];
  let pageOffset = 0;
  let hasNextPage = true;

  while (hasNextPage) {
    const page = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
      pageSize: 250,
      pageOffset,
    });

    for (const [index, contact] of page.data.entries()) {
      const phone = contact.phoneNumbers?.find((item) => item.number?.trim())?.number?.trim() ?? '';
      const name = contact.name?.trim() || phone;
      if (!name) continue;

      contacts.push({
        id: contact.id || `${pageOffset + index}-${phone || name}`,
        name,
        phone,
      });
    }

    if (page.data.length === 0) break;
    pageOffset += page.data.length;
    hasNextPage = page.hasNextPage;
  }

  return { ok: true, contacts };
}
