/**
 * Screen shell — the device-safe top inset plus the prototype's
 * `padding: 8px 20px 20px` page box.
 */
import React from 'react';
import { ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GUTTER, colors } from '@/theme';

export function Screen({
  children,
  scroll = true,
  dark = false,
  /** Set false when the screen manages its own horizontal padding. */
  padded = true,
  style,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  dark?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const background = dark ? colors.neutral900 : colors.bg;

  const box: StyleProp<ViewStyle> = [
    padded && { paddingHorizontal: GUTTER },
    styles.box,
    contentStyle,
  ];

  return (
    <View style={[styles.root, { backgroundColor: background, paddingTop: insets.top }, style]}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={box}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, box]}>{children}</View>
      )}
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
    paddingBottom: 20,
    flexGrow: 1,
  },
});
