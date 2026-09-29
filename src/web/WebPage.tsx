/**
 * Page frame for the web build's read-only screens (app/records/*): a
 * centered column with a readable max width on a desktop browser, the app
 * wordmark, and Sign out. Mobile screens never use this -- the phone app
 * keeps its own layouts (see docs/WEB_PREPARATION.md).
 */
import { Link } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { friendlyMessage } from '@/lib/friendlyError';
import { signOut } from '@/services/auth';
import { colors, font } from '@/theme';

export const WEB_MAX_WIDTH = 760;

export function WebPage({ children }: { children: React.ReactNode }) {
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const onSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      // The root navigator swaps to the signed-out screens as soon as the
      // session is gone, unmounting these pages and everything they loaded.
      await signOut();
    } catch (e) {
      setSignOutError(friendlyMessage(e, 'Could not sign out. Please try again.'));
      setSigningOut(false);
    }
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.outer}>
      <View style={styles.column}>
        <View style={styles.header}>
          <Link href="/records" style={styles.wordmark}>
            JoaAssistant
          </Link>
          <Button
            variant="ghost"
            label={signingOut ? 'Signing out…' : 'Sign out'}
            disabled={signingOut}
            onPress={onSignOut}
          />
        </View>
        {signOutError ? <Text style={styles.error}>{signOutError}</Text> : null}
        {children}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  outer: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  column: {
    width: '100%',
    maxWidth: WEB_MAX_WIDTH,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  wordmark: {
    fontFamily: font.extrabold,
    fontSize: 20,
    color: colors.text,
  },
  error: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.accent700,
    marginBottom: 12,
  },
});
