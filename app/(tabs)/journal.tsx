import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ChevronLeftIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, Kicker, RuleThick } from '@/components/ui';
import { colors, font, h2 } from '@/theme';

const STATS = [
  { value: '7', label: 'Thoughts' },
  { value: '3', label: 'Ideas' },
  { value: '4', label: 'Tasks' },
  { value: '1', label: 'Decision' },
];

const SECTIONS = [
  {
    label: 'Business',
    text: 'Subscription Service Idea가 최종 방향에 도달. Basic 플랜은 1 Organization으로 유지.',
  },
  { label: 'Faith', text: '로마서 8장 — 다시 공부하기로. “정죄함이 없나니”에 대한 생각.' },
  { label: 'Personal', text: '가족 일정: 주말 새 사무실 방문.' },
];

export default function JournalScreen() {
  const router = useRouter();

  return (
    <Screen>
      <Button
        variant="ghost"
        label="Journal"
        icon={<ChevronLeftIcon size={18} color={colors.accent} />}
        onPress={() => router.push('/memory')}
        style={styles.back}
        textStyle={{ fontSize: 12 }}
      />
      <Kicker style={{ color: colors.neutral600 }}>Auto-generated · Thursday</Kicker>
      <Text style={styles.title}>September 11, 2026</Text>

      <RuleThick />
      <View style={styles.stats}>
        {STATS.map((stat, i) => (
          <View
            key={stat.label}
            style={[
              styles.statCell,
              i > 0 && { paddingHorizontal: 8 },
              i < STATS.length - 1 && styles.statDivider,
            ]}
          >
            <Text style={styles.statValue}>{stat.value}</Text>
            <Kicker style={{ color: colors.neutral600 }}>{stat.label}</Kicker>
          </View>
        ))}
      </View>

      <View style={styles.today}>
        <Kicker style={{ color: colors.accent, marginBottom: 6 }}>Today</Kicker>
        <Text style={styles.todayText}>
          오늘은 새로운 AI 메모 앱의 구조를 주로 고민했다. 서비스 계약을 월 구독 형태로 확장하는
          방향을 정리했고, David와의 통화를 내일로 잡았다.
        </Text>
      </View>

      {SECTIONS.map((section) => (
        <View key={section.label} style={styles.section}>
          <Kicker style={{ color: colors.neutral600, marginBottom: 6 }}>{section.label}</Kicker>
          <Text style={styles.sectionText}>{section.text}</Text>
        </View>
      ))}

      <Text style={styles.footnote}>
        Built from 4 conversations · <Text style={{ color: colors.accent }}>View originals →</Text>
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingLeft: 0,
    marginLeft: -4,
  },
  title: {
    ...h2,
    marginTop: 4,
    marginBottom: 14,
  },
  stats: {
    flexDirection: 'row',
  },
  statCell: {
    flex: 1,
    paddingVertical: 10,
  },
  statDivider: {
    borderRightWidth: 1,
    borderRightColor: colors.divider,
  },
  statValue: {
    fontFamily: font.extrabold,
    fontSize: 26,
    lineHeight: 30,
    color: colors.text,
  },
  today: {
    borderTopWidth: 2,
    borderTopColor: colors.divider,
    paddingVertical: 12,
  },
  todayText: {
    fontFamily: font.regular,
    fontSize: 15,
    lineHeight: 23,
    color: colors.text,
  },
  section: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingVertical: 12,
  },
  sectionText: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
  },
  footnote: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral700,
    marginTop: 8,
  },
});
