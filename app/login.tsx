import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppleIcon, MailIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { AppleSignInUnavailableError, signInWithApple, signInWithGoogle } from '@/services/auth';
import { colors, font, radius } from '@/theme';

/** The pastel header blocks — colour and top offset, left to right. */
const BLOCKS = [
  { color: colors.pastelPink, offset: 0 },
  { color: colors.pastelYellow, offset: 28 },
  { color: colors.pastelGreen, offset: 10 },
  { color: colors.pastelBlue, offset: 40 },
  { color: colors.pastelLavender, offset: 18 },
];

type Provider = 'apple' | 'google';

export default function LoginScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState<Provider | null>(null);

  const withBusy = (provider: Provider, action: () => Promise<void>) => async () => {
    if (busy) return;
    setBusy(provider);
    try {
      await action();
      // Success just means a session now exists — app/_layout.tsx's auth
      // guard is what actually navigates to Home once it sees it.
    } catch (e) {
      if (e instanceof AppleSignInUnavailableError) {
        Alert.alert('iOS only', 'Sign in with Apple is only available on iOS right now.');
      } else if ((e as { name?: string })?.name === 'OAuthCancelledError') {
        // User closed the browser tab — not an error worth surfacing.
      } else {
        Alert.alert('Sign-in failed', e instanceof Error ? e.message : 'Please try again.');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen scroll={false} safeBottom bottomPadding={24}>
      <View style={styles.blocks}>
        {BLOCKS.map((block) => (
          <View
            key={block.color}
            style={[styles.block, { backgroundColor: block.color, marginTop: block.offset }]}
          />
        ))}
      </View>

      <Text style={styles.wordmark}>Mind Record</Text>
      <Text style={styles.tagline}>
        {"Don't organize your life.\nJust talk. AI organizes it for you."}
      </Text>

      <View style={styles.spacer} />

      <View style={styles.providers}>
        <ProviderButton
          label={busy === 'apple' ? 'Please wait…' : 'Continue with Apple'}
          background={colors.text}
          color={colors.bg}
          icon={<AppleIcon size={20} color={colors.bg} />}
          disabled={busy !== null}
          onPress={withBusy('apple', signInWithApple)}
        />
        <ProviderButton
          label={busy === 'google' ? 'Please wait…' : 'Continue with Google'}
          background={colors.pastelBlue}
          color={colors.text}
          icon={<Text style={styles.googleGlyph}>G</Text>}
          disabled={busy !== null}
          onPress={withBusy('google', signInWithGoogle)}
        />
        <ProviderButton
          label="Continue with Email"
          background={colors.pastelYellow}
          color={colors.text}
          icon={<MailIcon size={20} color={colors.text} />}
          disabled={busy !== null}
          onPress={() => router.push('/email-auth')}
        />
      </View>

      <Text style={styles.legal}>
        Your voice and records are stored securely. By continuing you agree to the{' '}
        <Text style={styles.legalLink}>Terms</Text> and{' '}
        <Text style={styles.legalLink}>Privacy Policy</Text>.
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
  disabled,
}: {
  label: string;
  background: string;
  color: string;
  icon: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.provider,
        { backgroundColor: background },
        disabled && styles.providerDisabled,
        pressed && !disabled && { opacity: 0.85 },
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
  providerDisabled: {
    opacity: 0.6,
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
