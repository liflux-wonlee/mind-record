/**
 * Landing spot for Supabase's OAuth redirect (mindrecord://auth/callback).
 * On iOS this URL is normally intercepted by the in-app browser session
 * before it ever reaches Expo Router (see src/lib/oauth.ts) -- but on
 * Android, Chrome Custom Tabs routinely hands a custom-scheme redirect off
 * to the OS's normal intent dispatch instead, which Expo Router then treats
 * as a real navigation. Without a route here, that showed "Unmatched Route".
 *
 * The actual session exchange happens in src/providers/AuthProvider.tsx's
 * global deep-link listener (the same one that handles email confirmation
 * links) -- this screen just has to show something sane while that
 * resolves. app/_layout.tsx's auth guard redirects away once `session` is
 * set; if it never resolves, the timeout below offers a way back.
 */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import { colors, font } from '@/theme';

const TIMEOUT_MS = 8000;

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (session) return;
    const id = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [session]);

  return (
    <Screen scroll={false}>
      <View style={styles.center}>
        {timedOut ? (
          <>
            <Text style={styles.label}>Sign-in didn&apos;t finish.</Text>
            <Button label="Back to sign in" onPress={() => router.replace('/login')} />
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.label}>Signing you in…</Text>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  label: {
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.neutral700,
  },
});
