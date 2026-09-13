import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppleIcon, MailIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { colors, font, radius } from '@/theme';

/** The pastel header blocks — colour and top offset, left to right. */
const BLOCKS = [
  { color: colors.pastelPink, offset: 0 },
  { color: colors.pastelYellow, offset: 28 },
  { color: colors.pastelGreen, offset: 10 },
  { color: colors.pastelBlue, offset: 40 },
  { color: colors.pastelLavender, offset: 18 },
];

export default function LoginScreen() {
  const router = useRouter();
  const signIn = () => router.replace('/');

  return (
    <Screen scroll={false} contentStyle={{ paddingBottom: 24 }}>
      <View style={styles.blocks}>
        {BLOCKS.map((block) => (
          <View
            key={block.color}
            style={[styles.block, { backgroundColor: block.color, marginTop: block.offset }]}
          />
        ))}
      </View>

      <Text style={styles.wordmark}>Mindecho</Text>
      <Text style={styles.tagline}>
        {"Don't organize your life.\nJust talk. AI organizes it for you."}
      </Text>

      <View style={styles.spacer} />

      <View style={styles.providers}>
        <ProviderButton
          label="Continue with Apple"
          background={colors.text}
          color={colors.bg}
          icon={<AppleIcon size={20} color={colors.bg} />}
          onPress={signIn}
        />
        <ProviderButton
          label="Continue with Google"
          background={colors.pastelBlue}
          color={colors.text}
          icon={<Text style={styles.googleGlyph}>G</Text>}
          onPress={signIn}
        />
        <ProviderButton
          label="Continue with Email"
          background={colors.pastelYellow}
          color={colors.text}
          icon={<MailIcon size={20} color={colors.text} />}
          onPress={signIn}
        />
      </View>

      <Text style={styles.legal}>
        음성과 기록은 기기에서 암호화되어 저장됩니다. 계속하면{' '}
        <Text style={styles.legalLink}>Terms</Text> 및{' '}
        <Text style={styles.legalLink}>Privacy</Text>에 동의합니다.
      </Text>
    </Screen>
  );
}

function ProviderButton({
  label,
  background,
  color,
  icon,
  onPress,
}: {
  label: string;
  background: string;
  color: string;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.provider,
        { backgroundColor: background },
        pressed && { opacity: 0.85 },
      ]}
    >
      {icon}
      <Text style={[styles.providerLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  blocks: {
    flexDirection: 'row',
    gap: 6,
    height: 150,
    marginTop: 8,
  },
  block: {
    flex: 1,
    borderRadius: radius.pastel,
  },
  wordmark: {
    fontFamily: font.extrabold,
    fontSize: 40,
    lineHeight: 45,
    letterSpacing: 40 * -0.03,
    color: colors.text,
    marginTop: 28,
    marginBottom: 8,
  },
  tagline: {
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.neutral700,
  },
  spacer: {
    flex: 1,
    minHeight: 24,
  },
  providers: {
    gap: 10,
  },
  provider: {
    minHeight: 54,
    borderRadius: radius.pastel,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
  },
  providerLabel: {
    fontFamily: font.extrabold,
    fontSize: 15,
  },
  googleGlyph: {
    fontFamily: font.extrabold,
    fontSize: 16,
    color: colors.text,
    width: 20,
    textAlign: 'center',
  },
  legal: {
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 16.5,
    color: colors.neutral600,
    marginTop: 16,
  },
  legalLink: {
    color: colors.accent700,
  },
});
