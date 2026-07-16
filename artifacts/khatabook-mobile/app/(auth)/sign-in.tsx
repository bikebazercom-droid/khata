import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { useSignIn, useSSO } from '@clerk/expo';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

// Preload browser on Android to reduce auth load time
WebBrowser.maybeCompleteAuthSession();

function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

type AuthMode = 'email' | 'phone';

export default function SignInScreen() {
  useWarmUpBrowser();

  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { signIn, errors: signInErrors, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();

  const [mode, setMode] = useState<AuthMode>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [needsMfaCode, setNeedsMfaCode] = useState(false);
  const [mfaCode, setMfaCode] = useState('');

  const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : '';

  // ─── Email / password sign-in ───────────────────────────────────────────────

  async function handleEmailSignIn() {
    try {
      const { error } = await signIn.password({ emailAddress: email, password });
      if (error) {
        Alert.alert('Sign In Failed', error.message ?? 'Invalid credentials');
        return;
      }
      if (signIn.status === 'complete') {
        await signIn.finalize({
          navigate: ({ decorateUrl }) => {
            router.replace(decorateUrl('/') as any);
          },
        });
      } else if (signIn.status === 'needs_client_trust') {
        await signIn.mfa.sendEmailCode();
        setNeedsMfaCode(true);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Something went wrong');
    }
  }

  async function handleMfaVerify() {
    try {
      await signIn.mfa.verifyEmailCode({ code: mfaCode });
      if (signIn.status === 'complete') {
        await signIn.finalize({
          navigate: ({ decorateUrl }) => {
            router.replace(decorateUrl('/') as any);
          },
        });
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Invalid verification code');
    }
  }

  // ─── Google OAuth ────────────────────────────────────────────────────────────

  const handleGoogleSignIn = useCallback(async () => {
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      if (createdSessionId) {
        setActive!({
          session: createdSessionId,
          navigate: async ({ decorateUrl }) => {
            router.replace(decorateUrl('/') as any);
          },
        });
      }
    } catch (err: any) {
      Alert.alert('Google Sign-In Failed', err?.message ?? 'Something went wrong');
    }
  }, [startSSOFlow, router]);

  // ─── Phone OTP ───────────────────────────────────────────────────────────────

  async function handleSendOtp() {
    if (!phone.trim()) return;
    setPhoneLoading(true);
    try {
      const res = await fetch(`${baseUrl}/api/auth/phone/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Failed to send OTP');
      setOtpSent(true);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setPhoneLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (!otp.trim()) return;
    setPhoneLoading(true);
    try {
      const res = await fetch(`${baseUrl}/api/auth/phone/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), code: otp.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Invalid OTP');
      if (!body.token) throw new Error('Server did not return a session token');
      // Store the phone session JWT in SecureStore so the tabs layout can
      // attach it as a Bearer token on every API request.
      await SecureStore.setItemAsync('phone_session_token', body.token);
      router.replace('/(tabs)' as any);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setPhoneLoading(false);
    }
  }

  // ─── Styles ──────────────────────────────────────────────────────────────────

  const s = StyleSheet.create({
    outer: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: 24,
      paddingTop: insets.top + 24,
      paddingBottom: insets.bottom + 24,
    },
    logo: {
      alignItems: 'center',
      marginBottom: 32,
    },
    logoIcon: {
      width: 64,
      height: 64,
      borderRadius: 16,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    appName: {
      fontSize: 24,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
    },
    subtitle: {
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      marginTop: 4,
    },
    modeSwitcher: {
      flexDirection: 'row',
      backgroundColor: colors.muted,
      borderRadius: 10,
      padding: 4,
      marginBottom: 24,
    },
    modeBtn: {
      flex: 1,
      paddingVertical: 8,
      alignItems: 'center',
      borderRadius: 8,
    },
    modeBtnActive: {
      backgroundColor: colors.card,
    },
    modeBtnText: {
      fontSize: 14,
      fontFamily: 'Inter_500Medium',
      color: colors.mutedForeground,
    },
    modeBtnTextActive: {
      color: colors.foreground,
    },
    label: {
      fontSize: 13,
      fontFamily: 'Inter_500Medium',
      color: colors.mutedForeground,
      marginBottom: 6,
      marginTop: 14,
    },
    input: {
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      fontFamily: 'Inter_400Regular',
      color: colors.foreground,
    },
    primaryBtn: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 20,
    },
    primaryBtnDisabled: { opacity: 0.5 },
    primaryBtnText: {
      color: colors.primaryForeground,
      fontSize: 16,
      fontFamily: 'Inter_600SemiBold',
    },
    dividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: 20,
    },
    dividerLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    dividerText: {
      marginHorizontal: 12,
      fontSize: 13,
      color: colors.mutedForeground,
      fontFamily: 'Inter_400Regular',
    },
    googleBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingVertical: 13,
    },
    googleBtnText: {
      fontSize: 15,
      fontFamily: 'Inter_500Medium',
      color: colors.foreground,
    },
    sendOtpRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 14,
    },
    phoneInput: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      fontFamily: 'Inter_400Regular',
      color: colors.foreground,
    },
    sendBtn: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingHorizontal: 16,
      justifyContent: 'center',
    },
    sendBtnText: {
      color: colors.primaryForeground,
      fontSize: 14,
      fontFamily: 'Inter_600SemiBold',
    },
    errorText: {
      fontSize: 12,
      color: '#ef4444',
      fontFamily: 'Inter_400Regular',
      marginTop: 4,
    },
  });

  // ─── Phone OTP view ──────────────────────────────────────────────────────────

  if (mode === 'phone') {
    return (
      <View style={s.outer}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={s.logo}>
              <View style={s.logoIcon}>
                <Feather name="book-open" size={32} color="#fff" />
              </View>
              <Text style={s.appName}>হাজারী খাতাবুক</Text>
              <Text style={s.subtitle}>Sign in with phone number</Text>
            </View>

            <View style={s.modeSwitcher}>
              <TouchableOpacity
                style={s.modeBtn}
                onPress={() => setMode('email')}
              >
                <Text style={s.modeBtnText}>Email</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modeBtn, s.modeBtnActive]}>
                <Text style={[s.modeBtnText, s.modeBtnTextActive]}>Phone</Text>
              </TouchableOpacity>
            </View>

            {!otpSent ? (
              <>
                <Text style={s.label}>Phone Number</Text>
                <View style={s.sendOtpRow}>
                  <TextInput
                    style={s.phoneInput}
                    placeholder="01XXXXXXXXX"
                    placeholderTextColor={colors.mutedForeground}
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                  />
                  <TouchableOpacity
                    style={[s.sendBtn, (!phone.trim() || phoneLoading) && s.primaryBtnDisabled]}
                    onPress={handleSendOtp}
                    disabled={!phone.trim() || phoneLoading}
                  >
                    {phoneLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={s.sendBtnText}>Send OTP</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={s.label}>
                  Enter the 6-digit code sent to {phone}
                </Text>
                <TextInput
                  style={s.input}
                  placeholder="000000"
                  placeholderTextColor={colors.mutedForeground}
                  value={otp}
                  onChangeText={setOtp}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />
                <TouchableOpacity
                  style={[s.primaryBtn, (!otp.trim() || phoneLoading) && s.primaryBtnDisabled]}
                  onPress={handleVerifyOtp}
                  disabled={!otp.trim() || phoneLoading}
                  activeOpacity={0.8}
                >
                  {phoneLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={s.primaryBtnText}>Verify & Sign In</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ marginTop: 12, alignItems: 'center' }}
                  onPress={() => { setOtpSent(false); setOtp(''); }}
                >
                  <Text style={{ color: colors.mutedForeground, fontSize: 14, fontFamily: 'Inter_400Regular' }}>
                    Change number
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  // ─── Email / password view ───────────────────────────────────────────────────

  if (needsMfaCode) {
    return (
      <View style={s.outer}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={s.logo}>
              <View style={s.logoIcon}>
                <Feather name="book-open" size={32} color="#fff" />
              </View>
              <Text style={s.appName}>হাজারী খাতাবুক</Text>
              <Text style={s.subtitle}>Check your email for a code</Text>
            </View>

            <Text style={s.label}>Verification Code</Text>
            <TextInput
              style={s.input}
              placeholder="Enter code"
              placeholderTextColor={colors.mutedForeground}
              value={mfaCode}
              onChangeText={setMfaCode}
              keyboardType="number-pad"
              autoFocus
            />
            <TouchableOpacity
              style={[s.primaryBtn, (!mfaCode || fetchStatus === 'fetching') && s.primaryBtnDisabled]}
              onPress={handleMfaVerify}
              disabled={!mfaCode || fetchStatus === 'fetching'}
              activeOpacity={0.8}
            >
              {fetchStatus === 'fetching' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={s.primaryBtnText}>Verify</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={{ marginTop: 12, alignItems: 'center' }}
              onPress={() => { setNeedsMfaCode(false); setMfaCode(''); }}
            >
              <Text style={{ color: colors.mutedForeground, fontSize: 14, fontFamily: 'Inter_400Regular' }}>
                Back
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  return (
    <View style={s.outer}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.logo}>
            <View style={s.logoIcon}>
              <Feather name="book-open" size={32} color="#fff" />
            </View>
            <Text style={s.appName}>হাজারী খাতাবুক</Text>
            <Text style={s.subtitle}>Sign in to access your khatabook</Text>
          </View>

          <View style={s.modeSwitcher}>
            <TouchableOpacity style={[s.modeBtn, s.modeBtnActive]}>
              <Text style={[s.modeBtnText, s.modeBtnTextActive]}>Email</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.modeBtn}
              onPress={() => setMode('phone')}
            >
              <Text style={s.modeBtnText}>Phone</Text>
            </TouchableOpacity>
          </View>

          {/* Google Sign-In */}
          <TouchableOpacity style={s.googleBtn} onPress={handleGoogleSignIn} activeOpacity={0.8}>
            <Feather name="grid" size={18} color={colors.foreground} />
            <Text style={s.googleBtnText}>Continue with Google</Text>
          </TouchableOpacity>

          <View style={s.dividerRow}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>or</Text>
            <View style={s.dividerLine} />
          </View>

          {/* Email + Password */}
          <Text style={[s.label, { marginTop: 0 }]}>Email</Text>
          <TextInput
            style={s.input}
            placeholder="you@example.com"
            placeholderTextColor={colors.mutedForeground}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          {signInErrors?.fields?.identifier && (
            <Text style={s.errorText}>{signInErrors.fields.identifier.message}</Text>
          )}

          <Text style={s.label}>Password</Text>
          <TextInput
            style={s.input}
            placeholder="Your password"
            placeholderTextColor={colors.mutedForeground}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
          />
          {signInErrors?.fields?.password && (
            <Text style={s.errorText}>{signInErrors.fields.password.message}</Text>
          )}

          <TouchableOpacity
            style={[
              s.primaryBtn,
              (!email || !password || fetchStatus === 'fetching') && s.primaryBtnDisabled,
            ]}
            onPress={handleEmailSignIn}
            disabled={!email || !password || fetchStatus === 'fetching'}
            activeOpacity={0.8}
          >
            {fetchStatus === 'fetching' ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={s.primaryBtnText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
