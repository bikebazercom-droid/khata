import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useIdTokenAuthRequest } from 'expo-auth-session/providers/google';
import type { AuthSessionResult } from 'expo-auth-session';

type Props = {
  attempt: number;
  onToken: (idToken: string) => void;
  onError: (message: string) => void;
};

const MISSING_CLIENT_IDS_ERROR =
  'Google sign-in is not configured in this Android build. Add the Android and Web OAuth client IDs, then rebuild the app.';

function getAuthError(result: AuthSessionResult): string {
  if (result.type === 'cancel' || result.type === 'dismiss') {
    return 'Google sign-in was cancelled.';
  }
  if (result.type === 'error') {
    return result.error?.message || 'Google sign-in could not be opened.';
  }
  return 'Google did not return a sign-in token. Check the Android OAuth client setup.';
}

export function NativeGoogleAuthBridge({ attempt, onToken, onError }: Props) {
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID?.trim();
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();

  if (Platform.OS !== 'android') {
    return <NativeGoogleAuthUnavailable attempt={attempt} onError={onError} />;
  }
  if (!androidClientId || !webClientId) {
    return (
      <NativeGoogleAuthUnavailable
        attempt={attempt}
        onError={onError}
        message={MISSING_CLIENT_IDS_ERROR}
      />
    );
  }

  return (
    <ConfiguredNativeGoogleAuth
      attempt={attempt}
      androidClientId={androidClientId}
      webClientId={webClientId}
      onToken={onToken}
      onError={onError}
    />
  );
}

function NativeGoogleAuthUnavailable({
  attempt,
  onError,
  message = 'Native Google sign-in is currently configured for Android only.',
}: {
  attempt: number;
  onError: (message: string) => void;
  message?: string;
}) {
  const lastReportedAttempt = useRef(0);
  useEffect(() => {
    if (attempt <= 0 || attempt === lastReportedAttempt.current) return;
    lastReportedAttempt.current = attempt;
    onError(message);
  }, [attempt, message, onError]);
  return null;
}

function ConfiguredNativeGoogleAuth({
  attempt,
  androidClientId,
  webClientId,
  onToken,
  onError,
}: Props & { androidClientId: string; webClientId: string }) {
  const lastStartedAttempt = useRef(0);
  const [request, , promptAsync] = useIdTokenAuthRequest({
    androidClientId,
    webClientId,
    selectAccount: true,
  });

  useEffect(() => {
    if (attempt <= 0 || attempt === lastStartedAttempt.current) return;
    if (!request) return;

    lastStartedAttempt.current = attempt;
    void promptAsync().then((result) => {
      if (result.type === 'success' && typeof result.params.id_token === 'string') {
        onToken(result.params.id_token);
        return;
      }
      onError(getAuthError(result));
    }).catch(() => {
      onError('Google sign-in could not be completed. Please try again.');
    });
  }, [androidClientId, attempt, onError, onToken, promptAsync, request, webClientId]);

  return null;
}
