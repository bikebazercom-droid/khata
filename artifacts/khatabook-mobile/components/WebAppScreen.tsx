import React, { createElement, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
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
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useColors } from '@/hooks/useColors';
import { getWebAppUrl, resolveWebAppStartUrl } from '@/lib/webAppUrl';
import { resolveVisualFixtureUrl } from '@/lib/visualFixtureUrl';
import { useTransactionSuccessSound } from '@/lib/useTransactionSuccessSound';
import { useOptionalAuth } from '@/contexts/AuthContext';
import {
  NATIVE_FILE_EXPORT_RESULT_EVENT,
  parseNativeFileExportRequest,
  shareNativeWebViewFile,
  type NativeFileExportResult,
} from '@/lib/nativeFileExport';

const NATIVE_PUSH_TOKEN_EVENT = 'banglakhata-native-push-token';
const NATIVE_PUSH_STATUS_EVENT = 'banglakhata-native-push-status';
const OPEN_NOTIFICATION_EVENT = 'banglakhata-open-notification';
const NATIVE_AUTH_READY_MESSAGE = 'banglakhata-native-auth-ready';
const NATIVE_AUTH_REJECTED_MESSAGE = 'banglakhata-native-auth-rejected';
const NATIVE_AUTH_LOGOUT_MESSAGE = 'banglakhata-native-auth-logout';

function createNativeAuthBootstrapScript(token: string): string {
  return `(() => {
    const nativeToken = ${JSON.stringify(token)};
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const request = fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Authorization: 'Bearer ' + nativeToken,
        'x-banglakhata-native-session': '1',
        'x-client-platform': 'mobile'
      },
      signal: controller.signal
    }).then(async (response) => {
      if (!response.ok) return { ok: false, status: response.status };
      return { ok: true, status: response.status, data: await response.json() };
    }).catch(() => ({ ok: false, status: 0 })).finally(() => clearTimeout(timeout));
    Object.defineProperty(window, '__BKH_NATIVE_AUTH_BOOTSTRAP__', {
      value: request,
      configurable: true
    });
  })(); true;`;
}

type PushNavigationData = {
  notificationId: string;
  businessId: string;
  partyId: string | null;
};

function isBrowserUrl(url: string) {
  return /^(https?:|about:|blob:|data:)/i.test(url);
}

function hasSameOrigin(url: string, expectedUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(expectedUrl).origin;
  } catch {
    return false;
  }
}

export function WebAppScreen() {
  const colors = useColors();
  const nativeAuth = useOptionalAuth();
  const initialNativeSessionCaptured = useRef(false);
  const playSuccessSound = useTransactionSuccessSound();
  const webAppUrl = resolveVisualFixtureUrl(
    getWebAppUrl(),
    Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.search : '',
    Platform.OS,
    process.env.NODE_ENV !== 'production',
  );
  const [nativeAuthReady, setNativeAuthReady] = useState(Platform.OS === 'web');
  const [nativeAuthToken, setNativeAuthToken] = useState<string | null>(null);
  const [nativeSessionAtStart, setNativeSessionAtStart] = useState(false);
  const [nativeAuthError, setNativeAuthError] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const pendingPushNavigation = useRef<PushNavigationData | null>(null);
  const handledNotificationResponses = useRef(new Set<string>());
  const webPageReady = useRef(false);
  const [retryKey, setRetryKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web' || initialNativeSessionCaptured.current) return;
    if (!nativeAuth) {
      initialNativeSessionCaptured.current = true;
      setNativeAuthReady(true);
      return;
    }
    if (!nativeAuth.ready) return;

    let active = true;
    void (async () => {
      const hasSession = nativeAuth.hasSession;
      try {
        const token = hasSession ? await nativeAuth.getApiToken() : null;
        if (!active) return;
        initialNativeSessionCaptured.current = true;
        setNativeAuthToken(token);
        setNativeSessionAtStart(!!token);
        setNativeAuthError(hasSession && !token);
      } catch {
        if (!active) return;
        initialNativeSessionCaptured.current = true;
        setNativeAuthError(hasSession);
      } finally {
        if (active) setNativeAuthReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [nativeAuth?.ready, nativeAuth?.hasSession, nativeAuth?.getApiToken]);

  const retryNativeAuth = useCallback(async () => {
    setNativeAuthReady(false);
    setNativeAuthError(false);
    try {
      const hasSession = nativeAuth?.hasSession ?? false;
      const token = hasSession ? await nativeAuth?.getApiToken() ?? null : null;
      setNativeAuthToken(token);
      setNativeSessionAtStart(!!token);
      setNativeAuthError(hasSession && !token);
    } catch {
      setNativeAuthError(true);
    } finally {
      setNativeAuthReady(true);
      setRetryKey((key) => key + 1);
    }
  }, [nativeAuth]);

  const handleLoadStart = useCallback(() => {
    webPageReady.current = false;
    setLoading(true);
    setLoadFailed(false);
  }, []);

  const sendPushStatusToWeb = useCallback((status: string) => {
    const script = `window.dispatchEvent(new CustomEvent(${JSON.stringify(NATIVE_PUSH_STATUS_EVENT)}, { detail: ${JSON.stringify({ status })} })); true;`;
    webViewRef.current?.injectJavaScript(script);
  }, []);

  const sendPendingPushNavigation = useCallback(() => {
    const payload = pendingPushNavigation.current;
    if (!payload || !webPageReady.current || !webViewRef.current) return;

    const script = `window.dispatchEvent(new CustomEvent(${JSON.stringify(OPEN_NOTIFICATION_EVENT)}, { detail: ${JSON.stringify(payload)} })); true;`;
    webViewRef.current.injectJavaScript(script);
    pendingPushNavigation.current = null;
    void Notifications.clearLastNotificationResponseAsync().catch(() => {});
  }, []);

  const requestOwnerPushToken = useCallback(async (allowPrompt: boolean) => {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
      if (allowPrompt) sendPushStatusToWeb('unavailable');
      return;
    }

    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('ledger-alerts', {
          name: 'Ledger alerts',
          importance: Notifications.AndroidImportance.MAX,
          sound: 'default',
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#1B3A6B',
        });
      }

      let permission = await Notifications.getPermissionsAsync();
      if (!permission.granted && allowPrompt) {
        permission = await Notifications.requestPermissionsAsync();
      }
      if (!permission.granted) {
        sendPushStatusToWeb(allowPrompt ? 'permission-denied' : 'not-enabled');
        if (allowPrompt && !permission.canAskAgain) {
          Alert.alert(
            'বিজ্ঞপ্তি বন্ধ আছে',
            'ফোনের সেটিংস থেকে BanglaKhata বিজ্ঞপ্তির অনুমতি চালু করুন।',
            [
              { text: 'এখন নয়', style: 'cancel' },
              { text: 'সেটিংস খুলুন', onPress: () => { void Linking.openSettings(); } },
            ],
          );
        }
        return;
      }

      const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
      if (!projectId) {
        sendPushStatusToWeb(allowPrompt ? 'unavailable' : 'not-enabled');
        return;
      }

      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      const script = `window.dispatchEvent(new CustomEvent(${JSON.stringify(NATIVE_PUSH_TOKEN_EVENT)}, { detail: ${JSON.stringify({ token: token.data, platform })} })); true;`;
      webViewRef.current?.injectJavaScript(script);
      sendPushStatusToWeb('granted');
    } catch (error) {
      console.warn('Could not register owner push notifications:', error);
      sendPushStatusToWeb(allowPrompt ? 'unavailable' : 'not-enabled');
    }
  }, [sendPushStatusToWeb]);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    const handleNotificationResponse = (response: Notifications.NotificationResponse) => {
      const requestId = response.notification.request.identifier;
      if (handledNotificationResponses.current.has(requestId)) return;
      handledNotificationResponses.current.add(requestId);

      const data = response.notification.request.content.data as Record<string, unknown>;
      if (
        data.type !== 'staff-ledger-entry' ||
        typeof data.notificationId !== 'string' ||
        typeof data.businessId !== 'string'
      ) {
        void Notifications.clearLastNotificationResponseAsync().catch(() => {});
        return;
      }

      pendingPushNavigation.current = {
        notificationId: data.notificationId,
        businessId: data.businessId,
        partyId: typeof data.partyId === 'string' ? data.partyId : null,
      };
      sendPendingPushNavigation();
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handleNotificationResponse(response);
    });
    return () => subscription.remove();
  }, [sendPendingPushNavigation]);

  const handleLoadComplete = useCallback(() => {
    setLoading(false);
    setLoadFailed(false);
  }, []);

  const handleLoadFailure = useCallback(() => {
    setLoading(false);
    setLoadFailed(true);
  }, []);

  useEffect(() => {
    if (!loading) return undefined;

    const timeout = setTimeout(handleLoadFailure, 30_000);
    return () => clearTimeout(timeout);
  }, [handleLoadFailure, loading, retryKey]);

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
    if (nativeAuthToken && !hasSameOrigin(request.url, webAppUrl ?? '')) {
      if (/^https?:/i.test(request.url)) {
        void Linking.openURL(request.url).catch(() => setLoadFailed(true));
      }
      return false;
    }
    if (isBrowserUrl(request.url)) return true;

    void Linking.openURL(request.url).catch(() => {
      setLoadFailed(true);
    });
    return false;
  }, [nativeAuthToken, webAppUrl]);

  const handleOpenWindow = useCallback((event: { nativeEvent: { targetUrl: string } }) => {
    const targetUrl = event.nativeEvent.targetUrl;
    if (!targetUrl) return;

    if (isBrowserUrl(targetUrl)) {
      if (nativeAuthToken && !hasSameOrigin(targetUrl, webAppUrl ?? '')) {
        void Linking.openURL(targetUrl).catch(() => setLoadFailed(true));
        return;
      }
      webViewRef.current?.injectJavaScript(
        `window.location.href = ${JSON.stringify(targetUrl)}; true;`,
      );
      return;
    }

    void Linking.openURL(targetUrl).catch(() => {
      setLoadFailed(true);
    });
  }, [nativeAuthToken, webAppUrl]);

  const handleNavigationStateChange = useCallback((state: WebViewNavigation) => {
    setCanGoBack(state.canGoBack);
  }, []);

  const handleWebViewMessage = useCallback((event: {
    nativeEvent: { data: string; url?: string };
  }) => {
    const request = parseNativeFileExportRequest(event.nativeEvent.data);
    if (request) {
      const sourceUrl = event.nativeEvent.url;
      if (!webAppUrl || (sourceUrl && !hasSameOrigin(sourceUrl, webAppUrl))) return;

      const sendResult = (result: NativeFileExportResult) => {
        const script = `window.dispatchEvent(new CustomEvent(${JSON.stringify(NATIVE_FILE_EXPORT_RESULT_EVENT)}, { detail: ${JSON.stringify(result)} })); true;`;
        webViewRef.current?.injectJavaScript(script);
      };

      void shareNativeWebViewFile(request).then(
        ({ copiedText }) => sendResult({
          type: request.type,
          requestId: request.requestId,
          ok: true,
          copiedText,
        }),
        (error: unknown) => {
          console.error('WebView file export failed:', error);
          sendResult({
            type: request.type,
            requestId: request.requestId,
            ok: false,
            error: 'ফাইল তৈরি বা শেয়ার করা যায়নি। আবার চেষ্টা করুন।',
          });
        },
      );
      return;
    }

    let pushMessage: { type?: string } | null = null;
    try {
      pushMessage = JSON.parse(event.nativeEvent.data) as { type?: string };
    } catch {
      // Existing sound messages are plain strings rather than JSON.
    }
    if (
      pushMessage?.type === NATIVE_AUTH_READY_MESSAGE
      || pushMessage?.type === NATIVE_AUTH_REJECTED_MESSAGE
      || pushMessage?.type === NATIVE_AUTH_LOGOUT_MESSAGE
    ) {
      const sourceUrl = event.nativeEvent.url;
      if (!webAppUrl || !sourceUrl || !hasSameOrigin(sourceUrl, webAppUrl)) return;
      setNativeAuthToken(null);
      if (pushMessage.type !== NATIVE_AUTH_READY_MESSAGE) {
        void nativeAuth?.clearNativeSession().catch(() => {});
      }
      return;
    }
    if (pushMessage?.type === 'banglakhata-web-ready' || pushMessage?.type === 'banglakhata-enable-push') {
      const sourceUrl = event.nativeEvent.url;
      if (!webAppUrl || (sourceUrl && !hasSameOrigin(sourceUrl, webAppUrl))) return;
      if (pushMessage.type === 'banglakhata-web-ready') {
        webPageReady.current = true;
        sendPendingPushNavigation();
        void requestOwnerPushToken(false);
      } else {
        void requestOwnerPushToken(true);
      }
      return;
    }

    if (event.nativeEvent.data === 'transaction-success') {
      playSuccessSound();
    }
  }, [
    nativeAuth?.clearNativeSession,
    playSuccessSound,
    requestOwnerPushToken,
    sendPendingPushNavigation,
    webAppUrl,
  ]);

  const initialUrl = webAppUrl
    ? resolveWebAppStartUrl(webAppUrl, nativeSessionAtStart)
    : null;

  if (!nativeAuthReady) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
        <View style={styles.message}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            সাইন-ইন যাচাই করে বাংলাখাতা খোলা হচ্ছে…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (nativeAuthError) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
        <View style={styles.message}>
          <Text style={[styles.title, { color: colors.foreground }]}>সাইন-ইন যাচাই করা যায়নি</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => { void retryNativeAuth(); }}
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>আবার চেষ্টা করুন</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

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
      onLoad: handleLoadComplete,
      onError: handleLoadFailure,
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
        source={{ uri: initialUrl ?? webAppUrl }}
        style={styles.webView}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        originWhitelist={['*']}
        javaScriptEnabled
        javaScriptCanOpenWindowsAutomatically
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        injectedJavaScriptBeforeContentLoaded={nativeAuthToken
          ? createNativeAuthBootstrapScript(nativeAuthToken)
          : undefined}
        setSupportMultipleWindows={false}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        allowsBackForwardNavigationGestures
        onLoadStart={handleLoadStart}
        onLoad={handleLoadComplete}
        onLoadProgress={({ nativeEvent }) => {
          if (nativeEvent.progress >= 1) handleLoadComplete();
        }}
        onLoadEnd={() => setLoading(false)}
        onError={handleLoadFailure}
        onRenderProcessGone={handleLoadFailure}
        onNavigationStateChange={handleNavigationStateChange}
        onShouldStartLoadWithRequest={handleNavigationRequest}
        onOpenWindow={handleOpenWindow}
        onMessage={handleWebViewMessage}
      />
    );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {websiteView}

      {loading && !loadFailed && (
        <View
          pointerEvents="none"
          style={[styles.loadingOverlay, { backgroundColor: colors.background }]}
        >
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            বাংলাখাতা খোলা হচ্ছে… অ্যাপ না খুললে কিছুক্ষণ পর আবার চেষ্টা করুন।
          </Text>
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
    </View>
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