import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flow = vi.hoisted(() => ({
  sendOtp: vi.fn(),
  verifyOtp: vi.fn(),
  acceptSession: vi.fn(),
  acceptClerkSession: vi.fn(),
  replaceRoute: vi.fn(),
  signInStatus: 'complete',
  signUpStatus: 'complete',
  signInPassword: vi.fn(),
  signInFinalize: vi.fn(),
  sendMfaCode: vi.fn(),
  verifyMfaCode: vi.fn(),
  signUpPassword: vi.fn(),
  signUpFinalize: vi.fn(),
  sendEmailCode: vi.fn(),
  verifyEmailCode: vi.fn(),
  startSSOFlow: vi.fn(),
}));

vi.mock('react-native', async () => {
  const NativeReact = await import('react');
  type NativeProps = {
    children?: React.ReactNode;
    testID?: string;
    style?: unknown;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    accessibilityState?: { selected?: boolean; disabled?: boolean };
    disabled?: boolean;
    onPress?: () => void;
  };
  type NativeInputProps = NativeProps & {
    value?: string;
    placeholder?: string;
    maxLength?: number;
    onChangeText?: (value: string) => void;
    autoCapitalize?: string;
    autoComplete?: string;
    keyboardType?: string;
    secureTextEntry?: boolean;
  };

  return {
    Image: ({ accessibilityLabel }: NativeProps) =>
      NativeReact.createElement('img', { alt: accessibilityLabel ?? '' }),
    Platform: { OS: 'web' },
    Pressable: ({ children, disabled, onPress, testID }: NativeProps) =>
      NativeReact.createElement('button', {
        type: 'button',
        disabled,
        'data-testid': testID,
        onClick: onPress,
      }, children),
    Text: ({ children }: NativeProps) => NativeReact.createElement('span', null, children),
    TextInput: ({ value, placeholder, maxLength, onChangeText, testID, secureTextEntry }: NativeInputProps) =>
      NativeReact.createElement('input', {
        value,
        placeholder,
        maxLength,
        type: secureTextEntry ? 'password' : 'text',
        'data-testid': testID,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.currentTarget.value),
      }),
    View: ({ children, testID, accessibilityRole }: NativeProps) =>
      NativeReact.createElement('div', {
        'data-testid': testID,
        role: accessibilityRole,
      }, children),
  };
});

vi.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

vi.mock('expo-auth-session', () => ({
  makeRedirectUri: vi.fn(() => 'banglakhata://oauth-callback'),
}));

vi.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: vi.fn(),
  warmUpAsync: vi.fn(),
  coolDownAsync: vi.fn(),
}));

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ isSignedIn: false }),
  useSignIn: () => ({
    signIn: {
      get status() { return flow.signInStatus; },
      password: flow.signInPassword,
      finalize: flow.signInFinalize,
      mfa: { sendEmailCode: flow.sendMfaCode, verifyEmailCode: flow.verifyMfaCode },
    },
    fetchStatus: 'idle',
  }),
  useSignUp: () => ({
    signUp: {
      get status() { return flow.signUpStatus; },
      password: flow.signUpPassword,
      finalize: flow.signUpFinalize,
      verifications: { sendEmailCode: flow.sendEmailCode, verifyEmailCode: flow.verifyEmailCode },
    },
    fetchStatus: 'idle',
  }),
}));

vi.mock('@clerk/expo/experimental', () => ({
  useSSO: () => ({ startSSOFlow: flow.startSSOFlow }),
}));

vi.mock('@workspace/api-client-react', () => ({
  useSendPhoneOtp: () => ({ mutateAsync: flow.sendOtp, isPending: false }),
  useVerifyPhoneOtp: () => ({ mutateAsync: flow.verifyOtp, isPending: false }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    acceptSession: flow.acceptSession,
    acceptClerkSession: flow.acceptClerkSession,
  }),
}));

vi.mock('expo-router', () => ({
  router: { replace: flow.replaceRoute },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    auth: {
      backgroundStart: '#123456',
      backgroundEnd: '#456789',
      onBackground: '#fff',
      foreground: '#111',
      mutedForeground: '#666',
      card: '#fff',
      border: '#ddd',
    },
  }),
}));

vi.mock('@/components/KeyboardAwareScrollViewCompat', () => ({
  KeyboardAwareScrollViewCompat: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

vi.mock('@/components/Kit', () => ({
  AppButton: ({
    title,
    onPress,
    disabled,
    loading,
    testID,
  }: {
    title: string;
    onPress: () => void;
    disabled?: boolean;
    loading?: boolean;
    testID?: string;
  }) => (
    <button
      type="button"
      data-testid={testID}
      disabled={disabled || loading}
      onClick={onPress}
    >
      {title}
    </button>
  ),
  Field: ({
    label,
    value,
    onChangeText,
    testID,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    testID?: string;
  }) => (
    <label>
      {label}
      <input
        data-testid={testID}
        value={value}
        onChange={(event) => onChangeText(event.currentTarget.value)}
      />
    </label>
  ),
  Notice: ({ message }: { message: string }) => <div role="alert">{message}</div>,
}));

import SignInScreen from '@/app/sign-in';

describe('mobile phone-number sign-in', () => {
  beforeEach(() => {
    flow.sendOtp.mockReset().mockResolvedValue({});
    flow.verifyOtp.mockReset().mockResolvedValue({ token: 'verified-phone-session' });
    flow.acceptSession.mockReset().mockResolvedValue(undefined);
    flow.acceptClerkSession.mockReset().mockResolvedValue(undefined);
    flow.replaceRoute.mockReset();
    flow.signInStatus = 'complete';
    flow.signUpStatus = 'complete';
    flow.signInPassword.mockReset().mockResolvedValue({ error: null });
    flow.signInFinalize.mockReset().mockResolvedValue({ error: null });
    flow.sendMfaCode.mockReset().mockResolvedValue({ error: null });
    flow.verifyMfaCode.mockReset().mockResolvedValue({ error: null });
    flow.signUpPassword.mockReset().mockResolvedValue({ error: null });
    flow.signUpFinalize.mockReset().mockResolvedValue({ error: null });
    flow.sendEmailCode.mockReset().mockResolvedValue({ error: null });
    flow.verifyEmailCode.mockReset().mockResolvedValue({ error: null });
    flow.startSSOFlow.mockReset().mockResolvedValue({
      createdSessionId: 'clerk-session',
      authSessionResult: { type: 'success' },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('sends a normalized Bangladeshi number, verifies Bengali OTP digits, and accepts the session', async () => {
    render(<SignInScreen />);
    fireEvent.click(screen.getByTestId('auth-tab-phone'));

    fireEvent.change(screen.getByTestId('sign-in-phone'), {
      target: { value: '০১৮৩৪৩৪৩৫২৩' },
    });
    fireEvent.click(screen.getByTestId('send-otp-button'));

    await waitFor(() => {
      expect(flow.sendOtp).toHaveBeenCalledWith({ data: { phone: '+8801834343523' } });
    });
    expect(screen.getByTestId('sign-in-code')).toBeTruthy();

    fireEvent.change(screen.getByTestId('sign-in-code'), {
      target: { value: '১২৩৪৫৬' },
    });
    fireEvent.click(screen.getByTestId('verify-otp-button'));

    await waitFor(() => {
      expect(flow.verifyOtp).toHaveBeenCalledWith({
        data: { phone: '+8801834343523', code: '123456' },
      });
    });
    await waitFor(() => {
      expect(flow.acceptSession).toHaveBeenCalledWith({ token: 'verified-phone-session' });
      expect(flow.replaceRoute).toHaveBeenCalledWith('/');
    });
  });

  it('completes Clerk email sign-in and finalizes the session', async () => {
    render(<SignInScreen />);
    fireEvent.change(screen.getByTestId('sign-in-email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByTestId('sign-in-password'), { target: { value: 'strong-password' } });
    fireEvent.click(screen.getByTestId('email-submit-button'));

    await waitFor(() => {
      expect(flow.signInPassword).toHaveBeenCalledWith({
        emailAddress: 'owner@example.com',
        password: 'strong-password',
      });
      expect(flow.signInFinalize).toHaveBeenCalledOnce();
      expect(flow.acceptClerkSession).toHaveBeenCalledOnce();
      expect(flow.replaceRoute).toHaveBeenCalledWith('/');
    });
  });

  it('starts Google sign-in and accepts the Clerk session', async () => {
    render(<SignInScreen />);
    fireEvent.click(screen.getByTestId('google-sign-in-button'));

    await waitFor(() => {
      expect(flow.startSSOFlow).toHaveBeenCalledWith({ strategy: 'oauth_google' });
      expect(flow.acceptClerkSession).toHaveBeenCalledOnce();
      expect(flow.replaceRoute).toHaveBeenCalledWith('/');
    });
  });

  it('does not route home when Google OAuth returns unfinished requirements', async () => {
    flow.startSSOFlow.mockResolvedValue({
      createdSessionId: null,
      authSessionResult: { type: 'success' },
      signUp: { status: 'missing_requirements' },
    });
    render(<SignInScreen />);
    fireEvent.click(screen.getByTestId('google-sign-in-button'));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('additional account details'));
    expect(flow.acceptClerkSession).not.toHaveBeenCalled();
    expect(flow.replaceRoute).not.toHaveBeenCalled();
  });

  it('verifies email before finishing account creation', async () => {
    flow.signUpPassword.mockImplementation(async () => {
      flow.signUpStatus = 'needs_verification';
      return { error: null };
    });
    flow.verifyEmailCode.mockImplementation(async () => {
      flow.signUpStatus = 'complete';
      return { error: null };
    });
    render(<SignInScreen />);
    fireEvent.click(screen.getByTestId('email-mode-toggle'));
    fireEvent.change(screen.getByTestId('sign-in-email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByTestId('sign-in-password'), { target: { value: 'strong-password' } });
    fireEvent.change(screen.getByTestId('sign-in-confirm-password'), { target: { value: 'strong-password' } });
    fireEvent.click(screen.getByTestId('email-submit-button'));

    await waitFor(() => expect(flow.sendEmailCode).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByTestId('sign-in-email-code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('verify-email-code-button'));

    await waitFor(() => {
      expect(flow.verifyEmailCode).toHaveBeenCalledWith({ code: '123456' });
      expect(flow.signUpFinalize).toHaveBeenCalledOnce();
      expect(flow.acceptClerkSession).toHaveBeenCalledOnce();
      expect(flow.replaceRoute).toHaveBeenCalledWith('/');
    });
  });
});