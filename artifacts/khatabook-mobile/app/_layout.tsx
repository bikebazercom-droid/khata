import 'react-native-get-random-values';
import { Buffer } from 'buffer';
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

import React, { useEffect } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Redirect, Stack, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ClerkProvider, ClerkLoaded, ClerkLoading, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { setBaseUrl } from '@workspace/api-client-react';
import { LanguageProvider } from '@/lib/i18n';
import { AuthRoleProvider, notifyMobileIdentityChanged, useAuthRole } from '@/lib/auth-role';
import { useColors } from '@/hooks/useColors';
import { LiveEntrySync } from '@/lib/use-live-entry-sync';
import { StartupLoading } from '@/components/StartupLoading';

// Set API base URL — Expo bundles run outside the web proxy and need an
// absolute URL. EXPO_PUBLIC_DOMAIN is injected by the dev script.
if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;
const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

function RootLayoutNav() {
  const segments = useSegments();
  const { isLoaded, isSignedIn } = useAuth();
  const { identity, loading, error, unauthorized } = useAuthRole();
  const isAccess = segments[0] === 'access';
  const isPartyDetail = segments[0] === 'party';
  const isReport = segments[0] === 'report';
  const needsIdentity = isAccess || isPartyDetail || isReport;

  if (needsIdentity) {
    if (!isLoaded || loading) return <StartupLoading />;
    if (unauthorized || (!isSignedIn && !identity)) {
      return <Redirect href="/(auth)/sign-in" />;
    }
    if (!identity) return <ProtectedRouteError message={error ?? 'অ্যাকাউন্টের অনুমতি যাচাই করা যায়নি।'} />;
    if (isAccess && identity.role !== 'owner') return <Redirect href="/(tabs)" />;
    if (isReport && identity.role === 'staff') return <Redirect href="/(tabs)" />;
  }

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="access" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen
        name="party/[id]"
        options={{ headerShown: false, presentation: 'card' }}
      />
      <Stack.Screen
        name="report/index"
        options={{ headerShown: false, presentation: 'card' }}
      />
      <Stack.Screen
        name="report/[id]"
        options={{ headerShown: false, presentation: 'card' }}
      />
    </Stack>
  );
}

function ProtectedRouteError({ message }: { message: string }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
      <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 16, textAlign: 'center' }}>
        অ্যাকাউন্টের অনুমতি যাচাই করা যায়নি
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', marginTop: 8 }}>
        {message}
      </Text>
      <TouchableOpacity
        testID="retry-protected-route-auth"
        onPress={notifyMobileIdentityChanged}
        style={{ marginTop: 20, paddingHorizontal: 18, paddingVertical: 12, borderRadius: colors.radius, backgroundColor: colors.primary }}
      >
        <Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }}>আবার চেষ্টা করুন</Text>
      </TouchableOpacity>
    </View>
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
    <ClerkProvider
      publishableKey={publishableKey}
      tokenCache={tokenCache}
      proxyUrl={proxyUrl}
    >
      <SafeAreaProvider>
        <ClerkLoading>
          <StartupLoading />
        </ClerkLoading>
        <ClerkLoaded>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <AuthRoleProvider>
                <LiveEntrySync />
                <LanguageProvider>
                  <GestureHandlerRootView style={{ flex: 1 }}>
                    <KeyboardProvider>
                      <RootLayoutNav />
                    </KeyboardProvider>
                  </GestureHandlerRootView>
                </LanguageProvider>
              </AuthRoleProvider>
            </QueryClientProvider>
          </ErrorBoundary>
        </ClerkLoaded>
      </SafeAreaProvider>
    </ClerkProvider>
  );
}
