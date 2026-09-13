import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Waveform } from '@/components/Waveform';
import { Button, CardKicker, Kicker, Tag } from '@/components/ui';
import { dismissToTabs } from '@/nav';
import { useApp } from '@/store';
import { colors, font } from '@/theme';

/** The three transcript lines the prototype reveals, one every three seconds. */
const TRANSCRIPT = [
  {
    text: '생각해보니까 우리 회사 서비스 계약을 월 구독 형태로 더 만들어야 될 것 같아.',
    type: 'IDEA',
    topic: 'Business · Liflux',
  },
  {
    text: '그리고 David한테 내일까지 전화해야겠다.',
    type: 'TASK · TOMORROW',
    topic: 'David',
  },
  {
    text: '아 그리고 아침에 읽은 로마서 8장 내용도 다시 한번 공부해봐야 될 것 같아.',
    type: 'TASK',
    topic: 'Faith · Bible Study',
  },
];

export default function TalkScreen() {
  const router = useRouter();
  const {
    mode,
    setMode,
    recording,
    everRecorded,
    saveOnly,
    toggleSaveOnly,
    related,
    setRelated,
    toggleRecording,
    lines,
    timer,
  } = useApp();

  const onToggleRecording = () => {
    const stopped = toggleRecording();
    if (stopped) router.replace('/summary');
  };

  const aiText = saveOnly
    ? '알겠습니다. 저장만 하겠습니다.'
    : mode === 'capture'
      ? '네, 말씀하세요.'
      : '비슷한 아이디어를 전에 이야기했습니다 — Jun 4 Subscription Service Idea. 둘을 연결할까요?';

  const showAi =
    (everRecorded && !saveOnly && lines >= 1 && mode === 'conv') || (everRecorded && lines === 0);
  const showRelated = mode === 'conv' && lines >= 1 && related !== 'dismissed';

  return (
    <Screen scroll={false} safeBottom>
      <View style={styles.head}>
        <View style={styles.seg}>
          <SegOption
            label="Capture"
            selected={mode === 'capture'}
            onPress={() => setMode('capture')}
          />
          <SegOption
            label="Conversation"
            selected={mode === 'conv'}
            onPress={() => setMode('conv')}
            divided
          />
        </View>
        <Button
          variant="ghost"
          label="Save only"
          onPress={toggleSaveOnly}
          style={{ minHeight: 44, justifyContent: 'center' }}
          textStyle={{
            fontSize: 11,
            letterSpacing: 11 * 0.08,
            textTransform: 'uppercase',
            color: saveOnly ? colors.accent : colors.neutral600,
          }}
        />
      </View>

      <View style={styles.statusRow}>
        <Kicker style={{ color: recording ? colors.accent : colors.neutral600 }}>
          {recording ? '● Listening' : everRecorded ? 'Paused' : 'Ready'}
        </Kicker>
        <Text style={styles.timer}>{timer}</Text>
      </View>

      <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent}>
        {!everRecorded ? (
          <Text style={styles.idle}>
            말씀하세요. 주제를 나눌 필요 없이 한 번에 이야기하셔도 됩니다.
          </Text>
        ) : null}

        {TRANSCRIPT.slice(0, lines).map((line) => (
          <View key={line.text}>
            <Text style={styles.line}>{line.text}</Text>
            <View style={styles.tagRow}>
              <Tag variant="accent">{line.type}</Tag>
              <Tag variant="neutral">{line.topic}</Tag>
            </View>
          </View>
        ))}

        {showAi ? (
          <View style={styles.aiBlock}>
            <Kicker style={{ color: colors.accent700, marginBottom: 4 }}>AI</Kicker>
            <Text style={styles.aiText}>{aiText}</Text>

            {showRelated ? (
              <>
                <View style={styles.relatedCard}>
                  <View style={styles.flexShrink}>
                    <CardKicker>Idea · Considering</CardKicker>
                    <Text style={styles.relatedTitle}>Subscription Service Idea</Text>
                  </View>
                  <Button
                    variant="ghost"
                    label="Source →"
                    onPress={() => router.push('/thread')}
                    style={{ minHeight: 40, justifyContent: 'center' }}
                    textStyle={{ fontSize: 11 }}
                  />
                </View>
                <View style={styles.relatedActions}>
                  <Button
                    label={related === 'linked' ? 'Linked ✓' : 'Link them'}
                    onPress={() => setRelated('linked')}
                    style={{ minHeight: 40 }}
                  />
                  <Button
                    variant="secondary"
                    label="Keep separate"
                    onPress={() => setRelated('dismissed')}
                    style={{ minHeight: 40 }}
                  />
                </View>
              </>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <Waveform active={recording} />

      <View style={styles.controls}>
        <Button
          label={recording ? 'Listening… tap to stop' : everRecorded ? 'Resume' : 'Start talking'}
          onPress={onToggleRecording}
          align="flex-start"
          style={[
            styles.micButton,
            { backgroundColor: recording ? colors.neutral900 : colors.accent },
          ]}
          textStyle={{ fontSize: 16 }}
        />
        <Button
          variant="secondary"
          label="End"
          onPress={dismissToTabs}
          style={styles.endButton}
        />
      </View>
    </Screen>
  );
}

function SegOption({
  label,
  selected,
  onPress,
  divided,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  divided?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.segOpt,
        divided && styles.segDivider,
        selected && { backgroundColor: colors.accent },
      ]}
    >
      <Text style={[styles.segText, selected && { color: colors.bg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  seg: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: 'hidden',
  },
  segOpt: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  segDivider: {
    borderLeftWidth: 1,
    borderLeftColor: colors.divider,
  },
  segText: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.text,
  },
  statusRow: {
    marginTop: 22,
    borderTopWidth: 2,
    borderTopColor: colors.divider,
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  timer: {
    fontFamily: font.extrabold,
    fontSize: 28,
    letterSpacing: 28 * -0.02,
    color: colors.text,
  },
  transcript: {
    flex: 1,
    marginTop: 14,
  },
  transcriptContent: {
    gap: 14,
    paddingBottom: 8,
  },
  idle: {
    fontFamily: font.regular,
    fontSize: 17,
    lineHeight: 25.5,
    color: colors.neutral600,
  },
  line: {
    fontFamily: font.regular,
    fontSize: 17,
    lineHeight: 25.5,
    color: colors.text,
    marginBottom: 6,
  },
  tagRow: {
    flexDirection: 'row',
    gap: 6,
  },
  aiBlock: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingVertical: 4,
    paddingLeft: 12,
  },
  aiText: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.neutral800,
  },
  relatedCard: {
    backgroundColor: colors.surface,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  flexShrink: {
    flexShrink: 1,
  },
  relatedTitle: {
    fontFamily: font.semibold,
    fontSize: 14,
    color: colors.text,
  },
  relatedActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  controls: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  micButton: {
    flex: 1,
    minHeight: 64,
    paddingHorizontal: 16,
  },
  endButton: {
    minHeight: 64,
    minWidth: 64,
  },
});
