import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { supabaseProjectUrl } from '../../../../config/public-auth.json';

const mockAuth = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: mockAuth })),
}));

import {
  beginSupabaseGoogleSignIn,
  ensureSupabaseAppSession,
  signOutSupabase,
  subscribeSupabaseEmail,
} from './supabaseAuth';

describe('Supabase Google sign-in bridge', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-public-anon-key');
    mockAuth.signInWithOAuth.mockReset().mockResolvedValue({ error: null });
    mockAuth.getSession.mockReset().mockResolvedValue({
      data: { session: { access_token: 'test-access-token' } },
      error: null,
    });
    mockAuth.signOut.mockReset().mockResolvedValue({ error: null });
    mockAuth.onAuthStateChange.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    ));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('starts Google OAuth with the production root redirect', async () => {
    await beginSupabaseGoogleSignIn();
    expect(mockAuth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://banglakhata.com' },
    });
  });

  it('keeps existing ledger settings usable when Google browser configuration is absent', () => {
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const onEmail = vi.fn();
    const unsubscribe = subscribeSupabaseEmail(onEmail);
    expect(onEmail).toHaveBeenCalledWith(null);
    expect(mockAuth.onAuthStateChange).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });

  it('uses the public project URL when no override is configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', undefined);
    vi.resetModules();
    const { beginSupabaseGoogleSignIn: beginWithFreshConfig } = await import('./supabaseAuth');
    await beginWithFreshConfig();
    expect(createClient).toHaveBeenCalledWith(supabaseProjectUrl, 'test-public-anon-key', expect.any(Object));
  });

  it('exchanges a callback session with the server before app requests', async () => {
    const fetchMock = vi.mocked(fetch);
    await ensureSupabaseAppSession();
    await ensureSupabaseAppSession();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/supabase/session', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ accessToken: 'test-access-token' }),
    }));
  });

  it('revokes the app cookie and Supabase browser session on sign-out', async () => {
    await signOutSupabase();
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout-event', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
    expect(mockAuth.signOut).toHaveBeenCalledOnce();
  });
});
