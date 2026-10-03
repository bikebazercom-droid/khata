import React, { createElement, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView, { type WebViewNavigation } from 'react-native-webview';
import { useColors } from '@/hooks/useColors';
import { getWebAppUrl } from '@/lib/webAppUrl';

function isBrowserUrl(url: string) {
  return /^(https?:|about:|blob:|data:)/i.test(url);
}

export function WebAppScreen() {
  const colors = useColors();
  const webAppUrl = getWebAppUrl();
  const webViewRef = useRef<WebView>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack || loadFailed) return false;
      webViewRef.current?.goBack();
      return true;
    });

    return () => subscription.remove();
  }, [canGoBack, loadFailed]);

  const handleNavigationRequest = useCallback((request: { url: string }) => {
    if (isBrowserUrl(request.url)) return true;

    void Linking.openURL(request.url).catch(() => {
      setLoadFailed(true);
    });
    return false;
  }, []);

  const handleOpenWindow = useCallback((event: { nativeEvent: { targetUrl: string } }) => {
    const targetUrl = event.nativeEvent.targetUrl;
    if (!targetUrl) return;

    if (isBrowserUrl(targetUrl)) {
      webViewRef.current?.injectJavaScript(
        `window.location.href = ${JSON.stringify(targetUrl)}; true;`,
      );
      return;
    }

    void Linking.openURL(targetUrl).catch(() => {
      setLoadFailed(true);
    });
  }, []);

  const handleNavigationStateChange = useCallback((state: WebViewNavigation) => {
    setCanGoBack(state.canGoBack);
  }, []);

  if (!webAppUrl) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
        <View style={styles.message}>
          <Text style={[styles.title, { color: colors.foreground }]}>ওয়েবসাইটের ঠিকানা পাওয়া যায়নি</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            EXPO_PUBLIC_DOMAIN বা EXPO_PUBLIC_WEB_APP_URL সেট করে আবার চেষ্টা করুন।
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const websiteView = Platform.OS === 'web'
    ? createElement('iframe', {
      key: retryKey,
      src: webAppUrl,
      title: 'BanglaKhata',
      allow: 'camera; clipboard-read; clipboard-write',
      onLoad: () => setLoading(false),
      onError: () => {
        setLoading(false);
        setLoadFailed(true);
      },
      style: {
        border: 0,
        display: 'block',
        height: '100%',
        width: '100%',
      },
    })
    : (
      <WebView
        key={retryKey}
        ref={webViewRef}
        source={{ uri: webAppUrl }}
        style={styles.webView}
        originWhitelist={['*']}
        javaScriptEnabled
        javaScriptCanOpenWindowsAutomatically
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures
        onLoadStart={() => {
          setLoading(true);
          setLoadFailed(false);
        }}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setLoadFailed(true);
        }}
        onNavigationStateChange={handleNavigationStateChange}
        onShouldStartLoadWithRequest={handleNavigationRequest}
        onOpenWindow={handleOpenWindow}
      />
    );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      {websiteView}

      {loading && !loadFailed && (
        <View
          pointerEvents="none"
          style={[styles.loadingOverlay, { backgroundColor: colors.background }]}
        >
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.body, { color: colors.mutedForeground }]}>বাংলাখাতা খোলা হচ্ছে…</Text>
        </View>
      )}

      {loadFailed && (
        <View style={[styles.errorOverlay, { backgroundColor: colors.background }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>ওয়েবসাইট খোলা যায়নি</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setLoadFailed(false);
              setLoading(true);
              setCanGoBack(false);
              setRetryKey((key) => key + 1);
            }}
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            testID="web-app-retry"
          >
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>আবার চেষ্টা করুন</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  message: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    marginTop: 14,
  },
  retryText: {
    fontSize: 15,
    fontWeight: '700',
  },
});