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
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';

SplashScreen.preventAutoHideAsync();

const apiDomain = process.env.EXPO_PUBLIC_DOMAIN;
if (!apiDomain) throw new Error('EXPO_PUBLIC_DOMAIN is required to connect BanglaKhata Mobile to the API.');
setBaseUrl(`https://${apiDomain}`);
setExtraHeaders({ 'x-client-platform': Platform.OS === 'web' ? 'web' : 'mobile' });
const clerkPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
if (!clerkPublishableKey) throw new Error('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required for Email and Google sign-in.');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

function RootLayoutNav() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false, headerBackTitle: 'Back' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="sign-in" options={{ gestureEnabled: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="access" />
        <Stack.Screen name="party/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="party/[partyId]" />
        <Stack.Screen name="party/[partyId]/report" />
        <Stack.Screen name="reports" />
        <Stack.Screen name="entry/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="entry/[entryId]" options={{ presentation: 'modal' }} />
      </Stack>
      <BusinessSwitcherModal />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <ClerkProvider
          publishableKey={clerkPublishableKey}
          tokenCache={tokenCache}
          proxyUrl={process.env.EXPO_PUBLIC_CLERK_PROXY_URL}
        >
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <BusinessScopeProvider>
                <GestureHandlerRootView style={{ flex: 1 }}>
                  <KeyboardProvider>
                    <StatusBar style="auto" />
                    <RootLayoutNav />
                  </KeyboardProvider>
                </GestureHandlerRootView>
              </BusinessScopeProvider>
            </AuthProvider>
          </QueryClientProvider>
        </ClerkProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
