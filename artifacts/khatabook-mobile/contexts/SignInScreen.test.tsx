import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flow = vi.hoisted(() => ({
  sendOtp: vi.fn(),
  verifyOtp: vi.fn(),
  acceptSession: vi.fn(),
  replaceRoute: vi.fn(),
}));

vi.mock('react-native', async () => {
  const NativeReact = await import('react');
  type NativeProps = {
    children?: React.ReactNode;
    testID?: string;
    style?: unknown;
    accessibilityLabel?: string;
  };
  type NativeInputProps = NativeProps & {
    value?: string;
    placeholder?: string;
    maxLength?: number;
    onChangeText?: (value: string) => void;
  };

  return {
    Image: ({ accessibilityLabel }: NativeProps) =>
      NativeReact.createElement('img', { alt: accessibilityLabel ?? '' }),
    Platform: { OS: 'web' },
    Text: ({ children }: NativeProps) => NativeReact.createElement('span', null, children),
    TextInput: ({ value, placeholder, maxLength, onChangeText, testID }: NativeInputProps) =>
      NativeReact.createElement('input', {
        value,
        placeholder,
        maxLength,
        'data-testid': testID,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.currentTarget.value),
      }),
    View: ({ children, testID }: NativeProps) =>
      NativeReact.createElement('div', { 'data-testid': testID }, children),
  };
});

vi.mock('@workspace/api-client-react', () => ({
  useSendPhoneOtp: () => ({ mutateAsync: flow.sendOtp, isPending: false }),
  useVerifyPhoneOtp: () => ({ mutateAsync: flow.verifyOtp, isPending: false }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ acceptSession: flow.acceptSession }),
}));

vi.mock('expo-router', () => ({
  router: { replace: flow.replaceRoute },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#fff',
    mutedForeground: '#666',
    foreground: '#111',
    input: '#ddd',
    card: '#fff',
    secondary: '#eee',
    border: '#ddd',
    primary: '#123456',
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
    flow.replaceRoute.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('sends a normalized Bangladeshi number, verifies Bengali OTP digits, and accepts the session', async () => {
    render(<SignInScreen />);

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
});