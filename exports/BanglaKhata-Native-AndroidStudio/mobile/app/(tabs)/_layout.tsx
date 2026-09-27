import React, { useEffect } from 'react';
import { Platform, StyleSheet, useColorScheme, TouchableOpacity, View, Text } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Redirect, Tabs } from 'expo-router';
import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import { useLanguage } from '@/lib/i18n';
import * as SecureStore from 'expo-secure-store';
import { notifyMobileIdentityChanged, useAuthRole } from '@/lib/auth-role';

function AuthRoleFailure({ message }: { message: string }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
      <Feather name="alert-circle" size={32} color={colors.destructive} />
      <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 16, textAlign: 'center', marginTop: 12 }}>
        অ্যাকাউন্টের অনুমতি যাচাই করা যায়নি
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', marginTop: 8 }}>
        {message}
      </Text>
      <TouchableOpacity
        testID="retry-auth-role"
        onPress={notifyMobileIdentityChanged}
        style={{ marginTop: 20, paddingHorizontal: 18, paddingVertical: 12, borderRadius: colors.radius, backgroundColor: colors.primary }}
      >
        <Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }}>আবার চেষ্টা করুন</Text>
      </TouchableOpacity>
    </View>
  );
}

// iOS 26+: NativeTabs with liquid glass (system-level, no custom tokens)
function NativeTabLayout({ staff }: { staff: boolean }) {
  const { t } = useLanguage();
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
        <Label>{t('parties')}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <Icon sf={{ default: 'gear', selected: 'gear' }} />
        <Label>{t('settings')}</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout({ staff }: { staff: boolean }) {
  const { t } = useLanguage();
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
      {/* Left tab: Parties / পার্টিস (home/dashboard) */}
      <Tabs.Screen
        name="index"
        options={{
          title: t('parties'),
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person.2" tintColor={color} size={24} />
            ) : (
              <Feather name="users" size={22} color={color} />
            ),
        }}
      />
      {/* Middle slot: transparent spacer — route kept alive but tab hidden */}
      <Tabs.Screen
        name="parties"
        options={{
          title: '',
          tabBarButton: () => <View style={{ flex: 1 }} />,
          href: staff ? null : undefined,
        }}
      />
      {/* Right tab: Settings / সেটিংস */}
      <Tabs.Screen
        name="settings"
        options={{
          title: t('settings'),
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
  const { isSignedIn, isLoaded } = useAuth();
  const { identity, loading: roleLoading, error: roleError, unauthorized } = useAuthRole();

  // Wait for Clerk to load before deciding where to send the user.
  if (!isLoaded) return null;
  if (unauthorized) return <Redirect href="/(auth)/sign-in" />;

  // Check if user is signed in via Clerk OR has a stored phone token
  if (!isSignedIn) {
    return <PhoneAuthGate />;
  }

  if (roleLoading) return null;
  if (!identity) return <AuthRoleFailure message={roleError ?? 'আবার চেষ্টা করুন।'} />;

  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout staff={identity.role === 'staff'} />;
  }
  return <ClassicTabLayout staff={identity.role === 'staff'} />;
}

/**
 * Checks if a phone session token exists in SecureStore.
 * If yes, renders the tab layout. If no, redirects to sign-in.
 */
function PhoneAuthGate() {
  const { identity, loading: roleLoading, error: roleError, unauthorized } = useAuthRole();
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
  if (unauthorized) return <Redirect href="/(auth)/sign-in" />;

  if (roleLoading) return null;
  if (!identity) return <AuthRoleFailure message={roleError ?? 'আবার চেষ্টা করুন।'} />;
  if (isLiquidGlassAvailable()) return <NativeTabLayout staff={identity.role === 'staff'} />;
  return <ClassicTabLayout staff={identity.role === 'staff'} />;
}
