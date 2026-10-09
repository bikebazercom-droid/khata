export type DeviceContact = {
  id: string;
  name: string;
  phone: string;
};

const NATIVE_CONTACTS_REQUEST = 'banglakhata:select-device-contacts';
const NATIVE_CONTACTS_RESULT_EVENT = 'banglakhata-native-contacts-result';
const REQUEST_TIMEOUT_MS = 60_000;

type ReactNativeWebViewBridge = {
  postMessage: (message: string) => void;
};

type NativeContactsResponse = {
  requestId: string;
  ok: boolean;
  complete: boolean;
  contacts?: DeviceContact[];
  error?: string;
};

type BrowserContact = { name?: string[]; tel?: string[] };
type BrowserContactsManager = {
  select: (properties: string[], options: { multiple: boolean }) => Promise<BrowserContact[]>;
};

function getNativeBridge(): ReactNativeWebViewBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { ReactNativeWebView?: ReactNativeWebViewBridge }).ReactNativeWebView ?? null;
}

function getBrowserContactsManager(): BrowserContactsManager | null {
  if (typeof navigator === 'undefined') return null;
  const manager = (navigator as Navigator & { contacts?: BrowserContactsManager }).contacts;
  return manager ?? null;
}

function mapBrowserContacts(contacts: BrowserContact[]): DeviceContact[] {
  return contacts
    .map((contact, index) => {
      const name = contact.name?.find((value) => value.trim())?.trim() ?? '';
      const phone = contact.tel?.find((value) => value.trim())?.trim() ?? '';
      return {
        id: `${index}-${phone || name || 'contact'}`,
        name: name || phone,
        phone,
      };
    })
    .filter((contact) => contact.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'bn', { sensitivity: 'base' }));
}

function requestNativeContacts(bridge: ReactNativeWebViewBridge): Promise<DeviceContact[]> {
  return new Promise((resolve, reject) => {
    const requestId = `party-contacts-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const received: DeviceContact[] = [];

    const cleanup = () => {
      window.removeEventListener(NATIVE_CONTACTS_RESULT_EVENT, handleResult);
      window.clearTimeout(timeout);
    };

    const handleResult = (event: Event) => {
      const response = (event as CustomEvent<NativeContactsResponse>).detail;
      if (!response || response.requestId !== requestId) return;

      if (!response.ok) {
        cleanup();
        reject(new Error(response.error || 'ফোনের কন্টাক্ট পড়া যায়নি।'));
        return;
      }

      if (Array.isArray(response.contacts)) received.push(...response.contacts);
      if (response.complete) {
        cleanup();
        resolve(received);
      }
    };

    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('ফোনের কন্টাক্ট থেকে কোনো সাড়া পাওয়া যায়নি। আবার চেষ্টা করুন।'));
    }, REQUEST_TIMEOUT_MS);

    window.addEventListener(NATIVE_CONTACTS_RESULT_EVENT, handleResult);
    try {
      bridge.postMessage(JSON.stringify({ type: NATIVE_CONTACTS_REQUEST, requestId }));
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/**
 * Reads contacts through the native bridge in Expo WebView, or through the
 * browser Contact Picker API when explicitly requested by the user.
 */
export async function selectDeviceContacts(): Promise<DeviceContact[]> {
  const bridge = getNativeBridge();
  if (bridge) return requestNativeContacts(bridge);

  const manager = getBrowserContactsManager();
  if (!manager) {
    throw new Error('এই ব্রাউজারে ফোনের কন্টাক্ট খোলা যায় না। নাম দিয়ে ম্যানুয়ালি যোগ করুন।');
  }

  const selected = await manager.select(['name', 'tel'], { multiple: true });
  return mapBrowserContacts(selected);
}

export function hasNativeDeviceContacts(): boolean {
  return getNativeBridge() !== null;
}

export function canSelectDeviceContacts(): boolean {
  return hasNativeDeviceContacts() || Boolean(getBrowserContactsManager());
}
