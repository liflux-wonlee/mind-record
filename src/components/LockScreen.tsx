/**
 * Full-screen unlock overlay shown by src/components/LockGate.tsx. Rendered
 * as an absolutely-positioned sibling of the app's own navigation stack
 * (see app/_layout.tsx), never as a route -- swapping to a route would
 * unmount whatever screen is underneath, which for a Capture recording in
 * progress would kill (and, before the earlier fix in this session, used
 * to delete) the recording just because the lock screen appeared.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { authenticate, biometricLabel, getBiometricSupport, type BiometricKind } from '@/lib/biometricLock';
import { signOut } from '@/services/auth';
import { colors, font, radius } from '@/theme';

export function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [kind, setKind] = useState<BiometricKind | null>(null);
  const [supportChecked, setSupportChecked] = useState(false);
  const [supported, setSupported] = useState(true);
  const [status, setStatus] = useState<'idle' | 'checking' | 'failed'>('idle');
  const [signingOut, setSigningOut] = useState(false);
  // Runs the OS prompt once automatically per time the lock screen appears
  // -- never again on its own after that, so a cancel/failure never loops
  // the prompt back up; the user has to tap "Unlock" (or "Sign in again").
  const autoTriedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getBiometricSupport().then((support) => {
      if (cancelled) return;
      setKind(support.kind);
      setSupported(support.available);
      setSupportChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const tryUnlock = async () => {
    if (status === 'checking') return;
    setStatus('checking');
    const ok = await authenticate('Unlock Mind Record');
    if (ok) {
      onUnlocked();
      return;
    }
    setStatus('failed');
  };

  useEffect(() => {
    if (!supportChecked || autoTriedRef.current) return;
    autoTriedRef.current = true;
    if (supported) tryUnlock();
    // If biometrics aren't available any more (removed since the lock was
    // turned on, hardware issue, etc.), there's nothing to auto-trigger --
    // the "Sign in again" fallback below is the only way forward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportChecked, supported]);

  const label = biometricLabel(kind);

  const handleSignOutFallback = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      // app/_layout.tsx's auth guard takes it from here once the session
      // clears -- LockGate itself also clears when `user` goes away.
    } catch {
      setSigningOut(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.blocks}>
        <View style={[styles.block, { backgroundColor: colors.pastelPink }]} />
        <View style={[styles.block, { backgroundColor: colors.pastelBlue, marginTop: 24 }]} />
        <View style={[styles.block, { backgroundColor: colors.pastelYellow, marginTop: 10 }]} />
      </View>

      <Text style={styles.title}>Locked</Text>

      {!supportChecked ? (
        <ActivityIndicator size="small" color={colors.text} style={{ marginTop: 16 }} />
      ) : supported ? (
        <>
          <Text style={styles.body}>
            {status === 'checking'
              ? `Confirming with ${label}…`
              : status === 'failed'
                ? `${label} could not confirm it was you.`
                : `Use ${label} to see your records.`}
          </Text>
          <Button
            label={status === 'checking' ? 'Confirming…' : 'Unlock'}
            disabled={status === 'checking'}
            onPress={tryUnlock}
            style={styles.primaryButton}
          />
        </>
      ) : (
        <Text style={styles.body}>
          Biometric unlock is no longer available on this device (no fingerprint/face is enrolled, or
          the hardware can't be reached right now). Sign in again to continue.
        </Text>
      )}

      <Button
        variant="ghost"
        label={signingOut ? 'Signing out…' : 'Sign in again instead'}
        disabled={signingOut}
        onPress={handleSignOutFallback}
        style={styles.fallbackButton}
        textStyle={{ fontSize: 12, color: colors.neutral600 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    zIndex: 1000,
    elevation: 1000,
  },
  blocks: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 28,
  },
  block: {
    width: 44,
    height: 72,
    borderRadius: radius.pastel,
  },
  title: {
    fontFamily: font.extrabold,
    fontSize: 26,
    color: colors.text,
    marginBottom: 12,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.neutral700,
    textAlign: 'center',
    marginBottom: 22,
  },
  primaryButton: {
    minHeight: 52,
    paddingHorizontal: 32,
  },
  fallbackButton: {
    marginTop: 18,
  },
});
