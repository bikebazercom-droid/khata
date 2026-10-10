import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { setBaseUrl, setExtraHeaders } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthProvider } from '@/contexts/AuthContext';
import { BusinessScopeProvider } from '@/contexts/BusinessScopeContext';
import { BusinessSwitcherModal } from '@/components/BusinessSwitcherModal';
import { resolveMobileStartupConfig } from '@/lib/startupConfig';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';

SplashScreen.preventAutoHideAsync();

const { apiBaseUrl, clerkPublishableKey } = resolveMobileStartupConfig({
  apiDomain: process.env.EXPO_PUBLIC_DOMAIN,
  clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
});
setBaseUrl(apiBaseUrl);
setExtraHeaders({ 'x-client-platform': Platform.OS === 'web' ? 'web' : 'mobile' });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

function RootLayoutNav({ nativeRuntimeReady }: { nativeRuntimeReady: boolean }) {
  const nativeScreens = nativeRuntimeReady
    ? [
        <Stack.Screen key="sign-in" name="sign-in" options={{ gestureEnabled: false }} />,
        <Stack.Screen key="tabs" name="(tabs)" options={{ headerShown: false }} />,
        <Stack.Screen key="access" name="access" />,
        <Stack.Screen key="party-new" name="party/new" options={{ presentation: 'modal' }} />,
        <Stack.Screen key="party-detail" name="party/[partyId]" />,
        <Stack.Screen key="party-report" name="party/[partyId]/report" />,
        <Stack.Screen key="reports" name="reports" />,
        <Stack.Screen key="entry-new" name="entry/new" options={{ presentation: 'modal' }} />,
        <Stack.Screen key="entry-detail" name="entry/[entryId]" options={{ presentation: 'modal' }} />,
      ]
    : [];

  return (
    <>
      <Stack screenOptions={{ headerShown: false, headerBackTitle: 'Back' }}>
        <Stack.Screen name="index" />
        {nativeScreens}
      </Stack>
      {nativeRuntimeReady ? <BusinessSwitcherModal /> : null}
    </>
  );
}

export default function RootLayout() {
  useEffect(() => {
    // The actual app UI is the cached web application inside WebView. Do not
    // keep the native launch screen up while waiting for optional fonts or
    // network-dependent web content.
    void SplashScreen.hideAsync();
  }, []);

  const nativeRuntimeReady = Boolean(apiBaseUrl && clerkPublishableKey);
  const app = nativeRuntimeReady && clerkPublishableKey ? (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      tokenCache={tokenCache}
      proxyUrl={process.env.EXPO_PUBLIC_CLERK_PROXY_URL}
    >
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BusinessScopeProvider>
            <RootLayoutNav nativeRuntimeReady />
          </BusinessScopeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ClerkProvider>
  ) : (
    <RootLayoutNav nativeRuntimeReady={false} />
  );

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <KeyboardProvider>
            <StatusBar style="auto" />
            {app}
          </KeyboardProvider>
        </GestureHandlerRootView>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
