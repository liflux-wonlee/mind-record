/**
 * The six-tab bottom nav (1l): Home / Memory / Tasks / Calendar / Search /
 * Account. Talk was removed from the nav on the user's instruction — recording
 * starts from the Home mic. Each tab carries its own pastel color chip
 * behind the icon (same pastel block language as Account's usage cards and
 * Login's header blocks) so the bar reads as varied rather than monochrome;
 * the active tab is distinguished by darker icon/label ink, not by color.
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
import { colors, font, radius } from '@/theme';

type TabKey = 'home' | 'memory' | 'tasks' | 'calendar' | 'search' | 'account';

const TABS: {
  key: TabKey;
  label: string;
  href: string;
  chip: string;
  Icon: (p: { size?: number; color?: string }) => React.ReactElement;
}[] = [
  { key: 'home', label: 'Home', href: '/', chip: colors.pastelPink, Icon: HomeIcon },
  { key: 'memory', label: 'Memory', href: '/memory', chip: colors.pastelLavender, Icon: MemoryIcon },
  { key: 'tasks', label: 'Tasks', href: '/tasks', chip: colors.pastelGreen, Icon: TasksIcon },
  { key: 'calendar', label: 'Calendar', href: '/calendar', chip: colors.pastelBlue, Icon: CalendarIcon },
  { key: 'search', label: 'Search', href: '/search', chip: colors.pastelYellow, Icon: SearchIcon },
  { key: 'account', label: 'Account', href: '/account', chip: colors.pastelPeach, Icon: AccountIcon },
];

/** Which tab a given route highlights. */
function activeTab(pathname: string): TabKey | null {
  switch (pathname) {
    case '/':
    case '/index':
    case '/inbox':
      return 'home';
    case '/memory':
    case '/topic':
    case '/thread':
    case '/journal':
      return 'memory';
    case '/tasks':
      return 'tasks';
    case '/calendar':
      return 'calendar';
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
      {TABS.map(({ key, label, href, chip, Icon }) => {
        const isActive = active === key;
        const inkColor = isActive ? colors.text : colors.neutral600;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={label}
            onPress={() => router.navigate(href as never)}
            style={({ pressed }) => [styles.tab, pressed && { opacity: 0.6 }]}
          >
            <View style={[styles.chip, { backgroundColor: chip }, isActive && styles.chipActive]}>
              <Icon size={16} color={colors.text} />
            </View>
            <Text numberOfLines={1} style={[styles.label, { color: inkColor }]}>
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
    paddingTop: 6,
    paddingBottom: 4,
  },
  chip: {
    width: 30,
    height: 30,
    borderRadius: radius.pastel - 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    borderWidth: 1.5,
    borderColor: colors.text,
  },
  label: {
    fontFamily: font.semibold,
    fontSize: 9,
    lineHeight: 11,
    letterSpacing: 9 * 0.08,
    textTransform: 'uppercase',
  },
});
