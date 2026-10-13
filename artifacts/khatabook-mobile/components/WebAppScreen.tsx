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
import type * as Notifications from 'expo-notifications';
import {
  getNativeContactsForWebView,
  NATIVE_CONTACTS_RESULT_EVENT,
  parseNativeContactsRequest,
  type NativeContactsResponse,
} from '@/lib/nativeContacts';
import { useColors } from '@/hooks/useColors';
import { getWebAppUrl, resolveWebAppStartUrl } from '@/lib/webAppUrl';
import { resolveVisualFixtureUrl } from '@/lib/visualFixtureUrl';
import { useTransactionSuccessSound } from '@/lib/useTransactionSuccessSound';
import { canUseNativeNotifications } from '@/lib/notificationRuntime';
import {
  createPushTokenEventScript,
  createPendingNotificationNavigationQueue,
  createStaffLedgerNavigationEventScript,
  createWebEventScript,
  NATIVE_PUSH_STATUS_EVENT,
  markNotificationResponseHandled,
  parseStaffLedgerNotificationResponse,
} from '@/lib/notificationBridge';
import { useOptionalAuth } from '@/contexts/AuthContext';
import {
  NATIVE_FILE_EXPORT_RESULT_EVENT,
  parseNativeFileExportRequest,
  shareNativeWebViewFile,
  type NativeFileExportResult,
} from '@/lib/nativeFileExport';

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
  const productionWebAppUrl = getWebAppUrl();
  const webAppUrl = resolveVisualFixtureUrl(
    productionWebAppUrl,
    Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.search : '',
    Platform.OS,
    process.env.NODE_ENV !== 'production',
  ) ?? productionWebAppUrl;
  const [nativeAuthReady, setNativeAuthReady] = useState(Platform.OS === 'web');
  const [nativeAuthToken, setNativeAuthToken] = useState<string | null>(null);
  const [nativeSessionAtStart, setNativeSessionAtStart] = useState(false);
  const [nativeAuthError, setNativeAuthError] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const pendingPushNavigation = useRef(createPendingNotificationNavigationQueue());
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

  useEffect(() => {
    if (!loading || loadFailed) return;
    // Keep the WebView alive for its service-worker/cache fallback, but never
    // leave a full-screen spinner covering cached ledger data indefinitely.
    const timer = setTimeout(() => setLoading(false), 4000);
    return () => clearTimeout(timer);
  }, [loading, loadFailed, retryKey]);

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
    webViewRef.current?.injectJavaScript(
      createWebEventScript(NATIVE_PUSH_STATUS_EVENT, { status }),
    );
  }, []);

  const sendPendingPushNavigation = useCallback(() => {
    if (!canUseNativeNotifications(Platform.OS, __DEV__)) return;
    const webView = webViewRef.current;
    const pending = pendingPushNavigation.current.takeWhenReady(
      webPageReady.current && Boolean(webView),
    );
    if (!pending || !webView) return;

    if (!markNotificationResponseHandled(pending.requestId)) {
      return;
    }

    webView.injectJavaScript(
      createStaffLedgerNavigationEventScript(pending.navigation),
    );
    void import('expo-notifications')
      .then(({ clearLastNotificationResponseAsync }) => clearLastNotificationResponseAsync())
      .catch(() => {});
  }, []);

  const requestOwnerPushToken = useCallback(async (allowPrompt: boolean) => {
    if (!canUseNativeNotifications(Platform.OS, __DEV__)) {
      sendPushStatusToWeb(allowPrompt ? 'unavailable' : 'not-enabled');
      return;
    }

    try {
      const NotificationsApi = await import('expo-notifications');
      if (Platform.OS === 'android') {
        await NotificationsApi.setNotificationChannelAsync('ledger-alerts', {
          name: 'Ledger alerts',
          importance: NotificationsApi.AndroidImportance.MAX,
          sound: 'default',
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#1B3A6B',
        });
      }

      let permission = await NotificationsApi.getPermissionsAsync();
      if (!permission.granted && allowPrompt) {
        permission = await NotificationsApi.requestPermissionsAsync();
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

      const token = await NotificationsApi.getExpoPushTokenAsync({ projectId });
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      if (!token.data || !webViewRef.current) {
        sendPushStatusToWeb(allowPrompt ? 'unavailable' : 'not-enabled');
        return;
      }
      webViewRef.current.injectJavaScript(createPushTokenEventScript(token.data, platform));
      sendPushStatusToWeb('granted');
    } catch (error) {
      console.warn('Could not register owner push notifications:', error);
      sendPushStatusToWeb(allowPrompt ? 'unavailable' : 'not-enabled');
    }
  }, [sendPushStatusToWeb]);

  useEffect(() => {
    if (!canUseNativeNotifications(Platform.OS, __DEV__)) return undefined;

    let isActive = true;
    let subscription: { remove: () => void } | undefined;

    void import('expo-notifications')
      .then(async (NotificationsApi) => {
        if (!isActive) return;

        NotificationsApi.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
          }),
        });

        const handleNotificationResponse = (response: Notifications.NotificationResponse) => {
          const parsed = parseStaffLedgerNotificationResponse(response);
          if (!parsed) {
            void NotificationsApi.clearLastNotificationResponseAsync().catch(() => {});
            return;
          }
          pendingPushNavigation.current.enqueue(parsed);
          sendPendingPushNavigation();
        };

        subscription = NotificationsApi.addNotificationResponseReceivedListener(
          handleNotificationResponse,
        );
        try {
          const response = await NotificationsApi.getLastNotificationResponseAsync();
          if (isActive && response) handleNotificationResponse(response);
        } catch (error) {
          console.warn('Could not read the last notification response:', error);
        }
      })
      .catch((error: unknown) => {
        console.warn('Native notifications are unavailable:', error);
      });

    return () => {
      isActive = false;
      subscription?.remove();
    };
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

    const contactsRequest = parseNativeContactsRequest(event.nativeEvent.data);
    if (contactsRequest) {
      const sourceUrl = event.nativeEvent.url;
      if (!webAppUrl || !sourceUrl || !hasSameOrigin(sourceUrl, webAppUrl)) return;

      const sendContactsResponse = (response: NativeContactsResponse) => {
        const script = `window.dispatchEvent(new CustomEvent(${JSON.stringify(NATIVE_CONTACTS_RESULT_EVENT)}, { detail: ${JSON.stringify(response)} })); true;`;
        webViewRef.current?.injectJavaScript(script);
      };

      void getNativeContactsForWebView().then(
        (result) => {
          if (!result.ok) {
            sendContactsResponse({
              requestId: contactsRequest.requestId,
              ok: false,
              complete: true,
              error: result.error,
            });
            return;
          }

          const contacts = result.contacts;
          const batchSize = 80;
          const batches = Math.max(1, Math.ceil(contacts.length / batchSize));
          for (let batchIndex = 0; batchIndex < batches; batchIndex += 1) {
            const start = batchIndex * batchSize;
            const batch = contacts.slice(start, start + batchSize);
            const response: NativeContactsResponse = {
              requestId: contactsRequest.requestId,
              ok: true,
              complete: batchIndex === batches - 1,
              contacts: batch,
            };
            const script = `window.dispatchEvent(new CustomEvent(${JSON.stringify(NATIVE_CONTACTS_RESULT_EVENT)}, { detail: ${JSON.stringify(response)} })); true;`;
            webViewRef.current?.injectJavaScript(script);
          }
        },
        (error: unknown) => {
          console.warn('Could not read device contacts:', error);
          sendContactsResponse({
            requestId: contactsRequest.requestId,
            ok: false,
            complete: true,
            error: 'ফোনের কন্টাক্ট পড়া যায়নি। আবার চেষ্টা করুন অথবা নাম দিয়ে ম্যানুয়ালি যোগ করুন।',
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

  const initialUrl = resolveWebAppStartUrl(nativeSessionAtStart);

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

  const websiteView = Platform.OS === 'web'
    ? createElement('iframe', {
      key: retryKey,
      src: initialUrl,
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
        source={{ uri: initialUrl }}
        style={styles.webView}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        originWhitelist={['*']}
        javaScriptEnabled
        javaScriptCanOpenWindowsAutomatically
        domStorageEnabled
        // Keep the platform's normal HTTP cache policy. LOAD_CACHE_ELSE_NETWORK
        // also affects API GETs and can hide successful writes behind stale list data.
        cacheEnabled
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