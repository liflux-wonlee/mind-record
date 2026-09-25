/**
 * Screen shell — the device-safe top inset plus the prototype's
 * `padding: 8px 20px 20px` page box. Also the single place the Account
 * icon is rendered from, so it shows up top-right on every real screen
 * without every screen having to build its own header row for it.
 */
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountIcon } from '@/components/Icon';
import { useAuth } from '@/providers/AuthProvider';
import { GUTTER, colors } from '@/theme';

export function Screen({
  children,
  scroll = true,
  dark = false,
  /** Set false when the screen manages its own horizontal padding. */
  padded = true,
  /**
   * Add the device's bottom safe-area inset on top of `bottomPadding` —
   * Android's gesture bar / 3-button nav, iOS's home indicator. Screens that
   * sit under the bottom tab bar leave this false: BottomNav already reserves
   * that space itself. Full-screen routes with their own bottom-row buttons
   * (Talk, Summary, Driving, Login) need it or those buttons render partly
   * behind the system nav bar.
   */
  safeBottom = false,
  /** Base bottom padding before any safe-area inset from `safeBottom` is added. */
  bottomPadding = 20,
  /** Off on screens that already have their own top-right control in that
   *  corner (Talk's mode toggle + Save-only button) or before a session
   *  exists (login/email-auth) -- everywhere else, on by default. */
  showAccount = true,
  style,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  dark?: boolean;
  padded?: boolean;
  safeBottom?: boolean;
  bottomPadding?: number;
  showAccount?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const background = dark ? colors.neutral900 : colors.bg;

  const box: StyleProp<ViewStyle> = [
    padded && { paddingHorizontal: GUTTER },
    styles.box,
    { paddingBottom: bottomPadding + (safeBottom ? insets.bottom : 0) },
    contentStyle,
  ];

  return (
    <View style={[styles.root, { backgroundColor: background, paddingTop: insets.top }, style]}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={box}
          keyboardShouldPersistTaps="handled"
          // iOS doesn't resize the window for the keyboard (Android does):
          // scroll the focused field into view and let a drag dismiss it.
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="interactive"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, box]}>{children}</View>
      )}

      {showAccount && user ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Account"
          onPress={() => router.push('/account')}
          hitSlop={8}
          style={({ pressed }) => [
            styles.accountButton,
            { top: insets.top + 8 },
            pressed && { opacity: 0.7 },
          ]}
        >
          <AccountIcon size={20} color={colors.accent800} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  box: {
    paddingTop: 8,
    // paddingBottom is set explicitly below (bottomPadding + safe-area inset).
    flexGrow: 1,
  },
  accountButton: {
    position: 'absolute',
    right: GUTTER,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.pastelYellow,
  },
});
