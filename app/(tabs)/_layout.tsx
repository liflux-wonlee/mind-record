import { Tabs } from 'expo-router';
import React from 'react';

import { BottomNav } from '@/components/BottomNav';
import { colors } from '@/theme';

/**
 * The five tabs (Home/Records/Topics/Tasks/Search). Their drill-down
 * screens (Topic, Journal, Account) live on the root stack instead, so they
 * slide in and get the iOS swipe back -- they draw the same bar themselves
 * (see WithBottomNav). The bar itself is fully custom — see `BottomNav`.
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={() => <BottomNav />}
      // Android's back on a tab returns to the previously used tab rather
      // than always jumping to Home.
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="calendar" />
      <Tabs.Screen name="memory" />
      <Tabs.Screen name="tasks" />
      <Tabs.Screen name="search" />

    </Tabs>
  );
}
