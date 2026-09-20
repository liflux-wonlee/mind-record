import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { ChevronRightIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { SettingsHeader } from '@/components/SettingsHeader';
import { colors, font, radius } from '@/theme';

const LINKS = [
  { title: 'Privacy Policy', route: '/legal/privacy-policy' as const, color: colors.pastelBlue },
  { title: 'Terms of Service', route: '/legal/terms-of-service' as const, color: colors.pastelLavender },
];

export default function LegalSettingsScreen() {
  const router = useRouter();
  return (
    <Screen showAccount={false}>
      <SettingsHeader title="Legal" />
      {LINKS.map((link) => (
        <Pressable
          key={link.route}
          accessibilityRole="button"
          onPress={() => router.push(link.route)}
          style={({ pressed }) => [styles.row, { backgroundColor: link.color }, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.title}>{link.title}</Text>
          <ChevronRightIcon size={20} color={colors.neutral700} />
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 58,
    borderRadius: radius.pastel,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  title: {
    fontFamily: font.semibold,
    fontSize: 15,
    color: colors.text,
  },
});
