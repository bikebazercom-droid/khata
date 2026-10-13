import { describe, expect, it } from 'vitest';
import {
  createPushTokenEventScript,
  createStaffLedgerNavigationEventScript,
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
});
