/**
 * Icons — the exact SVG paths used in the design prototype, redrawn with
 * react-native-svg. All stroke icons share the lucide 24x24 / stroke-2 geometry.
 */
import React from 'react';
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

import { colors } from '@/theme';

type IconProps = {
  size?: number;
  color?: string;
};

function Stroke({ size = 24, color = colors.text, children }: IconProps & { children: React.ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <Path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <Path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <Line x1="12" x2="12" y1="19" y2="22" />
    </Stroke>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <Path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <Polyline points="9 22 9 12 15 12 15 22" />
    </Stroke>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <Rect width="18" height="18" x="3" y="4" rx="0" />
      <Line x1="16" x2="16" y1="2" y2="6" />
      <Line x1="8" x2="8" y1="2" y2="6" />
      <Line x1="3" x2="21" y1="10" y2="10" />
    </Stroke>
  );
}

export function TasksIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <Polyline points="9 11 12 14 22 4" />
      <Path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </Stroke>
  );
}

export function MemoryIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <Path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <Path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <Path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </Stroke>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <Circle cx="11" cy="11" r="8" />
      <Path d="m21 21-4.3-4.3" />
    </Stroke>
  );
}

export function AccountIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <Circle cx="12" cy="12" r="10" />
      <Circle cx="12" cy="10" r="3" />
      <Path d="M7 20.66V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.66" />
    </Stroke>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <Path d="m15 18-6-6 6-6" />
    </Stroke>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <Path d="m9 18 6-6-6-6" />
    </Stroke>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <Rect width="20" height="16" x="2" y="4" rx="2" />
      <Path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </Stroke>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <Path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <Circle cx="12" cy="12" r="3" />
    </Stroke>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <Path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <Path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <Path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <Path d="m2 2 20 20" />
    </Stroke>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <Rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <Path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </Stroke>
  );
}

export function AppleIcon({ size = 20, color = colors.bg }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3.1 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.4-2.8-.1 0-2.8-1.1-2.8-3.8ZM14 5.4c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.9-1 2.9 1.1.1 2.1-.5 2.8-1.4Z" />
    </Svg>
  );
}
