import {
  Archivo_400Regular,
  Archivo_600SemiBold,
  Archivo_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/archivo';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { AppProvider } from '@/store';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync();

/** Routes reachable without a session. */
const AUTH_ROUTES = ['login', 'email-auth', 'auth'];

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
        <AppProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </AppProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    SplashScreen.hideAsync();
  }, [loading]);

  // Reactive guard: catches sign-in/sign-out that happen *after* first
  // render (e.g. Account's Sign out button) and redirects accordingly.
  useEffect(() => {
    if (loading) return;
    const inAuthFlow = AUTH_ROUTES.includes(segments[0] as string);
    if (!session && !inAuthFlow) {
      router.replace('/login');
    } else if (session && inAuthFlow) {
      router.replace('/');
    }
  }, [session, loading, segments, router]);

  // Splash screen is still showing at this point (preventAutoHideAsync above).
  if (loading) return null;

  return (
    <Stack
      // Computed once, after we already know the session — the tabs and
      // login group never both mount, so there's no flash of the wrong one.
      initialRouteName={session ? '(tabs)' : 'login'}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="login" options={{ animation: 'fade' }} />
      <Stack.Screen name="email-auth" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="auth/callback" options={{ animation: 'fade' }} />
      <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
      <Stack.Screen name="talk" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="summary" />
    </Stack>
  );
}
