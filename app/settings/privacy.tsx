import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { SettingsHeader } from '@/components/SettingsHeader';
import { Button, Kicker } from '@/components/ui';
import {
  biometricLabel,
  disableBiometricLock,
  enableBiometricLock,
  getBiometricSupport,
  isBiometricLockEnabled,
  type BiometricKind,
} from '@/lib/biometricLock';
import { friendlyMessage } from '@/lib/friendlyError';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { colors, font, radius } from '@/theme';

/**
 * Off by default; only shown at all when the device actually has a
 * biometric enrolled (rule: "only show what the hardware actually
 * supports"). Turning it on or off both require a real OS auth first --
 * see src/lib/biometricLock.ts -- so this screen never flips `enabled`
 * from the toggle press alone, only from what enable/disableBiometricLock
 * actually confirmed.
 */
export default function PrivacySettingsScreen() {
  const { user } = useAuth();
  const [support, setSupport] = useState<{ available: boolean; kind: BiometricKind | null } | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  // Only email/password accounts have a password to change -- Google/Apple
  // sign-in has nothing here for us to touch.
  const canChangePassword = user?.identities?.some((i) => i.provider === 'email') ?? false;

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([getBiometricSupport(), isBiometricLockEnabled(user.id)]).then(([s, e]) => {
      if (cancelled) return;
      setSupport(s);
      setEnabled(e);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const label = support ? biometricLabel(support.kind) : '';

  const changePassword = async () => {
    if (changingPassword) return;
    if (newPassword.length < 6) {
      Alert.alert('Too short', 'Use at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Passwords don't match", 'Make sure both fields are the same.');
      return;
    }
    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword('');
      setConfirmPassword('');
      Alert.alert('Password changed', 'Your password has been updated.');
    } catch (e) {
      Alert.alert('Could not change password', friendlyMessage(e, 'Please try again.'));
    } finally {
      setChangingPassword(false);
    }
  };

  const toggle = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      if (enabled) {
        const ok = await disableBiometricLock(user.id);
        if (ok) setEnabled(false);
        // A cancelled/failed confirmation leaves it on -- disabling must
        // never happen just because the user backed out of the prompt.
      } else {
        const ok = await enableBiometricLock(user.id);
        if (ok) {
          setEnabled(true);
        } else {
          Alert.alert('Could not turn on', `${label} did not confirm it was you.`);
        }
      }
    } catch (e) {
      Alert.alert('Something went wrong', friendlyMessage(e, 'Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const passwordDirty = newPassword.length > 0 || confirmPassword.length > 0;

  return (
    <Screen showAccount={false}>
      <SettingsHeader title="Biometric Lock" />
      {!support ? null : !support.available ? (
        <View style={styles.card}>
          <Text style={styles.body}>
            Biometric unlock isn&apos;t available on this device -- either there&apos;s no fingerprint/face sensor,
            or nothing is enrolled in your device&apos;s own settings.
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Kicker style={{ color: colors.neutral600, marginBottom: 8 }}>{label}</Kicker>
          <Text style={styles.body}>
            {enabled
              ? `Your records are locked behind ${label} whenever you open or return to the app.`
              : `Require ${label} to view your records.`}
          </Text>
          <Button
            variant={enabled ? 'primary' : 'secondary'}
            label={busy ? '...' : enabled ? 'Turn off' : 'Turn on'}
            disabled={busy}
            onPress={toggle}
            align="flex-start"
            style={styles.toggleButton}
          />
        </View>
      )}

      {canChangePassword ? (
        <View style={[styles.card, { backgroundColor: colors.pastelPeach, marginTop: 14 }]}>
          <Kicker style={{ color: colors.neutral600, marginBottom: 8 }}>Change password</Kicker>
          <TextInput
            style={styles.input}
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="New password"
            placeholderTextColor={colors.neutral600}
            secureTextEntry
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Confirm new password"
            placeholderTextColor={colors.neutral600}
            secureTextEntry
            autoCapitalize="none"
          />
          {passwordDirty ? (
            <Button
              label={changingPassword ? 'Saving…' : 'Save'}
              disabled={changingPassword}
              onPress={changePassword}
              align="flex-start"
              variant="save"
              style={styles.toggleButton}
            />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.pastel,
    backgroundColor: colors.pastelLavender,
    padding: 16,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.text,
    marginBottom: 14,
  },
  toggleButton: {
    minHeight: 46,
    borderRadius: radius.pastel,
    paddingHorizontal: 18,
  },
  input: {
    minHeight: 46,
    paddingHorizontal: 14,
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.bg,
    borderRadius: radius.pastel,
    marginBottom: 12,
  },
});
