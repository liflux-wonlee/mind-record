import React from 'react';
import { View } from 'react-native';

import { BottomNav } from '@/components/BottomNav';
import { colors } from '@/theme';

/**
 * For drill-down screens (Topic, Journal, Account) that are pushed on the
 * root stack -- so they get the native iOS edge-swipe back and a real
 * back() -- but should still show the tab bar like the tab they belong to.
 * BottomNav highlights the owning tab from the path and switches tabs with
 * router.navigate, which returns to the tabs underneath.
 */
export function WithBottomNav({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1 }}>{children}</View>
      <BottomNav />
    </View>
  );
}
