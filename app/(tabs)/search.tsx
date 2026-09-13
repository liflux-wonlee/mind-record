import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { MicIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, Kicker, Row, RuleThick, Tag } from '@/components/ui';
import { useApp } from '@/store';
import { colors, font, h2 } from '@/theme';

const SOURCES: { title: string; meta: string; to: '/thread' | '/topic' | '/memory' }[] = [
  { title: 'Subscription service', meta: '5 mentions · Jun–Sep', to: '/thread' },
  { title: 'Migration Wizard', meta: '2 mentions · Jul', to: '/topic' },
  { title: 'AI onboarding assistant', meta: '1 mention · May', to: '/memory' },
];

export default function SearchScreen() {
  const router = useRouter();
  const { startSession } = useApp();
  const [query, setQuery] = useState('');

  return (
    <Screen scroll={false}>
      <Kicker style={{ color: colors.neutral600 }}>Search</Kicker>
      <Text style={styles.title}>Ask my memory</Text>

      <View style={styles.filters}>
        <Tag variant="outline">Business</Tag>
        <Tag variant="neutral">Idea</Tag>
        <Tag variant="neutral">Last 3 months</Tag>
        <Tag variant="neutral">Open</Tag>
      </View>

      <RuleThick />
      <View style={styles.questionBox}>
        <Text style={styles.question}>아직 실행하지 않은 사업 아이디어는?</Text>
      </View>

      <View style={styles.answer}>
        <Kicker style={{ color: colors.accent, marginBottom: 4 }}>AI</Kicker>
        <Text style={styles.answerText}>
          지난 3개월 동안 사업 아이디어 6개 중 3개가 아직 Task로 만들어지지 않았습니다.
        </Text>
        {SOURCES.map((source, i) => (
          <Row
            key={source.title}
            onPress={() => router.push(source.to)}
            style={[styles.sourceRow, i === SOURCES.length - 1 && styles.sourceRowLast]}
          >
            <Text style={styles.sourceTitle}>{source.title}</Text>
            <Text style={styles.sourceMeta}>{source.meta}</Text>
          </Row>
        ))}
        <Text style={styles.answerNote}>
          Marketing 아이디어는 두 달간 5번 언급됐지만 Task는 없습니다.
        </Text>
      </View>

      <View style={styles.spacer} />

      <View style={styles.askRow}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Ask anything about your memory"
          placeholderTextColor={colors.neutral600}
        />
        <Button
          accessibilityLabel="voice"
          onPress={() => {
            startSession();
            router.push('/talk');
          }}
          icon={<MicIcon size={22} color={colors.bg} />}
          style={styles.voiceButton}
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
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14,
  },
  questionBox: {
    paddingVertical: 12,
  },
  question: {
    fontFamily: font.semibold,
    fontSize: 16,
    lineHeight: 24,
    color: colors.text,
  },
  answer: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingVertical: 4,
    paddingLeft: 12,
  },
  answerText: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
    marginBottom: 8,
  },
  sourceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingVertical: 8,
  },
  sourceRowLast: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  sourceTitle: {
    fontFamily: font.semibold,
    fontSize: 14,
    color: colors.text,
  },
  sourceMeta: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral600,
  },
  answerNote: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral700,
    marginTop: 8,
  },
  spacer: {
    flex: 1,
    minHeight: 14,
  },
  askRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  voiceButton: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
});
