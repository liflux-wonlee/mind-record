import {
  Archivo_400Regular,
  Archivo_600SemiBold,
  Archivo_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/archivo';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LockGate } from '@/components/LockGate';
import { useOnboardingDone } from '@/lib/onboarding';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Archivo_400Regular,
    Archivo_600SemiBold,
    Archivo_800ExtraBold,
  });

  // Splash stays up until fonts are ready; RootNavigator keeps it up further
  // until the Supabase session check also resolves, so the app never flashes
  // the wrong screen (login vs. home) for a signed-in-or-not user.
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { session, loading: authLoading } = useAuth();
  const onboardingDone = useOnboardingDone();
  const loading = authLoading || onboardingDone === null;

  useEffect(() => {
    if (loading) return;
    SplashScreen.hideAsync();
  }, [loading]);

  // Splash screen is still showing at this point (preventAutoHideAsync above).
  if (loading) return null;

  // Stack.Protected does the routing: with no session only the auth
  // screens exist (so a signed-out cold start can never mount Home first
  // and fade to Login, which `initialRouteName` alone did not prevent --
  // expo-router seeds its state from the launch URL, not that prop), and
  // once a session appears/disappears it redirects to the first available
  // screen on its own, replacing the old effect-based redirect.
  const signedIn = !!session;
  // Only the actual app content (past onboarding) is ever behind the
  // biometric lock -- login and the intro have nothing sensitive to
  // protect yet.
  const appActive = signedIn && onboardingDone === true;
  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" options={{ animation: 'fade' }} />
          <Stack.Screen name="email-auth" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="auth/callback" options={{ animation: 'fade' }} />
        </Stack.Protected>
        {/* Reachable regardless of auth state: Login must be able to link to
            them before an account exists, and Account links to them again
            once signed in -- so they sit outside every Stack.Protected
            group rather than being duplicated into two of them. */}
        <Stack.Screen name="legal/privacy-policy" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="legal/terms-of-service" options={{ animation: 'slide_from_right' }} />
        {/* The intro and the app proper are mutually exclusive: on a fresh
            install only the intro exists, and finishing it flips
            `onboardingDone` (in-process, not just on next launch) so the
            intro disappears and Protected redirects into the tabs. Account's
            "Show the intro again" resets the flag and the same thing
            happens in reverse. */}
        <Stack.Protected guard={signedIn && !onboardingDone}>
          <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
        </Stack.Protected>
        <Stack.Protected guard={appActive}>
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="talk" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="summary" />
          <Stack.Screen name="google-tasks/callback" options={{ animation: 'fade' }} />
          <Stack.Screen name="settings/ai" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings/privacy" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings/google-tasks" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings/legal" options={{ animation: 'slide_from_right' }} />
        </Stack.Protected>
      </Stack>
      {/* Rendered as a sibling overlay, never a route -- a route change
          would unmount whatever screen is underneath (an in-progress
          Capture recording, in particular), which the lock appearing must
          never do. See src/components/LockGate.tsx. */}
      <LockGate active={appActive} />
    </>
  );
}
