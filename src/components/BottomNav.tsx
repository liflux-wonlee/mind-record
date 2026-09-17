/**
 * The five-tab bottom nav: Home / Records / Topics / Tasks / Search.
 * Account moved off the tab bar -- it's reached from the profile icon on
 * Home instead (still a real screen inside the (tabs) group, just not a
 * tab button; see app/(tabs)/_layout.tsx). Talk was removed from the nav
 * on an earlier instruction -- recording starts from the Home mic.
 *
 * Each tab carries its own pastel color chip behind the icon (same pastel
 * block language as Account's usage cards and Login's header blocks) so
 * the bar reads as varied rather than monochrome; the active tab is shown
 * by darker icon/label ink and a chip border, not by a different color.
 *
 * Drill-down screens borrow a tab's highlight the way the prototype's `c()`
 * helper does: Inbox (now just a redirect into Topics' Unclassified view),
 * Topic and Thread light up Topics; Journal lights up Records (it's a
 * date-based view of recordings).
 */
import { usePathname, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CalendarIcon, HomeIcon, MemoryIcon, SearchIcon, TasksIcon } from '@/components/Icon';
import { colors, font, radius } from '@/theme';

type TabKey = 'home' | 'records' | 'topics' | 'tasks' | 'search';

const TABS: {
  key: TabKey;
  label: string;
  href: string;
  chip: string;
  Icon: (p: { size?: number; color?: string }) => React.ReactElement;
}[] = [
  { key: 'home', label: 'Home', href: '/', chip: colors.pastelPink, Icon: HomeIcon },
  { key: 'records', label: 'Records', href: '/calendar', chip: colors.pastelBlue, Icon: CalendarIcon },
  { key: 'topics', label: 'Topics', href: '/memory', chip: colors.pastelLavender, Icon: MemoryIcon },
  { key: 'tasks', label: 'Tasks', href: '/tasks', chip: colors.pastelGreen, Icon: TasksIcon },
  { key: 'search', label: 'Search', href: '/search', chip: colors.pastelYellow, Icon: SearchIcon },
];

/** Which tab a given route highlights. */
function activeTab(pathname: string): TabKey | null {
  switch (pathname) {
    case '/':
    case '/index':
      return 'home';
    case '/calendar':
    case '/journal':
      return 'records';
    case '/memory':
    case '/topic':
    case '/thread':
    case '/inbox':
      return 'topics';
    case '/tasks':
      return 'tasks';
    case '/search':
      return 'search';
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
