import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { CopyIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, CardKicker, Kicker, RuleThick, Tag } from '@/components/ui';
import { dismissToTabs } from '@/nav';
import { useAuth } from '@/providers/AuthProvider';
import { assignMemoryTopic, listMemoriesBySession, type Memory } from '@/services/memories';
import { processSession } from '@/services/processing';
import { getSession, type Session } from '@/services/sessions';
import { assignTaskTopic, listTasksBySession, type Task } from '@/services/tasks';
import { confirmTopicSuggestion, listTopics, type Topic } from '@/services/topics';
import { colors, font, radius } from '@/theme';

/** Renders `**bold**` spans within an outline bullet or the transcript is never bolded, only bullets are. */
function renderInlineBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <Text key={i} style={styles.bold}>
        {part.slice(2, -2)}
      </Text>
    ) : (
      part
    )
  );
}

// Transcription of a long capture plus the GPT pass can take a couple of
// minutes; past this the Edge Function has almost certainly been killed.
const PROCESSING_TIMEOUT_MS = 4 * 60 * 1000;

type EntryKind = 'task' | 'memory';
type Entry = {
  id: string;
  kind: EntryKind;
  kicker: string;
  title: string;
  topicId: string | null;
  topicSuggestion: string | null;
};

function topicDisplayName(topic: Topic, all: Topic[]): string {
  if (!topic.parent_topic_id) return topic.name;
  const parent = all.find((t) => t.id === topic.parent_topic_id);
  return parent ? `${parent.name} · ${topic.name}` : topic.name;
}

function TabOption({
  label,
  selected,
  onPress,
  color,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  color: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.tabOpt, { backgroundColor: color }, selected ? styles.tabOptSelected : { opacity: 0.55 }]}
    >
      <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text>
    </Pressable>
  );
}

// Rotates through the pastel set so no two neighbouring topic buttons in
// the picker share a color.
const PICKER_COLORS = [
  colors.pastelGreen,
  colors.pastelBlue,
  colors.pastelPeach,
  colors.pastelLavender,
  colors.pastelYellow,
  colors.pastelPink,
];

/**
 * The transcribe-then-analyze pipeline (supabase/functions/process-session)
 * runs in the background after a recording ends — this screen polls
 * `sessions.processing_status` rather than pretending the result is
 * instant, and renders the real extracted tasks/ideas once it's done.
 *
 * Each task/idea carries its own AI-assigned topic (or, when the AI wasn't
 * confident, a `topic_suggestion` the user confirms or overrides here —
 * "물어보는 식으로 처리" from the topic-hierarchy request, done as a
 * deterministic confirm step rather than a live voice conversation).
 */
export default function SummaryScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();

  const [session, setSession] = useState<Session | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picking, setPicking] = useState<Entry | null>(null);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [tab, setTab] = useState<'summary' | 'transcript'>('summary');
  const [copied, setCopied] = useState(false);

  const copyTranscript = async () => {
    if (!session?.raw_transcript) return;
    await Clipboard.setStringAsync(session.raw_transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const loadResults = useCallback(async () => {
    if (!sessionId || !user) return;
    const [t, m, tp] = await Promise.all([
      listTasksBySession(sessionId),
      listMemoriesBySession(sessionId),
      listTopics(user.id),
    ]);
    setTasks(t);
    setMemories(m);
    setTopics(tp);
  }, [sessionId, user]);

  // Bumped by "Retry" to restart the poll (and re-kick processing).
  const [pollRun, setPollRun] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let consecutiveFailures = 0;
    const startedAt = Date.now();
    setLoadError(null);

    const poll = async () => {
      try {
        const s = await getSession(sessionId);
        if (cancelled) return;
        if (!s) throw new Error('This recording no longer exists.');
        setSession(s);
        consecutiveFailures = 0;

        if (s.processing_status === 'done') {
          await loadResults();
          return;
        }
        if (s.processing_status === 'error') return;
        // Nothing legitimately takes this long -- the Edge Function was
        // most likely killed mid-way (it can't mark the row 'error' then),
        // so stop spinning and offer a retry instead of polling forever.
        if (Date.now() - startedAt > PROCESSING_TIMEOUT_MS) {
          throw new Error('Processing is taking too long. Tap Retry to try again.');
        }
        timer = setTimeout(poll, 1500);
      } catch (e) {
        if (cancelled) return;
        // One flaky request shouldn't end the poll for good.
        consecutiveFailures += 1;
        if (consecutiveFailures < 3 && Date.now() - startedAt <= PROCESSING_TIMEOUT_MS) {
          timer = setTimeout(poll, 2500);
          return;
        }
        setLoadError(e instanceof Error ? e.message : 'Could not load this session.');
      }
    };
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, pollRun]);

  const retryProcessing = () => {
    if (!sessionId) return;
    processSession(sessionId).catch(() => {
      // The poll below surfaces whatever state the row ends up in.
    });
    setPollRun((n) => n + 1);
  };

  const entries: Entry[] = [
    ...tasks.map((t) => ({
      id: t.id,
      kind: 'task' as const,
      kicker: 'Task',
      title: t.title,
      topicId: t.topic_id,
      topicSuggestion: t.topic_suggestion,
    })),
    ...memories.map((m) => ({
      id: m.id,
      kind: 'memory' as const,
      kicker: 'Idea',
      title: m.content,
      topicId: m.topic_id,
      topicSuggestion: m.topic_suggestion,
    })),
  ];
  const processing =
    !!sessionId && session?.processing_status !== 'done' && session?.processing_status !== 'error';
  const done = !!sessionId && !loadError && session?.processing_status === 'done';

  const assignEntryTopic = async (entry: Entry, topicId: string) => {
    setBusyEntryId(entry.id);
    try {
      if (entry.kind === 'task') {
        await assignTaskTopic(entry.id, topicId);
      } else {
        await assignMemoryTopic(entry.id, topicId);
      }
      await loadResults();
      setPicking(null);
    } catch {
      // Leave the suggestion in place -- the user can just try again.
    } finally {
      setBusyEntryId(null);
    }
  };

  const useSuggestion = async (entry: Entry) => {
    if (!user || !entry.topicSuggestion) return;
    setBusyEntryId(entry.id);
    try {
      const topic = await confirmTopicSuggestion(user.id, topics, entry.topicSuggestion);
      await assignEntryTopic(entry, topic.id);
    } catch {
      setBusyEntryId(null);
    }
  };

  return (
    <Screen safeBottom>
      {done ? (
        <View style={styles.tabRow}>
          <TabOption
            label="Summary"
            color={colors.pastelPeach}
            selected={tab === 'summary'}
            onPress={() => setTab('summary')}
          />
          <TabOption
            label="Transcript"
            color={colors.pastelBlue}
            selected={tab === 'transcript'}
            onPress={() => setTab('transcript')}
          />
        </View>
      ) : null}

      {!sessionId ? (
        <View style={styles.summaryCard}>
          <Kicker style={{ color: colors.neutral700 }}>Saved</Kicker>
          <Text style={styles.summaryText}>Recording saved.</Text>
        </View>
      ) : loadError ? (
        <View style={[styles.summaryCard, { backgroundColor: colors.pastelPink }]}>
          <Kicker style={{ color: colors.accent700 }}>Couldn&apos;t load</Kicker>
          <Text style={styles.summaryText}>{loadError}</Text>
          <Button
            label="Retry"
            onPress={retryProcessing}
            style={[styles.retryButton, { backgroundColor: colors.pastelYellow }]}
            textStyle={styles.pastelText}
          />
        </View>
      ) : processing ? (
        <View style={[styles.summaryCard, styles.processing]}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.processingLabel}>
            {session?.processing_status === 'analyzing'
              ? 'Understanding what you said…'
              : 'Transcribing your recording…'}
          </Text>
        </View>
      ) : session?.processing_status === 'error' ? (
        <View style={[styles.summaryCard, { backgroundColor: colors.pastelPink }]}>
          <Kicker style={{ color: colors.accent700 }}>Couldn&apos;t process this recording</Kicker>
          <Text style={styles.summaryText}>{session.processing_error ?? 'Something went wrong.'}</Text>
          <Button
            label="Retry"
            onPress={retryProcessing}
            style={[styles.retryButton, { backgroundColor: colors.pastelYellow }]}
            textStyle={styles.pastelText}
          />
        </View>
      ) : tab === 'summary' ? (
        <View style={styles.summaryCard}>
          <Kicker style={{ color: colors.neutral700 }}>Summary</Kicker>
          <Text style={styles.summaryText}>
            {session?.summary || `${tasks.length} tasks, ${memories.length} ideas.`}
          </Text>
        </View>
      ) : null}

      {done ? <RuleThick /> : null}

      {!done ? null : tab === 'summary' ? (
        <>
          {(session?.outline ?? []).map((section, i) => (
            <View key={i} style={styles.outlineSection}>
              <Text style={styles.outlineHeading}>{section.heading}</Text>
              {section.bullets.map((bullet, j) => (
                <Text key={j} style={styles.outlineBullet}>
                  {'•  '}
                  {renderInlineBold(bullet)}
                </Text>
              ))}
            </View>
          ))}

          {entries.length > 0 ? (
            <>
              <Kicker style={{ color: colors.neutral600, marginTop: 8, marginBottom: 4 }}>
                Tasks &amp; ideas
              </Kicker>
              {entries.map((e) => {
                const topic = e.topicId ? topics.find((t) => t.id === e.topicId) : undefined;
                return (
                  <View key={`${e.kind}-${e.id}`} style={styles.entry}>
                    <View style={styles.entryHead}>
                      <CardKicker>{e.kicker}</CardKicker>
                      {topic ? <Tag variant="neutral">{topicDisplayName(topic, topics)}</Tag> : null}
                    </View>
                    <Text style={styles.entryTitle}>{e.title}</Text>
                    {!topic && e.topicSuggestion ? (
                      <View style={styles.suggestRow}>
                        <Text style={styles.suggestText}>
                          AI thinks this belongs under &quot;{e.topicSuggestion}&quot;
                        </Text>
                        <View style={styles.suggestActions}>
                          <Button
                            label={busyEntryId === e.id ? 'Saving…' : `Use "${e.topicSuggestion}"`}
                            disabled={busyEntryId === e.id}
                            onPress={() => useSuggestion(e)}
                            style={[styles.suggestButton, { backgroundColor: colors.pastelGreen }]}
                            textStyle={styles.pastelSmallText}
                          />
                          <Button
                            label="Pick topic"
                            disabled={busyEntryId === e.id}
                            onPress={() => setPicking(e)}
                            style={[styles.suggestButton, { backgroundColor: colors.pastelLavender }]}
                            textStyle={styles.pastelSmallText}
                          />
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </>
          ) : (session?.outline ?? []).length === 0 ? (
            <Text style={styles.footnote}>
              Nothing to file as a task or idea — tap Transcript to see the full recording.
            </Text>
          ) : null}
        </>
      ) : session?.raw_transcript ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy transcript"
            onPress={copyTranscript}
            style={styles.copyButton}
            hitSlop={8}
          >
            <CopyIcon size={16} color={colors.neutral700} />
            <Text style={styles.copyButtonText}>{copied ? 'Copied' : 'Copy'}</Text>
          </Pressable>
          <Text style={styles.transcriptText}>{session.raw_transcript}</Text>
        </>
      ) : (
        <Text style={styles.footnote}>No speech was detected in this recording.</Text>
      )}

      <View style={styles.actions}>
        <Button
          label="Done"
          onPress={dismissToTabs}
          style={[styles.actionButton, { backgroundColor: colors.pastelGreen }]}
          textStyle={styles.pastelText}
        />
        <Button
          label="Keep talking"
          onPress={() => router.replace('/talk')}
          style={[styles.actionButton, { backgroundColor: colors.pastelLavender }]}
          textStyle={styles.pastelText}
        />
      </View>

      <BottomSheet visible={picking !== null} onClose={() => setPicking(null)} title="Pick a topic">
            {topics.length === 0 ? (
              <Text style={styles.footnote}>No topics yet.</Text>
            ) : (
              topics.map((t, i) => (
                <Button
                  key={t.id}
                  label={topicDisplayName(t, topics)}
                  align="flex-start"
                  onPress={() => picking && assignEntryTopic(picking, t.id)}
                  style={{
                    marginBottom: 8,
                    borderRadius: radius.pastel,
                    backgroundColor: PICKER_COLORS[i % PICKER_COLORS.length],
                  }}
                  textStyle={styles.pastelText}
                />
              ))
            )}
            <Button label="Cancel" variant="ghost" align="flex-start" onPress={() => setPicking(null)} />
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    borderRadius: radius.pastel,
    padding: 16,
    backgroundColor: colors.pastelYellow,
    marginTop: 16,
    marginBottom: 14,
  },
  summaryText: {
    fontFamily: font.semibold,
    fontSize: 19,
    lineHeight: 26,
    color: colors.text,
    marginTop: 6,
  },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: 12,
    minHeight: 40,
    borderRadius: radius.pastel,
  },
  processing: {
    backgroundColor: colors.pastelBlue,
    alignItems: 'flex-start',
    gap: 12,
  },
  processingLabel: {
    fontFamily: font.regular,
    fontSize: 15,
    color: colors.neutral700,
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
  suggestRow: {
    marginTop: 8,
    backgroundColor: colors.pastelPeach,
    borderRadius: radius.pastel,
    padding: 10,
  },
  suggestText: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral800,
  },
  suggestActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  suggestButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: radius.pastel,
  },
  pastelText: {
    color: colors.text,
  },
  pastelSmallText: {
    color: colors.text,
    fontSize: 12,
  },
  footnote: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.neutral600,
    paddingVertical: 12,
  },
  outlineSection: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  outlineHeading: {
    fontFamily: font.extrabold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
    marginBottom: 6,
  },
  outlineBullet: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
    marginBottom: 4,
  },
  bold: {
    fontFamily: font.semibold,
    color: colors.text,
  },
  copyButton: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    alignItems: 'center',
    gap: 5,
    minHeight: 32,
    paddingHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: radius.pastel,
    backgroundColor: colors.pastelLavender,
  },
  copyButtonText: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: colors.neutral700,
  },
  tabRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    gap: 8,
  },
  tabOpt: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: radius.pastel,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tabOptSelected: {
    borderColor: colors.accent800,
  },
  tabText: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.text,
  },
  tabTextSelected: {
    fontFamily: font.extrabold,
  },
  transcriptText: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.neutral700,
    paddingVertical: 12,
  },
  // marginTop: 'auto' inside Screen's flexGrow:1 scroll content pins this
  // row to the bottom of the viewport when the content is short, and lets
  // it trail the content normally once there's enough to scroll.
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 'auto',
    paddingTop: 24,
  },
  actionButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.pastel,
  },
});
