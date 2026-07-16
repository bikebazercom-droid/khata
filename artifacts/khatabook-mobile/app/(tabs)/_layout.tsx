import React, { useEffect } from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Redirect, Tabs } from 'expo-router';
import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import * as SecureStore from 'expo-secure-store';

// iOS 26+: NativeTabs with liquid glass (system-level, no custom tokens)
function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <Label>Home</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="parties">
        <Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
        <Label>Parties</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <Icon sf={{ default: 'gear', selected: 'gear' }} />
        <Label>Settings</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: isIOS ? 'transparent' : colors.background,
          borderTopWidth: isWeb ? 1 : StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.background },
              ]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="house" tintColor={color} size={24} />
            ) : (
              <Feather name="home" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="parties"
        options={{
          title: 'Parties',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person.2" tintColor={color} size={24} />
            ) : (
              <Feather name="users" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="gear" tintColor={color} size={24} />
            ) : (
              <Feather name="settings" size={22} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  const { isSignedIn, getToken, isLoaded } = useAuth();

  // Wire up auth token getter for API requests.
  // Checks Clerk token first, then falls back to stored phone session token.
  useEffect(() => {
    setAuthTokenGetter(async () => {
      // Try Clerk token first
      try {
        const clerkToken = await getToken();
        if (clerkToken) return clerkToken;
      } catch {
        // Clerk not signed in
      }
      // Fall back to phone OTP token stored in SecureStore
      try {
        const phoneToken = await SecureStore.getItemAsync('phone_session_token');
        if (phoneToken) return phoneToken;
      } catch {
        // SecureStore not available (e.g. web)
      }
      return null;
    });
  }, [getToken]);

  // Wait for Clerk to load before deciding where to send the user
  if (!isLoaded) return null;

  // Check if user is signed in via Clerk OR has a stored phone token
  // We redirect to sign-in if not authenticated via Clerk (phone auth
  // is checked in a separate effect; for simplicity, phone-authed users
  // go straight to tabs after their token is stored).
  if (!isSignedIn) {
    // Check for phone session asynchronously — if stored, allow through.
    // Since we can't await here, we use a wrapper component.
    return <PhoneAuthGate />;
  }

  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}

/**
 * Checks if a phone session token exists in SecureStore.
 * If yes, renders the tab layout. If no, redirects to sign-in.
 */
function PhoneAuthGate() {
  const [checked, setChecked] = React.useState(false);
  const [hasPhoneToken, setHasPhoneToken] = React.useState(false);

  useEffect(() => {
    SecureStore.getItemAsync('phone_session_token')
      .then((token) => {
        setHasPhoneToken(!!token);
        setChecked(true);
      })
      .catch(() => {
        setChecked(true);
        setHasPhoneToken(false);
      });
  }, []);

  if (!checked) return null;
  if (!hasPhoneToken) return <Redirect href="/(auth)/sign-in" />;

  if (isLiquidGlassAvailable()) return <NativeTabLayout />;
  return <ClassicTabLayout />;
}
