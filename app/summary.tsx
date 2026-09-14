import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Button, CardKicker, Kicker, RuleThick, Tag } from '@/components/ui';
import { dismissToTabs } from '@/nav';
import { useAuth } from '@/providers/AuthProvider';
import { assignMemoryTopic, listMemoriesBySession, type Memory } from '@/services/memories';
import { getSession, type Session } from '@/services/sessions';
import { assignTaskTopic, listTasksBySession, type Task } from '@/services/tasks';
import { confirmTopicSuggestion, listTopics, type Topic } from '@/services/topics';
import { colors, font, h2 } from '@/theme';

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

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const s = await getSession(sessionId);
        if (cancelled) return;
        setSession(s);

        if (s?.processing_status === 'done') {
          await loadResults();
          return;
        }
        if (s?.processing_status !== 'error') {
          timer = setTimeout(poll, 1500);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load this session.');
      }
    };
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

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
      {!sessionId ? (
        <>
          <Kicker style={{ color: colors.neutral600 }}>Saved</Kicker>
          <Text style={styles.title}>Recording saved.</Text>
        </>
      ) : loadError ? (
        <>
          <Kicker style={{ color: colors.accent700 }}>Couldn&apos;t load</Kicker>
          <Text style={styles.title}>{loadError}</Text>
        </>
      ) : processing ? (
        <View style={styles.processing}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.processingLabel}>
            {session?.processing_status === 'analyzing'
              ? 'Understanding what you said…'
              : 'Transcribing your recording…'}
          </Text>
        </View>
      ) : session?.processing_status === 'error' ? (
        <>
          <Kicker style={{ color: colors.accent700 }}>Couldn&apos;t process this recording</Kicker>
          <Text style={styles.title}>{session.processing_error ?? 'Something went wrong.'}</Text>
        </>
      ) : (
        <>
          <Kicker style={{ color: colors.neutral600 }}>Saved</Kicker>
          <Text style={styles.title}>
            {session?.summary || `${tasks.length} tasks, ${memories.length} ideas.`}
          </Text>
        </>
      )}

      <RuleThick />

      {!processing && entries.length > 0
        ? entries.map((e) => {
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
                        style={styles.suggestButton}
                        textStyle={{ fontSize: 12 }}
                      />
                      <Button
                        variant="secondary"
                        label="Pick topic"
                        disabled={busyEntryId === e.id}
                        onPress={() => setPicking(e)}
                        style={styles.suggestButton}
                        textStyle={{ fontSize: 12 }}
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })
        : !processing && !loadError && session?.processing_status === 'done' && (
            <Text style={styles.footnote}>
              Nothing to file as a task or idea — the full recording is still saved below.
            </Text>
          )}

      {!processing && !loadError && session?.raw_transcript ? (
        <View style={styles.transcriptBlock}>
          <Kicker style={{ color: colors.neutral600, marginBottom: 6 }}>Transcript</Kicker>
          <Text style={styles.transcriptText}>{session.raw_transcript}</Text>
        </View>
      ) : null}

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

      <Modal visible={picking !== null} transparent animationType="fade" onRequestClose={() => setPicking(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPicking(null)}>
          <Pressable style={styles.sheet} onPress={(ev) => ev.stopPropagation()}>
            <Text style={styles.sheetTitle}>Pick a topic</Text>
            {topics.length === 0 ? (
              <Text style={styles.footnote}>No topics yet.</Text>
            ) : (
              topics.map((t) => (
                <Button
                  key={t.id}
                  label={topicDisplayName(t, topics)}
                  align="flex-start"
                  variant="secondary"
                  onPress={() => picking && assignEntryTopic(picking, t.id)}
                  style={{ marginBottom: 8 }}
                />
              ))
            )}
            <Button label="Cancel" variant="ghost" align="flex-start" onPress={() => setPicking(null)} />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    ...h2,
    marginTop: 6,
    marginBottom: 14,
  },
  processing: {
    marginTop: 24,
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
    backgroundColor: colors.accent100,
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
  },
  footnote: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.neutral600,
    paddingVertical: 12,
  },
  transcriptBlock: {
    marginTop: 18,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 12,
  },
  transcriptText: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.neutral700,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  doneButton: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(32,30,29,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    padding: 20,
    paddingBottom: 32,
    borderTopWidth: 2,
    borderTopColor: colors.divider,
    maxHeight: '80%',
  },
  sheetTitle: {
    fontFamily: font.extrabold,
    fontSize: 18,
    color: colors.text,
    marginBottom: 14,
  },
});
