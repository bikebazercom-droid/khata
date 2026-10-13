import { describe, expect, it } from 'vitest';
import {
  createPushTokenEventScript,
  createStaffLedgerNavigationEventScript,
  markNotificationResponseHandled,
  parseStaffLedgerNotificationResponse,
} from './notificationBridge';

describe('native notification WebView bridge', () => {
  it.each(['android', 'ios'] as const)(
    'forwards a successfully registered %s push token to the website',
    (platform) => {
      const script = createPushTokenEventScript('ExponentPushToken[test-token]', platform);
      expect(script).toContain('CustomEvent("banglakhata-native-push-token"');
      expect(script).toContain('"token":"ExponentPushToken[test-token]"');
      expect(script).toContain(`"platform":"${platform}"`);
    },
  );

  it('dispatches every staff-ledger route identifier from a valid notification tap', () => {
    const parsed = parseStaffLedgerNotificationResponse({
      notification: {
        request: {
          identifier: 'request-1',
          content: {
            data: {
              type: 'staff-ledger-entry',
              notificationId: 'notification-1',
              businessId: 'business-1',
              partyId: 'party-1',
            },
          },
        },
      },
    });

    expect(parsed).toEqual({
      requestId: 'request-1',
      navigation: {
        notificationId: 'notification-1',
        businessId: 'business-1',
        partyId: 'party-1',
      },
    });
    expect(createStaffLedgerNavigationEventScript(parsed!.navigation)).toContain(
      '"notificationId":"notification-1","businessId":"business-1","partyId":"party-1"',
    );
  });

  it('does not create navigation data for malformed or unrelated notification responses', () => {
    const malformedResponses: unknown[] = [
      null,
      {},
      { notification: { request: { identifier: 'request-2', content: { data: null } } } },
      {
        notification: {
          request: {
            identifier: 'request-3',
            content: { data: { type: 'other', notificationId: 'n', businessId: 'b' } },
          },
        },
      },
      {
        notification: {
          request: {
            identifier: 'request-4',
            content: { data: { type: 'staff-ledger-entry', notificationId: '', businessId: 'b' } },
          },
        },
      },
    ];

    for (const response of malformedResponses) {
      expect(parseStaffLedgerNotificationResponse(response)).toBeNull();
    }
  });

  it('dispatches a repeated request only once and still accepts a different request', () => {
    const response = (requestId: string) => ({
      notification: {
        request: {
          identifier: requestId,
          content: {
            data: {
              type: 'staff-ledger-entry',
              notificationId: `notification-${requestId}`,
              businessId: 'business-1',
              partyId: 'party-1',
            },
          },
        },
      },
    });
    const handledRequestIds = new Set<string>();
    const dispatchedScripts: string[] = [];

    for (const notificationResponse of [
      response('request-1'),
      response('request-1'),
      response('request-2'),
    ]) {
      const parsed = parseStaffLedgerNotificationResponse(notificationResponse);
      if (parsed && markNotificationResponseHandled(handledRequestIds, parsed.requestId)) {
        dispatchedScripts.push(createStaffLedgerNavigationEventScript(parsed.navigation));
      }
    }

    expect(dispatchedScripts).toHaveLength(2);
    expect(dispatchedScripts[0]).toContain('"notificationId":"notification-request-1"');
    expect(dispatchedScripts[1]).toContain('"notificationId":"notification-request-2"');
  });
});
