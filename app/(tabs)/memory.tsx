import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Button, CardKicker, Kicker, Row, RuleThick } from '@/components/ui';
import { colors, font, h2 } from '@/theme';

const TOPICS = [
  { category: 'Business', name: 'JoaSuite', meta: '42 entries · Sep 8' },
  { category: 'Business', name: 'Liflux', meta: '31 entries · Sep 12' },
  { category: 'Faith', name: 'Bible Study', meta: '18 entries · Sep 12' },
  { category: 'Personal', name: 'Family', meta: '9 entries · Sep 10' },
];

const THREADS = [
  { title: 'Subscription Service Idea', meta: '5 · Jun 4 → Sep 11' },
  { title: 'Migration Wizard', meta: '2 · paused' },
];

export default function MemoryScreen() {
  const router = useRouter();

  return (
    <Screen>
      <Kicker style={{ color: colors.neutral600 }}>Memory</Kicker>
      <Text style={styles.title}>Topics</Text>

      <RuleThick />
      <View style={styles.grid}>
        {TOPICS.map((topic, i) => (
          <Row
            key={topic.name}
            onPress={() => router.push('/topic')}
            style={[styles.cell, i % 2 === 0 ? styles.cellLeft : styles.cellRight]}
          >
            <Kicker style={{ color: colors.neutral600 }}>{topic.category}</Kicker>
            <Text style={styles.topicName}>{topic.name}</Text>
            <Text style={styles.topicMeta}>{topic.meta}</Text>
          </Row>
        ))}
      </View>

      <Kicker style={{ color: colors.neutral600, marginTop: 20 }}>Idea threads</Kicker>
      <RuleThick style={{ marginTop: 6 }} />
      {THREADS.map((thread) => (
        <Row key={thread.title} onPress={() => router.push('/thread')} style={styles.listRow}>
          <Text style={styles.listTitle}>{thread.title}</Text>
          <Text style={styles.listMeta}>{thread.meta}</Text>
        </Row>
      ))}

      <Kicker style={{ color: colors.neutral600, marginTop: 20 }}>Journal</Kicker>
      <RuleThick style={{ marginTop: 6 }} />
      <Row onPress={() => router.push('/journal')} style={styles.listRow}>
        <Text style={styles.listTitle}>September 11, 2026</Text>
        <Text style={styles.listMeta}>auto-generated</Text>
      </Row>

      <View style={styles.rediscover}>
        <CardKicker>Rediscover</CardKicker>
        <Text style={styles.rediscoverTitle}>AI-based customer onboarding assistant</Text>
        <Text style={styles.rediscoverNote}>
          4개월 전에 이야기했지만 다시 언급하지 않은 아이디어입니다.
        </Text>
        <View style={styles.rediscoverActions}>
          <Button variant="secondary" label="Revisit" style={{ minHeight: 40 }} />
          <Button variant="ghost" label="Archive" style={{ minHeight: 40 }} />
        </View>
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: '50%',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  cellLeft: {
    paddingRight: 12,
    borderRightWidth: 1,
    borderRightColor: colors.divider,
  },
  cellRight: {
    paddingLeft: 12,
  },
  topicName: {
    fontFamily: font.extrabold,
    fontSize: 20,
    lineHeight: 24,
    color: colors.text,
    marginTop: 2,
  },
  topicMeta: {
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 16,
    color: colors.neutral700,
    marginTop: 4,
  },
  listRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  listTitle: {
    fontFamily: font.semibold,
    fontSize: 15,
    color: colors.text,
  },
  listMeta: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral600,
  },
  rediscover: {
    marginTop: 20,
    backgroundColor: colors.accent100,
    padding: 12,
  },
  rediscoverTitle: {
    fontFamily: font.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    marginTop: 4,
  },
  rediscoverNote: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral700,
    marginTop: 2,
    marginBottom: 8,
  },
  rediscoverActions: {
    flexDirection: 'row',
    gap: 8,
  },
});
