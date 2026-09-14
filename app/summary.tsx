import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Button, CardKicker, Kicker, RuleThick, Tag } from '@/components/ui';
import { dismissToTabs } from '@/nav';
import { GUTTER, colors, font, h2 } from '@/theme';

const ENTRIES = [
  {
    kicker: 'Idea',
    topic: 'Business · Liflux',
    title: '서비스 계약 월 구독 모델',
    related: true,
  },
  {
    kicker: 'Task · Due tomorrow',
    topic: 'David',
    title: 'David에게 전화 — service contract',
  },
  {
    kicker: 'Task',
    topic: 'Faith · Bible Study',
    title: '로마서 8장 다시 공부',
  },
];

export default function SummaryScreen() {
  const router = useRouter();

  return (
    <Screen scroll={false} safeBottom>
      <Kicker style={{ color: colors.neutral600 }}>Saved · Sep 12, 8:14 AM</Kicker>
      <Text style={styles.title}>{'2 ideas, 2 tasks,\n1 needs review.'}</Text>

      <RuleThick />

      {ENTRIES.map((e) => (
        <View key={e.title} style={styles.entry}>
          <View style={styles.entryHead}>
            <CardKicker>{e.kicker}</CardKicker>
            <Tag variant="neutral">{e.topic}</Tag>
          </View>
          <Text style={styles.entryTitle}>{e.title}</Text>
          {e.related ? (
            <Text style={styles.entryMeta}>
              Related: Subscription Service Idea (Jun 4 →){' '}
              <Text style={styles.link} onPress={() => router.push('/thread')}>
                Thread →
              </Text>
            </Text>
          ) : null}
        </View>
      ))}

      <View style={styles.review}>
        <CardKicker>Possible action · needs review</CardKicker>
        <Text style={styles.entryTitle}>홈페이지 가격 변경</Text>
        <Text style={styles.reviewNote}>Website pricing을 변경할 계획이라고 언급했습니다.</Text>
        <View style={styles.reviewActions}>
          <Button label="Create task" style={{ minHeight: 40 }} />
          <Button variant="secondary" label="Keep as idea" style={{ minHeight: 40 }} />
        </View>
      </View>

      <Text style={styles.footnote}>
        Original transcript kept unchanged · <Text style={styles.link}>Source →</Text>
      </Text>

      <View style={styles.spacer} />

      <View style={styles.actions}>
        <Button
          label="Done"
          align="flex-start"
          onPress={dismissToTabs}
          style={styles.doneButton}
        />
        <Button
          variant="secondary"
          label="Keep talking"
          onPress={() => router.replace('/talk')}
          style={{ minHeight: 52 }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    ...h2,
    marginTop: 6,
    marginBottom: 14,
  },
  entry: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  entryHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  entryTitle: {
    fontFamily: font.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    marginTop: 4,
  },
  entryMeta: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral700,
    marginTop: 2,
  },
  link: {
    color: colors.accent,
  },
  review: {
    backgroundColor: colors.accent100,
    marginHorizontal: -GUTTER,
    paddingHorizontal: GUTTER,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  reviewNote: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral700,
    marginTop: 2,
    marginBottom: 8,
  },
  reviewActions: {
    flexDirection: 'row',
    gap: 8,
  },
  footnote: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral700,
    marginTop: 14,
  },
  spacer: {
    flex: 1,
    minHeight: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  doneButton: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: 16,
  },
});
