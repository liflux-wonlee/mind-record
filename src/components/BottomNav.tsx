/**
 * The six-tab bottom nav (1l): Home / Calendar / Tasks / Memory / Search /
 * Account. Talk was removed from the nav on the user's instruction — recording
 * starts from the Home mic.
 *
 * Drill-down screens borrow a tab's highlight the way the prototype's `c()`
 * helper does: Inbox lights up Home; Topic, Thread and Journal light up Memory.
 */
import { usePathname, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AccountIcon,
  CalendarIcon,
  HomeIcon,
  MemoryIcon,
  SearchIcon,
  TasksIcon,
} from '@/components/Icon';
import { colors, font } from '@/theme';

type TabKey = 'home' | 'calendar' | 'tasks' | 'memory' | 'search' | 'account';

const TABS: {
  key: TabKey;
  label: string;
  href: string;
  Icon: (p: { size?: number; color?: string }) => React.ReactElement;
}[] = [
  { key: 'home', label: 'Home', href: '/', Icon: HomeIcon },
  { key: 'calendar', label: 'Calendar', href: '/calendar', Icon: CalendarIcon },
  { key: 'tasks', label: 'Tasks', href: '/tasks', Icon: TasksIcon },
  { key: 'memory', label: 'Memory', href: '/memory', Icon: MemoryIcon },
  { key: 'search', label: 'Search', href: '/search', Icon: SearchIcon },
  { key: 'account', label: 'Account', href: '/account', Icon: AccountIcon },
];

/** Which tab a given route highlights. */
function activeTab(pathname: string): TabKey | null {
  switch (pathname) {
    case '/':
    case '/index':
    case '/inbox':
      return 'home';
    case '/calendar':
      return 'calendar';
    case '/tasks':
      return 'tasks';
    case '/memory':
    case '/topic':
    case '/thread':
    case '/journal':
      return 'memory';
    case '/search':
      return 'search';
    case '/account':
      return 'account';
    default:
      return null;
  }
}

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const active = activeTab(pathname);

  return (
    <View style={[styles.nav, { paddingBottom: insets.bottom }]}>
      {TABS.map(({ key, label, href, Icon }) => {
        const color = active === key ? colors.accent : colors.text;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected: active === key }}
            accessibilityLabel={label}
            onPress={() => router.navigate(href as never)}
            style={({ pressed }) => [styles.tab, pressed && { opacity: 0.6 }]}
          >
            <Icon size={22} color={color} />
            <Text numberOfLines={1} style={[styles.label, { color }]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    flexDirection: 'row',
    borderTopWidth: 2,
    borderTopColor: colors.divider,
    backgroundColor: colors.bg,
  },
  tab: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 3,
    paddingTop: 8,
    paddingBottom: 4,
  },
  label: {
    fontFamily: font.semibold,
    fontSize: 9,
    lineHeight: 11,
    letterSpacing: 9 * 0.08,
    textTransform: 'uppercase',
  },
});
