import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customFetch, setAuthTokenGetter, setBaseUrl, setExtraHeaders } from '../../../lib/api-client-react/src/custom-fetch';

describe('customFetch browser credentials', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    setBaseUrl(null);
    setAuthTokenGetter(null);
    setExtraHeaders({});
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes browser cookies by default for cross-origin API requests', async () => {
    await customFetch('/api/auth/me');

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({
      credentials: 'include',
    }));
  });

  it('preserves an explicitly supplied browser credentials mode', async () => {
    await customFetch('/api/auth/me', { credentials: 'omit' });

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({
      credentials: 'omit',
    }));
  });

  it('does not add browser credentials settings in native runtimes', async () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);

    await customFetch('/api/auth/me');

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.not.objectContaining({
      credentials: 'include',
    }));
  });
});