import { describe, expect, it } from 'vitest';
import { canUseNativeNotifications } from './notificationRuntime';

describe('canUseNativeNotifications', () => {
  it('disables native notifications in Android and iOS development previews', () => {
    expect(canUseNativeNotifications('android', true)).toBe(false);
    expect(canUseNativeNotifications('ios', true)).toBe(false);
  });

  it('disables native notifications in web previews', () => {
    expect(canUseNativeNotifications('web', false)).toBe(false);
    expect(canUseNativeNotifications('web', true)).toBe(false);
  });

  it('keeps native notifications enabled in production native builds', () => {
    expect(canUseNativeNotifications('android', false)).toBe(true);
    expect(canUseNativeNotifications('ios', false)).toBe(true);
  });
});
