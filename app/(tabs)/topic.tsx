import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ChevronLeftIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, CardKicker, Row, RuleThick, Tag } from '@/components/ui';
import { useApp } from '@/store';
import { colors, font, h2 } from '@/theme';

/** Timeline structure from variation 1k: pinned summary, tag counts, dated entries. */
const ENTRIES: {
  date: string;
  kicker: string;
  title: string;
  meta?: React.ReactNode;
  thread?: boolean;
}[] = [
  {
    date: 'Sep 8',
    kicker: 'Conversation',
    title: 'Onboarding 단계 축소',
    meta: (
      <>
        1 idea · 1 open question · <Text style={{ color: colors.accent700 }}>Source →</Text>
      </>
    ),
  },
  {
    date: 'Aug 22',
    kicker: 'Decision',
    title: 'Basic Plan → 1 Organization',
    meta: <Text style={{ color: colors.accent700 }}>Source →</Text>,
  },
  {
    date: 'Aug 5',
    kicker: 'Conversation',
    title: 'Billing model 수정',
    meta: <>Subscription Service Idea 업데이트 · Thread →</>,
    thread: true,
  },
  {
    date: 'Jul 12',
    kicker: 'Idea · Paused',
    title: 'Migration Wizard',
  },
  {
    date: 'Jun 4',
    kicker: 'Idea · Considering',
    title: 'Subscription service — initial',
    meta: <>5 mentions · Thread →</>,
    thread: true,
  },
];

export default function TopicScreen() {
  const router = useRouter();
  const { startSession } = useApp();

  return (
    <Screen>
      <Button
        variant="ghost"
        label="Business"
        icon={<ChevronLeftIcon size={18} color={colors.accent} />}
        onPress={() => router.push('/memory')}
        style={styles.back}
        textStyle={{ fontSize: 12 }}
      />
      <Text style={styles.title}>JoaSuite</Text>

      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          JoaSuite는 B2B SaaS. 최근 방향은 onboarding 단순화와 구독 과금 모델 정리. Basic 플랜
          범위는 확정됐고, 가격 정책은 아직 열려 있음.
        </Text>
      </View>
      <Text style={styles.summaryMeta}>AI summary · 12 conversations · updated Sep 8</Text>

      <View style={styles.tags}>
        <Tag variant="accent">2 decisions</Tag>
        <Tag variant="neutral">4 ideas</Tag>
        <Tag variant="neutral">1 question</Tag>
        <Tag variant="neutral">1 task</Tag>
      </View>

      <RuleThick />
      {ENTRIES.map((entry) => (
        <Row
          key={entry.date}
          onPress={entry.thread ? () => router.push('/thread') : undefined}
          style={styles.entry}
        >
          <Text style={styles.date}>{entry.date}</Text>
          <View style={styles.entryBody}>
            <CardKicker>{entry.kicker}</CardKicker>
            <Text style={styles.entryTitle}>{entry.title}</Text>
            {entry.meta ? <Text style={styles.entryMeta}>{entry.meta}</Text> : null}
          </View>
        </Row>
      ))}

      <Button
        label="Continue this conversation"
        align="flex-start"
        onPress={() => {
          startSession();
          router.push('/talk');
        }}
        style={styles.continue}
      />
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
    marginTop: 2,
    marginBottom: 10,
  },
  summary: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingLeft: 12,
    marginBottom: 6,
  },
  summaryText: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
  },
  summaryMeta: {
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 16,
    color: colors.neutral600,
    paddingLeft: 14,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
    marginBottom: 16,
  },
  entry: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  date: {
    width: 56,
    fontFamily: font.extrabold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.neutral700,
  },
  entryBody: {
    flex: 1,
  },
  entryTitle: {
    fontFamily: font.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  entryMeta: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral700,
  },
  continue: {
    minHeight: 52,
    marginTop: 14,
    paddingHorizontal: 16,
  },
});
