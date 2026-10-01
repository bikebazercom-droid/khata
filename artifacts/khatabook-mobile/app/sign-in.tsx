import React, { useEffect, useState } from 'react';
import { Image, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useAuth as useClerkAuth, useSignIn, useSignUp } from '@clerk/expo';
import { useSSO } from '@clerk/expo/experimental';
import { router } from 'expo-router';
import { useSendPhoneOtp, useVerifyPhoneOtp } from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useAuth } from '@/contexts/AuthContext';
import { errorMessage } from '@/lib/domain';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

WebBrowser.maybeCompleteAuthSession();

type AuthTab = 'email' | 'phone';
type EmailMode = 'sign-in' | 'sign-up';
type EmailStage = 'credentials' | 'verify-signup' | 'verify-mfa';
type AuthColors = ReturnType<typeof useColors>['auth'];

function AuthField({
  colors,
  label,
  value,
  onChangeText,
  testID,
  placeholder,
  keyboardType = 'default',
  secureTextEntry = false,
  autoCapitalize,
  autoComplete,
  maxLength,
}: {
  colors: AuthColors;
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  testID: string;
  placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'number-pad';
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoComplete?: 'email' | 'password' | 'new-password' | 'one-time-code' | 'tel';
  maxLength?: number;
}) {
  return (
    <View style={{ gap: 7 }}>
      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '700' }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        maxLength={maxLength}
        testID={testID}
        style={{
          minHeight: 50,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          paddingHorizontal: 14,
          backgroundColor: '#FFFFFF',
          color: colors.foreground,
          fontSize: 15,
        }}
      />
    </View>
  );
}

function AuthButton({
  colors,
  title,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  testID,
}: {
  colors: AuthColors;
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'outline';
  testID: string;
}) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: 50,
        borderRadius: 12,
        borderWidth: primary ? 0 : 1,
        borderColor: colors.border,
        backgroundColor: primary ? colors.backgroundStart : '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 14,
        opacity: disabled || loading ? 0.58 : pressed ? 0.82 : 1,
      })}
    >
      <Text style={{
        color: primary ? '#FFFFFF' : colors.foreground,
        fontSize: 15,
        fontWeight: '700',
      }}>
        {loading ? 'Please wait…' : title}
      </Text>
    </Pressable>
  );
}

function GoogleButton({
  colors,
  onPress,
  loading,
}: {
  colors: AuthColors;
  onPress: () => void;
  loading: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: loading }}
      disabled={loading}
      onPress={onPress}
      testID="google-sign-in-button"
      style={({ pressed }) => ({
        minHeight: 50,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: '#FFFFFF',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        opacity: loading ? 0.58 : pressed ? 0.82 : 1,
      })}
    >
      <Text style={{ color: colors.backgroundStart, fontSize: 18, fontWeight: '800' }}>G</Text>
      <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '700' }}>
        {loading ? 'Connecting…' : 'Continue with Google'}
      </Text>
    </Pressable>
  );
}

function toAsciiDigits(value: string) {
  return value.replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6));
}

export default function SignInScreen() {
  const palette = useColors();
  const authColors = palette.auth;
  const insets = useSafeAreaInsets();
  const { acceptSession, acceptClerkSession } = useAuth();
  const clerkAuth = useClerkAuth();
  const { signIn, fetchStatus: signInFetchStatus } = useSignIn();
  const { signUp, fetchStatus: signUpFetchStatus } = useSignUp();
  const { startSSOFlow } = useSSO();
  const [tab, setTab] = useState<AuthTab>('email');
  const [emailMode, setEmailMode] = useState<EmailMode>('sign-in');
  const [emailStage, setEmailStage] = useState<EmailStage>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneStep, setPhoneStep] = useState<'phone' | 'code'>('phone');
  const [googleBusy, setGoogleBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const sendMutation = useSendPhoneOtp();
  const verifyMutation = useVerifyPhoneOtp();
  const emailBusy = signInFetchStatus === 'fetching' || signUpFetchStatus === 'fetching';
  const normalizedPhone = phone.startsWith('0') ? `+880${phone.slice(1)}` : '';
  const isPhoneValid = /^01[3-9]\d{8}$/.test(phone);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync().catch(() => undefined);
    return () => {
      void WebBrowser.coolDownAsync().catch(() => undefined);
    };
  }, []);

  const clearMessages = () => {
    setError('');
    setNotice('');
  };

  const finishClerkSignIn = async () => {
    const { error: finalizeError } = await signIn.finalize();
    if (finalizeError) throw finalizeError;
    await acceptClerkSession();
    router.replace('/');
  };

  const finishClerkSignUp = async () => {
    const { error: finalizeError } = await signUp.finalize();
    if (finalizeError) throw finalizeError;
    await acceptClerkSession();
    router.replace('/');
  };

  const submitEmail = async () => {
    clearMessages();
    if (!email.trim()) {
      setError('Enter your email address.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }
    if (emailMode === 'sign-up' && password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    try {
      if (emailMode === 'sign-in') {
        const { error: signInError } = await signIn.password({
          emailAddress: email.trim(),
          password,
        });
        if (signInError) throw signInError;
        if (signIn.status === 'complete') {
          await finishClerkSignIn();
          return;
        }
        if (signIn.status === 'needs_second_factor' || signIn.status === 'needs_client_trust') {
          const { error: codeError } = await signIn.mfa.sendEmailCode();
          if (codeError) throw codeError;
          setEmailStage('verify-mfa');
          setNotice(`A verification code was sent to ${email.trim()}.`);
          return;
        }
        throw new Error('This account needs another sign-in method. Try Google or contact your administrator.');
      }

      const { error: signUpError } = await signUp.password({
        emailAddress: email.trim(),
        password,
      });
      if (signUpError) throw signUpError;
      if (signUp.status === 'complete') {
        await finishClerkSignUp();
        return;
      }
      const { error: codeError } = await signUp.verifications.sendEmailCode();
      if (codeError) throw codeError;
      setEmailStage('verify-signup');
      setNotice(`A verification code was sent to ${email.trim()}.`);
    } catch (requestError) {
      setError(errorMessage(requestError, 'We could not sign you in. Check your details and try again.'));
    }
  };

  const verifyEmailCode = async () => {
    clearMessages();
    const normalizedCode = toAsciiDigits(emailCode).replace(/\D/g, '').slice(0, 6);
    if (normalizedCode.length !== 6) {
      setError('Enter the 6-digit email code.');
      return;
    }
    try {
      if (emailStage === 'verify-signup') {
        const { error: verifyError } = await signUp.verifications.verifyEmailCode({ code: normalizedCode });
        if (verifyError) throw verifyError;
        if (signUp.status !== 'complete') throw new Error('Email verification is incomplete. Request a new code and try again.');
        await finishClerkSignUp();
        return;
      }

      const { error: verifyError } = await signIn.mfa.verifyEmailCode({ code: normalizedCode });
      if (verifyError) throw verifyError;
      if (signIn.status !== 'complete') throw new Error('Email verification is incomplete. Request a new code and try again.');
      await finishClerkSignIn();
    } catch (requestError) {
      setError(errorMessage(requestError, 'That code is invalid or expired. Try again.'));
    }
  };

  const signInWithGoogle = async () => {
    clearMessages();
    setGoogleBusy(true);
    try {
      const redirectUrl = Platform.OS === 'web'
        ? undefined
        : AuthSession.makeRedirectUri({ scheme: 'banglakhata', path: 'oauth-callback' });
      const result = await startSSOFlow({
        strategy: 'oauth_google',
        ...(redirectUrl ? { redirectUrl } : {}),
      });
      if (result.authSessionResult?.type === 'cancel') return;
      const completed = !!result.createdSessionId
        || result.signIn?.status === 'complete'
        || result.signUp?.status === 'complete'
        || !!clerkAuth.isSignedIn;
      if (!completed) {
        setError('Google sign-in needs additional account details or verification. Try email sign-in or contact support.');
        return;
      }
      await acceptClerkSession();
      router.replace('/');
    } catch (requestError) {
      setError(errorMessage(requestError, 'Google sign-in could not be completed. Try again.'));
    } finally {
      setGoogleBusy(false);
    }
  };

  const updatePhone = (value: string) => {
    let digits = toAsciiDigits(value).replace(/\D/g, '');
    if (digits.startsWith('880') && digits.length === 13) digits = `0${digits.slice(3)}`;
    if (digits.length === 10 && digits.startsWith('1')) digits = `0${digits}`;
    setPhone(digits.slice(0, 11));
  };

  const sendPhoneCode = async () => {
    clearMessages();
    try {
      await sendMutation.mutateAsync({ data: { phone: normalizedPhone } });
      setPhoneStep('code');
      setNotice(`A code was sent to ${normalizedPhone}. Use it within 10 minutes.`);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Could not send the code. Check the number and try again.'));
    }
  };

  const verifyPhoneCode = async () => {
    clearMessages();
    try {
      const session = await verifyMutation.mutateAsync({
        data: { phone: normalizedPhone, code: toAsciiDigits(phoneCode).replace(/\D/g, '').trim() },
      });
      await acceptSession(session);
      router.replace('/');
    } catch (requestError) {
      setError(errorMessage(requestError, 'That code is invalid or expired. Try again.'));
    }
  };

  const setAuthTab = (nextTab: AuthTab) => {
    setTab(nextTab);
    clearMessages();
  };

  const startSignup = () => {
    setEmailMode('sign-up');
    setEmailStage('credentials');
    setPassword('');
    setConfirmPassword('');
    setEmailCode('');
    clearMessages();
  };

  const startSignin = () => {
    setEmailMode('sign-in');
    setEmailStage('credentials');
    setPassword('');
    setConfirmPassword('');
    setEmailCode('');
    clearMessages();
  };

  return (
    <LinearGradient
      colors={[authColors.backgroundStart, authColors.backgroundEnd]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1 }}
    >
      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 20,
          paddingTop: Platform.OS === 'web' ? 28 : insets.top + 18,
          paddingBottom: Platform.OS === 'web' ? 28 : insets.bottom + 18,
        }}
        bottomOffset={80}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ width: '100%', maxWidth: 460, gap: 18 }}>
          <View style={{ alignItems: 'center', gap: 9 }}>
            <Image
              source={require('../assets/images/brand-icon.png')}
              style={{ width: 64, height: 64, borderRadius: 18 }}
              accessibilityLabel="BanglaKhata"
            />
            <Text style={{ color: authColors.onBackground, fontSize: 27, fontWeight: '800', textAlign: 'center' }}>
              বাংলাখাতা
            </Text>
            <Text style={{ color: authColors.onBackground, opacity: 0.88, fontSize: 14, textAlign: 'center' }}>
              Your shop’s accounts, ready when you are
            </Text>
          </View>

          <View style={{
            backgroundColor: authColors.card,
            borderRadius: 24,
            padding: 20,
            gap: 18,
            shadowColor: '#0A1B35',
            shadowOffset: { width: 0, height: 14 },
            shadowOpacity: 0.2,
            shadowRadius: 28,
            elevation: 8,
          }}>
            <View style={{ gap: 4 }}>
              <Text style={{ color: authColors.foreground, fontSize: 21, fontWeight: '800' }}>
                {tab === 'email'
                  ? (emailMode === 'sign-up' ? 'Create your account' : 'Welcome back')
                  : 'Sign in with your phone'}
              </Text>
              <Text style={{ color: authColors.mutedForeground, fontSize: 13, lineHeight: 19 }}>
                {tab === 'email'
                  ? emailMode === 'sign-up' ? 'Set up a secure BanglaKhata account.' : 'Choose Email or Google to continue.'
                  : 'We’ll send a one-time code to your Bangladesh number.'}
              </Text>
            </View>

            <View style={{
              flexDirection: 'row',
              padding: 4,
              borderRadius: 13,
              backgroundColor: '#F0F4F8',
              gap: 4,
            }}>
              {([
                { value: 'email' as const, label: 'Email / Google' },
                { value: 'phone' as const, label: 'Phone Number' },
              ]).map((option) => {
                const selected = tab === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setAuthTab(option.value)}
                    testID={`auth-tab-${option.value}`}
                    style={({ pressed }) => ({
                      flex: 1,
                      minHeight: 42,
                      borderRadius: 10,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: selected ? '#FFFFFF' : 'transparent',
                      opacity: pressed ? 0.78 : 1,
                      ...(selected ? {
                        shadowColor: '#13283E',
                        shadowOffset: { width: 0, height: 1 },
                        shadowOpacity: 0.1,
                        shadowRadius: 3,
                        elevation: 1,
                      } : {}),
                    })}
                  >
                    <Text style={{
                      color: selected ? authColors.foreground : authColors.mutedForeground,
                      fontSize: 12,
                      fontWeight: selected ? '800' : '600',
                    }}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {error ? (
              <View accessibilityRole="alert" style={{ borderRadius: 10, backgroundColor: '#FEF1F1', padding: 11 }}>
                <Text style={{ color: '#A72F32', fontSize: 13, lineHeight: 19 }}>{error}</Text>
              </View>
            ) : null}
            {notice ? (
              <View style={{ borderRadius: 10, backgroundColor: '#EEF5FF', padding: 11 }}>
                <Text style={{ color: authColors.backgroundStart, fontSize: 13, lineHeight: 19 }}>{notice}</Text>
              </View>
            ) : null}

            {tab === 'email' ? (
              emailStage === 'credentials' ? (
                <View style={{ gap: 14 }}>
                  <GoogleButton colors={authColors} onPress={() => { void signInWithGoogle(); }} loading={googleBusy} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: authColors.border }} />
                    <Text style={{ color: authColors.mutedForeground, fontSize: 10, fontWeight: '700', letterSpacing: 0.7 }}>
                      OR CONTINUE WITH EMAIL
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: authColors.border }} />
                  </View>
                  <AuthField
                    colors={authColors}
                    label="Email address"
                    value={email}
                    onChangeText={setEmail}
                    testID="sign-in-email"
                    placeholder="you@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                  />
                  <AuthField
                    colors={authColors}
                    label="Password"
                    value={password}
                    onChangeText={setPassword}
                    testID="sign-in-password"
                    placeholder="Enter your password"
                    secureTextEntry
                    autoComplete={emailMode === 'sign-up' ? 'new-password' : 'password'}
                  />
                  {emailMode === 'sign-up' ? (
                    <AuthField
                      colors={authColors}
                      label="Confirm password"
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      testID="sign-in-confirm-password"
                      placeholder="Re-enter your password"
                      secureTextEntry
                      autoComplete="new-password"
                    />
                  ) : null}
                  <AuthButton
                    colors={authColors}
                    title={emailMode === 'sign-up' ? 'Create account' : 'Continue'}
                    onPress={() => { void submitEmail(); }}
                    loading={emailBusy}
                    testID="email-submit-button"
                  />
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
                    <Text style={{ color: authColors.mutedForeground, fontSize: 13 }}>
                      {emailMode === 'sign-up' ? 'Already have an account?' : 'New to BanglaKhata?'}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={emailMode === 'sign-up' ? startSignin : startSignup}
                      testID="email-mode-toggle"
                    >
                      <Text style={{ color: authColors.backgroundStart, fontSize: 13, fontWeight: '800' }}>
                        {emailMode === 'sign-up' ? 'Sign in' : 'Create an account'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={{ gap: 14 }}>
                  <AuthField
                    colors={authColors}
                    label="6-digit email code"
                    value={emailCode}
                    onChangeText={(value) => setEmailCode(toAsciiDigits(value).replace(/\D/g, '').slice(0, 6))}
                    testID="sign-in-email-code"
                    placeholder="••••••"
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                    maxLength={6}
                  />
                  <AuthButton
                    colors={authColors}
                    title="Verify email"
                    onPress={() => { void verifyEmailCode(); }}
                    loading={emailBusy}
                    disabled={toAsciiDigits(emailCode).replace(/\D/g, '').length !== 6}
                    testID="verify-email-code-button"
                  />
                  <AuthButton
                    colors={authColors}
                    title="Back to email sign-in"
                    variant="outline"
                    onPress={startSignin}
                    testID="back-to-email-sign-in"
                  />
                </View>
              )
            ) : phoneStep === 'phone' ? (
              <View style={{ gap: 13 }}>
                <View style={{ gap: 7 }}>
                  <Text style={{ color: authColors.foreground, fontSize: 13, fontWeight: '700' }}>Mobile number</Text>
                  <View style={{
                    minHeight: 52,
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderWidth: 1,
                    borderColor: authColors.border,
                    borderRadius: 12,
                    backgroundColor: '#FFFFFF',
                    overflow: 'hidden',
                  }}>
                    <View
                      accessibilityLabel="Bangladesh, plus 88"
                      style={{
                        minHeight: 50,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 7,
                        paddingHorizontal: 13,
                        backgroundColor: '#F0F4F8',
                        borderRightWidth: 1,
                        borderRightColor: authColors.border,
                      }}
                    >
                      <Text style={{ fontSize: 17 }}>🇧🇩</Text>
                      <Text style={{ color: authColors.foreground, fontSize: 15, fontWeight: '700' }}>+88</Text>
                    </View>
                    <TextInput
                      value={phone}
                      onChangeText={updatePhone}
                      placeholder="01XXXXXXXXX"
                      placeholderTextColor={authColors.mutedForeground}
                      keyboardType="phone-pad"
                      maxLength={11}
                      testID="sign-in-phone"
                      accessibilityLabel="Bangladesh mobile number"
                      style={{ flex: 1, minHeight: 50, paddingHorizontal: 14, color: authColors.foreground, fontSize: 16 }}
                    />
                  </View>
                </View>
                <Text style={{ color: authColors.mutedForeground, fontSize: 12, lineHeight: 18 }}>
                  Enter your 11-digit Bangladesh mobile number, starting with 01.
                </Text>
                <AuthButton
                  colors={authColors}
                  title="Send code"
                  onPress={() => { void sendPhoneCode(); }}
                  loading={sendMutation.isPending}
                  disabled={!isPhoneValid}
                  testID="send-otp-button"
                />
              </View>
            ) : (
              <View style={{ gap: 14 }}>
                <AuthField
                  colors={authColors}
                  label="6-digit code"
                  value={phoneCode}
                  onChangeText={(value) => setPhoneCode(toAsciiDigits(value).replace(/\D/g, '').slice(0, 6))}
                  testID="sign-in-code"
                  placeholder="••••••"
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  maxLength={6}
                />
                <AuthButton
                  colors={authColors}
                  title="Verify and sign in"
                  onPress={() => { void verifyPhoneCode(); }}
                  loading={verifyMutation.isPending}
                  disabled={toAsciiDigits(phoneCode).replace(/\D/g, '').length !== 6}
                  testID="verify-otp-button"
                />
                <AuthButton
                  colors={authColors}
                  title="Use another number"
                  variant="outline"
                  onPress={() => { setPhoneStep('phone'); setPhoneCode(''); clearMessages(); }}
                  testID="change-phone-button"
                />
                <AuthButton
                  colors={authColors}
                  title="Resend code"
                  variant="outline"
                  onPress={() => { void sendPhoneCode(); }}
                  loading={sendMutation.isPending}
                  disabled={sendMutation.isPending}
                  testID="resend-otp-button"
                />
              </View>
            )}

            <Text style={{ color: authColors.mutedForeground, fontSize: 11, lineHeight: 17, textAlign: 'center' }}>
              Your details are used only to sign in and protect your account.
            </Text>
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>
    </LinearGradient>
  );
}