/**
 * Email sign-in / sign-up — reached from Login's "Continue with Email"
 * button. Kept as its own route (rather than a field on Login itself) so
 * Login's design stays exactly as handed off; this screen reuses the same
 * design tokens and primitives.
 */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ChevronLeftIcon, EyeIcon, EyeOffIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui';
import { signInWithEmail, signUpWithEmail } from '@/services/auth';
import { colors, font, h2 } from '@/theme';

type Mode = 'sign-in' | 'sign-up';

export default function EmailAuthScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter both an email and a password.');
      return;
    }
    if (mode === 'sign-up' && !name.trim()) {
      setError('Enter your name.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'sign-in') {
        await signInWithEmail(email.trim(), password);
        // A session now exists — app/_layout.tsx's guard redirects to Home.
      } else {
        const result = await signUpWithEmail(email.trim(), password, name.trim());
        if (result.status === 'check-email') {
          setCheckEmail(true);
        }
        // Otherwise a session was returned immediately (email confirmation
        // is off for this project) and the guard redirects to Home.
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (checkEmail) {
    return (
      <Screen safeBottom>
        <Button
          variant="ghost"
          label="Back"
          icon={<ChevronLeftIcon size={18} color={colors.accent} />}
          onPress={() => router.replace('/login')}
          style={styles.back}
          textStyle={{ fontSize: 12 }}
        />
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.body}>
          We sent a confirmation link to {'\n'}
          <Text style={styles.email}>{email.trim()}</Text>
          {'\n\n'}Tap it, then come back and sign in.
        </Text>
        <Button
          label="Back to sign in"
          onPress={() => {
            setCheckEmail(false);
            setMode('sign-in');
          }}
          align="flex-start"
          style={styles.submit}
        />
      </Screen>
    );
  }

  return (
    <Screen safeBottom scroll={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <Button
          variant="ghost"
          label="Back"
          icon={<ChevronLeftIcon size={18} color={colors.accent} />}
          onPress={() => router.replace('/login')}
          style={styles.back}
          textStyle={{ fontSize: 12 }}
        />
        <Text style={styles.title}>{mode === 'sign-in' ? 'Sign in' : 'Create account'}</Text>

        <View style={styles.seg}>
          <SegOption label="Sign in" selected={mode === 'sign-in'} onPress={() => setMode('sign-in')} />
          <SegOption
            label="Create account"
            selected={mode === 'sign-up'}
            onPress={() => setMode('sign-up')}
            divided
          />
        </View>

        {mode === 'sign-up' ? (
          <View style={styles.field}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={colors.neutral600}
              autoCapitalize="words"
              textContentType="name"
            />
          </View>
        ) : null}

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.neutral600}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              value={password}
              onChangeText={setPassword}
              placeholder={mode === 'sign-up' ? 'At least 6 characters' : 'Password'}
              placeholderTextColor={colors.neutral600}
              secureTextEntry={!showPassword}
              textContentType={mode === 'sign-up' ? 'newPassword' : 'password'}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              onPress={() => setShowPassword((s) => !s)}
              style={styles.eyeButton}
              hitSlop={8}
            >
              {showPassword ? (
                <EyeOffIcon size={20} color={colors.neutral600} />
              ) : (
                <EyeIcon size={20} color={colors.neutral600} />
              )}
            </Pressable>
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.spacer} />

        <Button
          label={loading ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
          onPress={submit}
          disabled={loading}
          align="flex-start"
          style={styles.submit}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

function SegOption({
  label,
  selected,
  onPress,
  divided,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  divided?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.segOpt, divided && styles.segDivider, selected && { backgroundColor: colors.accent }]}
    >
      <Text style={[styles.segText, selected && { color: colors.bg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  back: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingLeft: 0,
    marginLeft: -4,
  },
  title: {
    ...h2,
    marginTop: 4,
    marginBottom: 16,
  },
  seg: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: 'hidden',
    marginBottom: 20,
  },
  segOpt: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  segDivider: {
    borderLeftWidth: 1,
    borderLeftColor: colors.divider,
  },
  segText: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.text,
  },
  field: {
    marginBottom: 14,
  },
  label: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: colors.neutral700,
    marginBottom: 5,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 12,
    fontFamily: font.regular,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  passwordRow: {
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 44,
  },
  eyeButton: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.accent700,
    marginTop: 2,
  },
  spacer: {
    flex: 1,
    minHeight: 12,
  },
  submit: {
    minHeight: 52,
    paddingHorizontal: 16,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 15,
    lineHeight: 23,
    color: colors.neutral700,
    marginBottom: 24,
  },
  email: {
    fontFamily: font.semibold,
    color: colors.text,
  },
});
