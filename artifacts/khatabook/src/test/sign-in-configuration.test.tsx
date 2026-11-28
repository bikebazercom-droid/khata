import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const oauth = vi.hoisted(() => ({ begin: vi.fn(), restore: vi.fn() }));
vi.mock('../lib/supabaseAuth', () => ({
  beginSupabaseGoogleSignIn: oauth.begin,
  ensureSupabaseAppSession: oauth.restore,
}));
import { SignInPage } from '../pages/sign-in';

function showSignIn() {
  render(<QueryClientProvider client={new QueryClient()}>
    <SignInPage />
  </QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  oauth.begin.mockResolvedValue(undefined);
  oauth.restore.mockResolvedValue(false);
});
afterEach(() => {
  cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

describe('sign-in availability after a configuration error', () => {
  it('explains unavailable web Google login but keeps the phone form usable', async () => {
    vi.stubEnv('VITE_SUPABASE_GOOGLE_CONFIG_ERROR', 'invalid-public-key');
    showSignIn();
    expect(screen.getByRole('status')).toHaveTextContent('Phone Number');
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Phone Number' }));
    expect(screen.getByTestId('input-phone')).toBeInTheDocument();
    expect(screen.getByTestId('button-send-otp')).toBeEnabled();
    expect(oauth.begin).not.toHaveBeenCalled();
    await waitFor(() => expect(oauth.restore).toHaveBeenCalled());
  });

  it('does not disable native Android Google sign-in when web configuration is invalid', () => {
    vi.stubEnv('VITE_SUPABASE_GOOGLE_CONFIG_ERROR', 'invalid-public-key');
    const postMessage = vi.fn();
    vi.stubGlobal('ReactNativeWebView', { postMessage });
    showSignIn();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(postMessage).toHaveBeenCalledWith(JSON.stringify({ type: 'banglakhata-native-google-sign-in' }));
    expect(oauth.begin).not.toHaveBeenCalled();
    expect(oauth.restore).not.toHaveBeenCalled();
  });

  it('still starts web Google OAuth when there is no configuration error', async () => {
    vi.stubEnv('VITE_SUPABASE_GOOGLE_CONFIG_ERROR', '');
    showSignIn();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    await waitFor(() => expect(oauth.begin).toHaveBeenCalledOnce());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
