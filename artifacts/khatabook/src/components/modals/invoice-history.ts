export type InvoiceHistoryType = 'Business' | 'Gold';
export type InvoiceHistoryAction = 'open' | 'download' | 'share';

export type InvoiceHistoryRecord = {
  id: string;
  type: InvoiceHistoryType;
  number: string;
  date: string;
  customerName: string;
  customerPhone: string;
  total: number;
  currency: string;
  itemCount: number;
  payload: unknown;
  savedAt: string;
};

const HISTORY_KEY = 'banglakhata_invoice_history_v1';
export const INVOICE_HISTORY_EVENT = 'banglakhata:invoice-history';

function storageKey() {
  const businessId = typeof window === 'undefined' ? 'default' : window.localStorage.getItem('selected_business_id') || 'default';
  return `${HISTORY_KEY}:${businessId}`;
}

export function readInvoiceHistory(): InvoiceHistoryRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey()) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((record): record is InvoiceHistoryRecord =>
      !!record && typeof record === 'object' &&
      typeof record.id === 'string' && typeof record.number === 'string' &&
      (record.type === 'Business' || record.type === 'Gold') &&
      typeof record.total === 'number' && typeof record.payload === 'object',
    );
  } catch {
    return [];
  }
}

export function saveInvoiceHistory(record: Omit<InvoiceHistoryRecord, 'id' | 'savedAt'>) {
  if (typeof window === 'undefined') return;
  const complete: InvoiceHistoryRecord = {
    ...record,
    id: `${record.type}:${record.number}`,
    savedAt: new Date().toISOString(),
  };
  const current = readInvoiceHistory();
  const next = [complete, ...current.filter((item) => item.id !== complete.id)].slice(0, 500);
  window.localStorage.setItem(storageKey(), JSON.stringify(next));
  window.dispatchEvent(new Event(INVOICE_HISTORY_EVENT));
}

export function deleteInvoiceHistory(id: string) {
  if (typeof window === 'undefined') return;
  const next = readInvoiceHistory().filter((record) => record.id !== id);
  window.localStorage.setItem(storageKey(), JSON.stringify(next));
  window.dispatchEvent(new Event(INVOICE_HISTORY_EVENT));
}
