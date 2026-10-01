import React, { useState } from 'react';
import { Image, Platform, Text, View } from 'react-native';
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

  const sendCode = async () => {
    setError('');
    setNotice('');
    try {
      await sendMutation.mutateAsync({ data: { phone: phone.trim() } });
      setStep('code');
      setNotice(`কোড পাঠানো হয়েছে ${phone.trim()} নম্বরে। ১০ মিনিটের মধ্যে কোডটি ব্যবহার করুন।`);
    } catch (requestError) {
      setError(errorMessage(requestError, 'কোড পাঠানো যায়নি। নম্বরটি দেখে আবার চেষ্টা করুন।'));
    }
  };

  const verifyCode = async () => {
    setError('');
    try {
      const session = await verifyMutation.mutateAsync({
        data: { phone: phone.trim(), code: code.replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6)).trim() },
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
            <Field
              label="মোবাইল নম্বর"
              value={phone}
              onChangeText={setPhone}
              placeholder="01XXXXXXXXX"
              keyboardType="phone-pad"
              testID="sign-in-phone"
            />
            <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 20 }}>
              নতুন নম্বর হলে যাচাইয়ের পর আপনার খাতা তৈরি হবে। বাংলাদেশি নম্বর লিখুন।
            </Text>
            <AppButton
              title="এসএমএস কোড পাঠান"
              icon="message-circle"
              onPress={() => { void sendCode(); }}
              loading={sendMutation.isPending}
              disabled={phone.replace(/\D/g, '').length < 10}
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