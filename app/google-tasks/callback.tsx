/**
 * Landing spot for the Google Tasks OAuth redirect
 * (mindrecord://google-tasks/callback). On Android, Chrome Custom Tabs
 * routinely hands a custom-scheme redirect off to the OS's normal intent
 * dispatch instead of back to the WebBrowser session that opened it (see
 * src/services/googleTasks.ts's connectGoogleTasks() for the same quirk
 * app/auth/callback.tsx already documents for the login OAuth flow) --
 * without a route here, Expo Router had nowhere to send that and showed
 * "Unmatched Route" even though the connection itself had already
 * succeeded server-side.
 *
 * The actual connect already finished (or failed) on the server by the
 * time this screen can even mount -- this just polls status and shows
 * something sane while connectGoogleTasks()'s own fallback polling
 * (running in parallel, from wherever "Connect" was tapped) settles the
 * promise that screen is awaiting.
 */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui';
import { getGoogleTasksStatus } from '@/services/googleTasks';
import { colors, font } from '@/theme';

const TIMEOUT_MS = 8000;

export default function GoogleTasksCallbackScreen() {
  const router = useRouter();
  const [state, setState] = useState<'checking' | 'connected' | 'timedOut'>('checking');

  useEffect(() => {
    let cancelled = false;
    const start = Date.now();

    const poll = async () => {
      try {
        const status = await getGoogleTasksStatus();
        if (cancelled) return;
        if (status.connected) {
          setState('connected');
          setTimeout(() => {
            if (!cancelled) router.replace('/account');
          }, 600);
          return;
        }
      } catch {
        // Keep polling until the timeout instead of failing on one bad request.
      }
      if (Date.now() - start > TIMEOUT_MS) {
        if (!cancelled) setState('timedOut');
        return;
      }
      setTimeout(poll, 500);
    };
    poll();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <Screen scroll={false}>
      <View style={styles.center}>
        {state === 'timedOut' ? (
          <>
            <Text style={styles.label}>Couldn&apos;t confirm the connection.</Text>
            <Button label="Back to Account" onPress={() => router.replace('/account')} />
          </>
        ) : state === 'connected' ? (
          <>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.label}>Connected!</Text>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.label}>Finishing connecting Google Tasks…</Text>
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
