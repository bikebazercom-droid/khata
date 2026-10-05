import { describe, expect, it } from 'vitest';
import { resolveMobileStartupConfig } from './startupConfig';

describe('resolveMobileStartupConfig', () => {
  it('allows missing runtime variables without throwing', () => {
    expect(resolveMobileStartupConfig({
      apiDomain: undefined,
      clerkPublishableKey: undefined,
    })).toEqual({
      apiBaseUrl: null,
      clerkPublishableKey: null,
    });
  });

  it('treats blank and malformed runtime values as unavailable', () => {
    expect(resolveMobileStartupConfig({
      apiDomain: '   ',
      clerkPublishableKey: 'not-a-publishable-key',
    })).toEqual({
      apiBaseUrl: null,
      clerkPublishableKey: null,
    });
  });

  it('normalizes the API host and trims a Clerk publishable key', () => {
    expect(resolveMobileStartupConfig({
      apiDomain: 'https://api.example.com/path?ignored=1',
      clerkPublishableKey: ' pk_test_example ',
    })).toEqual({
      apiBaseUrl: 'https://api.example.com',
      clerkPublishableKey: 'pk_test_example',
    });
  });

  it('rejects insecure or invalid API URLs', () => {
    expect(resolveMobileStartupConfig({
      apiDomain: 'http://api.example.com',
      clerkPublishableKey: 'pk_live_example',
    })).toEqual({
      apiBaseUrl: null,
      clerkPublishableKey: 'pk_live_example',
    });
  });
});
