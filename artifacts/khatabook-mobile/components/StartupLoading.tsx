import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { reloadAppAsync } from 'expo';
import { useColors } from '@/hooks/useColors';

export function StartupLoading({ message = 'বাংলাখাতা চালু হচ্ছে…' }: { message?: string }) {
  const colors = useColors();
  const [isSlow, setIsSlow] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsSlow(true), 12_000);
    return () => clearTimeout(timer);
  }, []);

  const retry = async () => {
    setRetryFailed(false);
    try {
      await reloadAppAsync();
    } catch {
      setRetryFailed(true);
    }
  };

  return (
    <View
      testID="app-startup-loading"
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.message, { color: colors.mutedForeground }]}>
        {message}
      </Text>
      {isSlow && (
        <>
          <Text style={[styles.help, { color: colors.mutedForeground }]}>
            অ্যাপ চালু হতে বেশি সময় লাগছে। ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।
          </Text>
          {retryFailed && (
            <Text style={[styles.help, { color: colors.destructive }]}>
              অ্যাপ আবার চালু করা যায়নি। কিছুক্ষণ পরে আবার চেষ্টা করুন।
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            testID="retry-app-startup"
            onPress={() => void retry()}
            style={[styles.retry, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.retryLabel, { color: colors.primaryForeground }]}>
              আবার চেষ্টা করুন
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  message: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    textAlign: 'center',
  },
  help: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  retry: {
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  retryLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
});