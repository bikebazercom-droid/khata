import { describe, expect, it } from 'vitest';
import { resolveMobileStartupConfig } from './startupConfig';

describe('resolveMobileStartupConfig', () => {
  it('allows missing runtime variables without throwing', () => {
    expect(resolveMobileStartupConfig({
      apiDomain: undefined,
    })).toEqual({
      apiBaseUrl: null,
    });
  });

  it('treats blank and malformed runtime values as unavailable', () => {
    expect(resolveMobileStartupConfig({
      apiDomain: '   ',
    })).toEqual({
      apiBaseUrl: null,
    });
  });

  it('normalizes the API host', () => {
    expect(resolveMobileStartupConfig({
      apiDomain: 'https://api.example.com/path?ignored=1',
    })).toEqual({
      apiBaseUrl: 'https://api.example.com',
    });
  });

  it('rejects insecure or invalid API URLs', () => {
    expect(resolveMobileStartupConfig({
      apiDomain: 'http://api.example.com',
    })).toEqual({
      apiBaseUrl: null,
    });
  });
});
