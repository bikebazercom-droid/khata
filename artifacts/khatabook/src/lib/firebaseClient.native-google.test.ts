// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exchangeFirebaseIdToken,
  exchangeGoogleIdTokenForFirebaseIdToken,
} from './firebaseClient';

describe('native Google sign-in exchange', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-firebase-web-key');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('exchanges the native Google ID token through Firebase and returns its Firebase ID token', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      idToken: 'firebase-id-token',
    }), { status: 200 }));

    await expect(exchangeGoogleIdTokenForFirebaseIdToken('google-id-token'))
      .resolves.toBe('firebase-id-token');

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('identitytoolkit.googleapis.com/v1/accounts:signInWithIdp');
    expect(url).toContain('key=test-firebase-web-key');
    expect(JSON.parse(String(request.body))).toMatchObject({
      postBody: 'id_token=google-id-token&providerId=google.com',
      requestUri: window.location.origin,
      returnSecureToken: true,
    });
  });

  it('reports Firebase verification errors instead of continuing with a partial session', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'INVALID_IDP_RESPONSE' },
    }), { status: 400 }));

    await expect(exchangeGoogleIdTokenForFirebaseIdToken('bad-google-token'))
      .rejects.toThrow('INVALID_IDP_RESPONSE');
  });

  it('sends the Firebase ID token to the same-origin session endpoint', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

    await expect(exchangeFirebaseIdToken('firebase-id-token')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/firebase/session', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ idToken: 'firebase-id-token' }),
    }));
  });
});
