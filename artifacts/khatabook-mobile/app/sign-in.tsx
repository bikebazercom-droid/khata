import React, { useState } from 'react';
import { Image, Platform, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSendPhoneOtp, useVerifyPhoneOtp } from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { AppButton, Field, Notice } from '@/components/Kit';
import { useAuth } from '@/contexts/AuthContext';
import { errorMessage } from '@/lib/domain';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { acceptSession } = useAuth();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const sendMutation = useSendPhoneOtp();
  const verifyMutation = useVerifyPhoneOtp();
  const normalizedPhone = `+880${phone}`;
  const isPhoneValid = /^1[3-9]\d{8}$/.test(phone);

  const updatePhone = (value: string) => {
    let digits = value
      .replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6))
      .replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    setPhone(digits.slice(0, 10));
  };

  const sendCode = async () => {
    setError('');
    setNotice('');
    try {
      await sendMutation.mutateAsync({ data: { phone: normalizedPhone } });
      setStep('code');
      setNotice(`কোড পাঠানো হয়েছে ${normalizedPhone} নম্বরে। ১০ মিনিটের মধ্যে কোডটি ব্যবহার করুন।`);
    } catch (requestError) {
      setError(errorMessage(requestError, 'কোড পাঠানো যায়নি। নম্বরটি দেখে আবার চেষ্টা করুন।'));
    }
  };

  const verifyCode = async () => {
    setError('');
    try {
      const session = await verifyMutation.mutateAsync({
        data: { phone: normalizedPhone, code: code.replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6)).trim() },
      });
      await acceptSession(session);
      router.replace('/');
    } catch (requestError) {
      setError(errorMessage(requestError, 'কোডটি সঠিক নয় বা মেয়াদ শেষ হয়েছে।'));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 24,
          paddingTop: Platform.OS === 'web' ? 67 : insets.top + 28,
          paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 28,
          justifyContent: 'center',
          gap: 20,
        }}
        bottomOffset={80}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <Image source={require('../assets/images/brand-icon.png')} style={{ width: 76, height: 76, borderRadius: 20 }} accessibilityLabel="BanglaKhata" />
          <Text style={{ color: colors.foreground, fontSize: 28, fontWeight: '800', textAlign: 'center' }}>বাংলাখাতা</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 15, textAlign: 'center', lineHeight: 22 }}>
            ফোন নম্বর দিয়ে সাইন ইন করুন{'\n'}আপনার খাতা নিরাপদে খুলুন
          </Text>
        </View>

        {error ? <Notice message={error} /> : null}
        {notice ? <Notice message={notice} tone="info" /> : null}

        {step === 'phone' ? (
          <>
            <View style={{ gap: 7 }}>
              <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '700' }}>মোবাইল নম্বর</Text>
              <View style={{
                minHeight: 52,
                flexDirection: 'row',
                alignItems: 'center',
                borderWidth: 1,
                borderColor: colors.input,
                borderRadius: 10,
                backgroundColor: colors.card,
                overflow: 'hidden',
              }}>
                <View accessibilityLabel="বাংলাদেশ, +৮৮০" style={{
                  minHeight: 50,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 7,
                  paddingHorizontal: 13,
                  backgroundColor: colors.secondary,
                  borderRightWidth: 1,
                  borderRightColor: colors.border,
                }}>
                  <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '800' }}>BD</Text>
                  <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '700' }}>+880</Text>
                </View>
                <TextInput
                  value={phone}
                  onChangeText={updatePhone}
                  placeholder="1XXXXXXXXX"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="phone-pad"
                  maxLength={11}
                  testID="sign-in-phone"
                  accessibilityLabel="বাংলাদেশি মোবাইল নম্বর"
                  style={{ flex: 1, minHeight: 50, paddingHorizontal: 14, color: colors.foreground, fontSize: 16 }}
                />
              </View>
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 20 }}>
              +৮৮০-এর পর ১০ সংখ্যার নম্বর লিখুন—শুরুর ০ ছাড়া। নতুন নম্বর হলে যাচাইয়ের পর আপনার খাতা তৈরি হবে।
            </Text>
            <AppButton
              title="এসএমএস কোড পাঠান"
              icon="message-circle"
              onPress={() => { void sendCode(); }}
              loading={sendMutation.isPending}
              disabled={!isPhoneValid}
              testID="send-otp-button"
            />
          </>
        ) : (
          <>
            <Field
              label="৬ সংখ্যার কোড"
              value={code}
              onChangeText={(value) => setCode(value.replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6)).replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              keyboardType="number-pad"
              maxLength={6}
              testID="sign-in-code"
            />
            <AppButton
              title="যাচাই করে সাইন ইন"
              icon="arrow-right"
              onPress={() => { void verifyCode(); }}
              loading={verifyMutation.isPending}
              disabled={code.replace(/\D/g, '').length !== 6}
              testID="verify-otp-button"
            />
            <AppButton title="অন্য নম্বর ব্যবহার করুন" variant="outline" onPress={() => { setStep('phone'); setCode(''); setError(''); setNotice(''); }} />
            <AppButton
              title="কোড আবার পাঠান"
              variant="secondary"
              onPress={() => { void sendCode(); }}
              loading={sendMutation.isPending}
              disabled={sendMutation.isPending}
            />
          </>
        )}
        <Text style={{ textAlign: 'center', color: colors.mutedForeground, fontSize: 12 }}>
          আপনার নম্বরটি শুধু সাইন-ইন ও অ্যাকাউন্ট যাচাইয়ের জন্য ব্যবহৃত হবে।
        </Text>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}