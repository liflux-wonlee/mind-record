/**
 * Shared primitives — the `.btn`, `.tag`, `h6` and rule styles from the
 * Modernist design system, ported to React Native.
 */
import React from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';

import { cardKicker, colors, font, h6 } from '@/theme';

/* ── type ─────────────────────────────────────────────────────────────── */

/**
 * `h6` — the uppercase kicker that opens nearly every block in the design.
 * Kept to one line: the prototype pins `white-space: nowrap` on h6 so labels
 * like THOUGHTS never break across two rows.
 */
export function Kicker({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text numberOfLines={1} style={[h6, style]}>
      {children}
    </Text>
  );
}

/** `.card-kicker` — 10px accent label above an entry title. */
export function CardKicker({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text numberOfLines={1} style={[cardKicker, style]}>
      {children}
    </Text>
  );
}

/* ── tags ─────────────────────────────────────────────────────────────── */

type TagVariant = 'accent' | 'neutral' | 'outline';

const tagVariants: Record<TagVariant, { box: ViewStyle; text: TextStyle }> = {
  accent: {
    box: { backgroundColor: colors.accent100 },
    text: { color: colors.accent800 },
  },
  neutral: {
    box: { backgroundColor: colors.neutral100 },
    text: { color: colors.neutral800 },
  },
  outline: {
    box: { borderWidth: 1, borderColor: colors.accent },
    text: { color: colors.accent },
  },
};

export function Tag({
  children,
  variant = 'neutral',
  style,
}: {
  children: React.ReactNode;
  variant?: TagVariant;
  style?: StyleProp<ViewStyle>;
}) {
  const v = tagVariants[variant];
  return (
    <View style={[styles.tag, v.box, style]}>
      <Text numberOfLines={1} style={[styles.tagText, v.text]}>
        {children}
      </Text>
    </View>
  );
}

/* ── buttons ──────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  align = 'center',
  style,
  textStyle,
  disabled,
  accessibilityLabel,
}: {
  label?: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: React.ReactNode;
  /** The design left-aligns full-width buttons and centres inline ones. */
  align?: 'center' | 'flex-start';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const box: ViewStyle[] = [styles.btn, { justifyContent: align }];
  const text: TextStyle[] = [styles.btnText];

  if (variant === 'primary') {
    box.push({ backgroundColor: colors.accent });
    text.push({ color: colors.bg });
  } else if (variant === 'secondary') {
    box.push({ borderColor: colors.divider });
  } else {
    box.push(styles.btnGhost);
    text.push({ color: colors.accent });
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        box,
        disabled && styles.btnDisabled,
        pressed && !disabled && pressedStyle(variant),
        style,
      ]}
    >
      {icon}
      {label ? (
        <Text numberOfLines={1} style={[text, textStyle]}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

function pressedStyle(variant: ButtonVariant): ViewStyle {
  switch (variant) {
    case 'primary':
      return { backgroundColor: colors.accent700 };
    case 'secondary':
      return { backgroundColor: 'rgba(46,42,40,0.14)' };
    default:
      return { backgroundColor: 'rgba(239,138,128,0.18)' };
  }
}

/* ── rules ────────────────────────────────────────────────────────────── */

/** The 2px section rule that opens a list. */
export function RuleThick({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.ruleThick, style]} />;
}

/** The 1px hairline between rows. */
export function RuleThin({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.ruleThin, style]} />;
}

/** A pressable list row that darkens on press, like `style-hover` in the design. */
export function Row({
  children,
  onPress,
  onLongPress,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole={onPress || onLongPress ? 'button' : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        style,
        pressed && (onPress || onLongPress) ? { backgroundColor: colors.neutral200 } : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 0,
    flexShrink: 0,
  },
  tagText: {
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 11 * 0.02,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14.4,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 0,
  },
  btnGhost: {
    paddingHorizontal: 4,
  },
  btnText: {
    fontFamily: font.extrabold,
    fontSize: 14,
    lineHeight: 17,
    color: colors.text,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  ruleThick: {
    height: 2,
    backgroundColor: colors.divider,
  },
  ruleThin: {
    height: 1,
    backgroundColor: colors.divider,
  },
});
