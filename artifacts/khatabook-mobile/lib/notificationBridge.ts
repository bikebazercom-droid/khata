export const NATIVE_PUSH_TOKEN_EVENT = 'banglakhata-native-push-token';
export const NATIVE_PUSH_STATUS_EVENT = 'banglakhata-native-push-status';
export const OPEN_NOTIFICATION_EVENT = 'banglakhata-open-notification';

export type StaffLedgerNavigation = {
  notificationId: string;
  businessId: string;
  partyId: string | null;
};

export type ParsedStaffLedgerNotification = {
  requestId: string;
  navigation: StaffLedgerNavigation;
};

export type PendingNotificationNavigationQueue = {
  enqueue: (notification: ParsedStaffLedgerNotification) => void;
  takeWhenReady: (isReady: boolean) => ParsedStaffLedgerNotification | null;
};

const NOTIFICATION_RESPONSE_DEDUPE_TTL_MS = 10 * 60 * 1000;
const MAX_HANDLED_NOTIFICATION_RESPONSES = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function createWebEventScript(eventName: string, detail: unknown): string {
  return `window.dispatchEvent(new CustomEvent(${JSON.stringify(eventName)}, { detail: ${JSON.stringify(detail)} })); true;`;
}

export function createPushTokenEventScript(
  token: string,
  platform: 'android' | 'ios',
): string {
  return createWebEventScript(NATIVE_PUSH_TOKEN_EVENT, { token, platform });
}

export function createStaffLedgerNavigationEventScript(
  navigation: StaffLedgerNavigation,
): string {
  return createWebEventScript(OPEN_NOTIFICATION_EVENT, navigation);
}

export function createPendingNotificationNavigationQueue(): PendingNotificationNavigationQueue {
  let pending: ParsedStaffLedgerNotification | null = null;

  return {
    enqueue(notification) {
      pending = notification;
    },
    takeWhenReady(isReady) {
      if (!isReady || !pending) return null;
      const notification = pending;
      pending = null;
      return notification;
    },
  };
}

export function createNotificationResponseDeduper(
  ttlMs = NOTIFICATION_RESPONSE_DEDUPE_TTL_MS,
  maxEntries = MAX_HANDLED_NOTIFICATION_RESPONSES,
): (requestId: string, nowMs?: number) => boolean {
  const handledUntilByRequestId = new Map<string, number>();

  return (requestId, nowMs = Date.now()) => {
    for (const [handledRequestId, expiresAt] of handledUntilByRequestId) {
      if (expiresAt <= nowMs) handledUntilByRequestId.delete(handledRequestId);
    }

    if (!requestId || handledUntilByRequestId.has(requestId)) return false;

    while (handledUntilByRequestId.size >= maxEntries) {
      const oldestRequestId = handledUntilByRequestId.keys().next().value;
      if (oldestRequestId === undefined) break;
      handledUntilByRequestId.delete(oldestRequestId);
    }

    handledUntilByRequestId.set(requestId, nowMs + ttlMs);
    return true;
  };
}

const markSharedNotificationResponseHandled = createNotificationResponseDeduper();

export function markNotificationResponseHandled(requestId: string): boolean {
  return markSharedNotificationResponseHandled(requestId);
}

export function parseStaffLedgerNotificationResponse(
  response: unknown,
): ParsedStaffLedgerNotification | null {
  if (!isRecord(response) || !isRecord(response.notification)) return null;

  const request = response.notification.request;
  if (!isRecord(request) || !isNonEmptyString(request.identifier)) return null;

  const content = request.content;
  if (!isRecord(content) || !isRecord(content.data)) return null;
  const data = content.data;
  if (
    data.type !== 'staff-ledger-entry'
    || !isNonEmptyString(data.notificationId)
    || !isNonEmptyString(data.businessId)
  ) {
    return null;
  }

  return {
    requestId: request.identifier,
    navigation: {
      notificationId: data.notificationId,
      businessId: data.businessId,
      partyId: isNonEmptyString(data.partyId) ? data.partyId : null,
    },
  };
}
