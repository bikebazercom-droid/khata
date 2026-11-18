import { createClient, type Session } from '@supabase/supabase-js';
import { supabaseProjectUrl } from '../../../../config/public-auth.json';

let client: ReturnType<typeof createClient> | undefined;
let exchangedAccessToken = '';
let pendingExchange: { accessToken: string; promise: Promise<void> } | undefined;

export function getSupabaseAuthClient() {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() || supabaseProjectUrl;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    throw new Error('Supabase Google sign-in is not configured.');
  }
  try {
    if (new URL(url).protocol !== 'https:') throw new Error();
  } catch {
    throw new Error('Supabase project URL is invalid; use the full HTTPS project URL.');
  }
  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
  return client;
}

export async function beginSupabaseGoogleSignIn(): Promise<void> {
  const { error } = await getSupabaseAuthClient().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: 'https://banglakhata.com' },
  });
  if (error) throw error;
}

async function exchangeAccessToken(session: Session): Promise<void> {
  if (session.access_token === exchangedAccessToken) return;
  if (pendingExchange?.accessToken === session.access_token) {
    return pendingExchange.promise;
  }
  const promise = (async () => {
    const response = await fetch('/api/auth/supabase/session', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: session.access_token }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || 'Supabase sign-in could not be completed.');
    }
    exchangedAccessToken = session.access_token;
  })();
  pendingExchange = { accessToken: session.access_token, promise };
  try {
    await promise;
  } finally {
    if (pendingExchange?.promise === promise) pendingExchange = undefined;
  }
}

export async function ensureSupabaseAppSession(): Promise<boolean> {
  if (!import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()) return false;
  const { data, error } = await getSupabaseAuthClient().auth.getSession();
  if (error) throw error;
  if (!data.session) return false;
  await exchangeAccessToken(data.session);
  return true;
}

export async function signOutSupabase(): Promise<void> {
  const response = await fetch('/api/auth/logout-event', {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok && response.status !== 401) {
    throw new Error('The server could not confirm sign-out.');
  }
  exchangedAccessToken = '';
  pendingExchange = undefined;
  const { error } = await getSupabaseAuthClient().auth.signOut();
  if (error) throw error;
}

export function subscribeSupabaseEmail(onEmail: (email: string | null) => void): () => void {
  const { data } = getSupabaseAuthClient().auth.onAuthStateChange((_event, session) => {
    onEmail(session?.user.email ?? null);
  });
  return () => data.subscription.unsubscribe();
}
