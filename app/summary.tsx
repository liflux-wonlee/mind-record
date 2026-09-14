import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Button, CardKicker, Kicker, RuleThick, Tag } from '@/components/ui';
import { dismissToTabs } from '@/nav';
import { listMemoriesBySession, type Memory } from '@/services/memories';
import { getSession, type Session } from '@/services/sessions';
import { listTasksBySession, type Task } from '@/services/tasks';
import { listSessionTopics, type Topic } from '@/services/topics';
import { colors, font, h2 } from '@/theme';

type Entry = { kicker: string; title: string };

/**
 * The transcribe-then-analyze pipeline (supabase/functions/process-session)
 * runs in the background after a recording ends — this screen polls
 * `sessions.processing_status` rather than pretending the result is
 * instant, and renders the real extracted tasks/ideas once it's done.
 */
export default function SummaryScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();

  const [session, setSession] = useState<Session | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

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
          const [t, m, tp] = await Promise.all([
            listTasksBySession(sessionId),
            listMemoriesBySession(sessionId),
            listSessionTopics(sessionId),
          ]);
          if (cancelled) return;
          setTasks(t);
          setMemories(m);
          setTopics(tp);
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
  }, [sessionId]);

  const entries: Entry[] = [
    ...tasks.map((t) => ({ kicker: 'Task', title: t.title })),
    ...memories.map((m) => ({ kicker: 'Idea', title: m.content })),
  ];
  const topicLabel = topics.map((t) => t.name).join(' · ');
  const processing =
    !!sessionId && session?.processing_status !== 'done' && session?.processing_status !== 'error';

  return (
    <Screen scroll={false} safeBottom>
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
        ? entries.map((e, i) => (
            <View key={`${e.kicker}-${i}`} style={styles.entry}>
              <View style={styles.entryHead}>
                <CardKicker>{e.kicker}</CardKicker>
                {topicLabel ? <Tag variant="neutral">{topicLabel}</Tag> : null}
              </View>
              <Text style={styles.entryTitle}>{e.title}</Text>
            </View>
          ))
        : !processing && !loadError && session?.processing_status === 'done' && (
            <Text style={styles.footnote}>No tasks or ideas found in this recording.</Text>
          )}

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
  footnote: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.neutral600,
    paddingVertical: 12,
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
