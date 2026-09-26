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

  // — pastel blocks used by Login, Account and the bottom nav —
  pastelPink: '#fbd9d4',
  pastelYellow: '#fde9b8',
  pastelGreen: '#cfe6d2',
  pastelBlue: '#cfe0f5',
  pastelLavender: '#e1d8f5',
  pastelPeach: '#fde3cf',

  // — action colors, app-wide: every Save is the blue, every Delete the red
  // (deeper than the pastel blocks so they read as the main action) —
  save: '#9dc0ea',
  saveText: '#1b375a',
  danger: '#f0a198',
  dangerText: '#6c2019',
} as const;

/**
 * One color per calendar month (Jan = index 0), for Calendar's month
 * title -- a lightweight way to make each month visually distinct at a
 * glance while flipping through them. These are deliberately darker/more
 * saturated than the `pastelX` block colors above -- those are only ever
 * used as light backgrounds with dark text on top; this is standalone
 * 28px text directly on `colors.bg`, so it needs real contrast rather
 * than a near-white pastel disappearing into the page.
 */
export const monthColors: readonly string[] = [
  '#5b84ab', // Jan
  '#8f6fc0', // Feb
  '#4f9468', // Mar
  '#3f9c85', // Apr
  '#b98f1f', // May
  '#d1793f', // Jun
  '#d16b62', // Jul
  '#a98a4c', // Aug
  '#cf6f8d', // Sep
  '#c85f52', // Oct
  '#7c62a8', // Nov
  '#4f83a8', // Dec
];

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
