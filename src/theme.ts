/**
 * Design tokens — ported from the Claude Design handoff.
 *
 * Base system: the Modernist `styles.css` under `design/project/_ds` — Archivo,
 * 2px rules, zero radius, flush-left labels.
 * Overrides: the `:root` block at the top of `design/project/Mindecho.dc.html`,
 * where the user swapped the stock red accent for a pastel coral and warmed the
 * ground colours.
 */

export const colors = {
  // — overridden in Mindecho.dc.html —
  accent: '#ef8a80',
  accent500: '#f29a91',
  accent600: '#e5776c',
  accent700: '#c9584d',
  accent800: '#9e4238',
  accent100: '#fdf0ee',
  accent200: '#fbe0dc',
  bg: '#f7f4f2',
  surface: '#f0ebe8',
  text: '#2e2a28',

  // — Modernist neutral ramp —
  neutral100: '#f8f4f4',
  neutral200: '#eae7e7',
  neutral300: '#d7d3d3',
  neutral400: '#bab6b6',
  neutral500: '#9b9797',
  neutral600: '#7d7979',
  neutral700: '#605d5d',
  neutral800: '#444141',
  neutral900: '#2d2b2b',

  /** color-mix(in srgb, #201e1d 40%, transparent) */
  divider: 'rgba(32,30,29,0.4)',

  // — pastel blocks used by Login, Account, Home and the bottom nav —
  pastelPink: '#fbd9d4',
  pastelYellow: '#fde9b8',
  pastelGreen: '#cfe6d2',
  pastelBlue: '#cfe0f5',
  pastelLavender: '#e1d8f5',
  pastelPeach: '#fde3cf',
} as const;

export const font = {
  regular: 'Archivo_400Regular',
  semibold: 'Archivo_600SemiBold',
  extrabold: 'Archivo_800ExtraBold',
} as const;

export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
} as const;

/** The Modernist system is zero-radius; the pastel blocks are the exception. */
export const radius = {
  none: 0,
  pastel: 14,
} as const;

/** Horizontal page gutter used by every screen in the prototype. */
export const GUTTER = 20;

/** `h6` — uppercase kicker. 13px / 800 / .08em, per the design system. */
export const h6 = {
  fontFamily: font.extrabold,
  fontSize: 13,
  lineHeight: 15,
  letterSpacing: 13 * 0.08,
  textTransform: 'uppercase',
  color: colors.text,
} as const;

/** `.card-kicker` — 10px / .1em uppercase, always accent-coloured. */
export const cardKicker = {
  fontFamily: font.regular,
  fontSize: 10,
  lineHeight: 14,
  letterSpacing: 10 * 0.1,
  textTransform: 'uppercase',
  color: colors.accent,
} as const;

/** `h2` as used on every screen: 28px / 800 / -.015em. */
export const h2 = {
  fontFamily: font.extrabold,
  fontSize: 28,
  lineHeight: 31,
  letterSpacing: 28 * -0.015,
  color: colors.text,
} as const;

export const body = {
  fontFamily: font.regular,
  fontSize: 15,
  lineHeight: 23,
  color: colors.text,
} as const;
