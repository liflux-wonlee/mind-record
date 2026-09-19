import { Tabs } from 'expo-router';
import React from 'react';

import { BottomNav } from '@/components/BottomNav';
import { colors } from '@/theme';

/**
 * The five visible tabs (Home/Records/Topics/Tasks/Search) plus the
 * drill-down screens that keep the nav visible without being a tab button
 * themselves: Account (reached from Home's profile icon), Inbox, Topic,
 * Thread, Journal. The bar itself is fully custom — see `BottomNav`.
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={() => <BottomNav />}
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

      <Tabs.Screen name="account" options={{ href: null }} />
      <Tabs.Screen name="inbox" options={{ href: null }} />
      <Tabs.Screen name="topic" options={{ href: null }} />
      <Tabs.Screen name="journal" options={{ href: null }} />
    </Tabs>
  );
}
