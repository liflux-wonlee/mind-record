import {
  Archivo_400Regular,
  Archivo_600SemiBold,
  Archivo_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/archivo';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LockGate } from '@/components/LockGate';
import { usePushBootstrap } from '@/hooks/usePushBootstrap';
import { purgeLegacyTurnDiagnostics } from '@/lib/legacyCleanup';
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
  if (Platform.OS === 'web') return <WebRootNavigator />;
  return <NativeRootNavigator />;
}

function NativeRootNavigator() {
  const { session, loading: authLoading } = useAuth();
  const onboardingDone = useOnboardingDone();
  const loading = authLoading || onboardingDone === null;
  // App content actually on screen (past the biometric lock) -- reported by
  // LockGate; a tapped reminder notification waits for it.
  const [contentOpen, setContentOpen] = useState(false);
  usePushBootstrap({ contentOpen });

  useEffect(() => {
    if (loading) return;
    SplashScreen.hideAsync();
  }, [loading]);

  // Deletes the Conversation turns an earlier build kept on the phone for
  // tuning (see src/lib/legacyCleanup.ts) -- once the first screen is up,
  // not on the way to it.
  useEffect(() => {
    if (!loading) purgeLegacyTurnDiagnostics();
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
          {/* Login links to these before an account exists. Registered here
              AND again in the appActive group below (Account links to them
              too) rather than as bare always-present siblings -- a screen
              declared outside every Stack.Protected group sat alongside
              `login` as a second candidate "no specific route yet" screen
              with signedIn false, and on a cold start (no deep link, no
              restored state) the navigator picked it over login as the
              initial screen instead of merely being reachable from it. */}
          <Stack.Screen name="legal/privacy-policy" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="legal/terms-of-service" options={{ animation: 'slide_from_right' }} />
        </Stack.Protected>
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
          {/* No iOS swipe-back: it skipped the "discard this recording?"
              confirmation. Talk has its own Cancel / Done controls. */}
          <Stack.Screen name="talk" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
          {/* Typed notes (Home's "Type instead"). Swipe-back stays on --
              app/note.tsx asks before an unsaved note is thrown away. */}
          <Stack.Screen name="note" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="summary" />
          {/* Tab drill-downs: pushed (swipe back on iOS), tab bar drawn by WithBottomNav. */}
          <Stack.Screen name="topic" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="journal" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="account" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="inbox" options={{ animation: 'fade' }} />
          <Stack.Screen name="google-tasks/callback" options={{ animation: 'fade' }} />
          <Stack.Screen name="settings/ai" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings/privacy" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings/google-tasks" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings/legal" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings/reminders" options={{ animation: 'slide_from_right' }} />
          {/* Home's "Today: N to keep in mind" -> See all, and a tapped reminder notification. */}
          <Stack.Screen name="reminders" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="legal/privacy-policy" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="legal/terms-of-service" options={{ animation: 'slide_from_right' }} />
        </Stack.Protected>
        {/* The web build's read-only pages -- never part of the phone app. */}
        <Stack.Protected guard={false}>
          <Stack.Screen name="records/index" />
          <Stack.Screen name="records/[id]" />
        </Stack.Protected>
      </Stack>
      {/* Rendered as a sibling overlay, never a route -- a route change
          would unmount whatever screen is underneath (an in-progress
          Capture recording, in particular), which the lock appearing must
          never do. See src/components/LockGate.tsx. */}
      <LockGate active={appActive} onOpenChange={setContentOpen} />
    </>
  );
}

/**
 * The web build (see docs/WEB_PREPARATION.md): sign in, then a read-only
 * view of the same account's records -- /records and /records/<id>. Every
 * phone-only screen (recording, conversations, settings, the tabs) is
 * declared in a group that is never available here, so typing its URL
 * lands on sign-in or the records list instead of mounting it -- none of
 * them can start the mic, edit, or run AI work from a browser yet. No
 * onboarding (it's the phone app's intro) and no biometric LockGate (a
 * phone-only feature; see src/lib/biometricLock.web.ts).
 */
function WebRootNavigator() {
  const { session, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null;

  const signedIn = !!session;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
        <Stack.Screen name="email-auth" />
        <Stack.Screen name="auth/callback" />
        <Stack.Screen name="legal/privacy-policy" />
        <Stack.Screen name="legal/terms-of-service" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="records/index" options={{ title: 'Records · JoaAssistant' }} />
        <Stack.Screen name="records/[id]" options={{ title: 'Record · JoaAssistant' }} />
        <Stack.Screen name="legal/privacy-policy" />
        <Stack.Screen name="legal/terms-of-service" />
      </Stack.Protected>
      {/* Phone-only screens: declared so their URLs are known and blocked. */}
      <Stack.Protected guard={false}>
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="talk" />
        <Stack.Screen name="note" />
        <Stack.Screen name="summary" />
        <Stack.Screen name="topic" />
        <Stack.Screen name="journal" />
        <Stack.Screen name="account" />
        <Stack.Screen name="inbox" />
        <Stack.Screen name="google-tasks/callback" />
        <Stack.Screen name="settings/ai" />
        <Stack.Screen name="settings/privacy" />
        <Stack.Screen name="settings/google-tasks" />
        <Stack.Screen name="settings/legal" />
        <Stack.Screen name="settings/reminders" />
        <Stack.Screen name="reminders" />
      </Stack.Protected>
    </Stack>
  );
}
