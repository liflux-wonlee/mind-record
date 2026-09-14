import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Button, CardKicker, Kicker, RuleThick } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import { assignMemoryTopic, listMemoriesPendingTopicReview } from '@/services/memories';
import { assignTaskTopic, listTasksPendingTopicReview } from '@/services/tasks';
import { confirmTopicSuggestion, listTopics, type Topic } from '@/services/topics';
import { colors, font, h2 } from '@/theme';

type EntryKind = 'task' | 'memory';
type Entry = {
  id: string;
  kind: EntryKind;
  kicker: string;
  title: string;
  topicSuggestion: string;
};

function topicDisplayName(topic: Topic, all: Topic[]): string {
  if (!topic.parent_topic_id) return topic.name;
  const parent = all.find((t) => t.id === topic.parent_topic_id);
  return parent ? `${parent.name} · ${topic.name}` : topic.name;
}

/**
 * The real "AI wasn't confident about this topic" review queue -- every
 * task/idea here has `topic_id === null` and a non-null `topic_suggestion`
 * (see listTasksPendingTopicReview / listMemoriesPendingTopicReview).
 * Confirming here mirrors app/summary.tsx's confirm-flow exactly, via the
 * shared confirmTopicSuggestion() find-or-create helper.
 */
export default function InboxScreen() {
  const { user } = useAuth();

  const [entries, setEntries] = useState<Entry[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<Entry | null>(null);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      setLoading(true);
      setError(null);

      Promise.all([
        listTasksPendingTopicReview(user.id),
        listMemoriesPendingTopicReview(user.id),
        listTopics(user.id),
      ])
        .then(([pendingTasks, pendingMemories, tp]) => {
          if (cancelled) return;
          const combined: Entry[] = [
            ...pendingTasks
              .filter((t) => !!t.topic_suggestion)
              .map((t) => ({
                id: t.id,
                kind: 'task' as const,
                kicker: 'Task',
                title: t.title,
                topicSuggestion: t.topic_suggestion as string,
              })),
            ...pendingMemories
              .filter((m) => !!m.topic_suggestion)
              .map((m) => ({
                id: m.id,
                kind: 'memory' as const,
                kicker: 'Idea',
                title: m.content,
                topicSuggestion: m.topic_suggestion as string,
              })),
          ];
          setEntries(combined);
          setTopics(tp);
        })
        .catch((e) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : 'Could not load your inbox.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }, [user])
  );

  const assignEntryTopic = async (entry: Entry, topicId: string) => {
    setBusyEntryId(entry.id);
    try {
      if (entry.kind === 'task') {
        await assignTaskTopic(entry.id, topicId);
      } else {
        await assignMemoryTopic(entry.id, topicId);
      }
      setEntries((prev) => prev.filter((e) => !(e.kind === entry.kind && e.id === entry.id)));
      setPicking(null);
    } catch {
      // Leave the entry in the queue -- the user can just try again.
    } finally {
      setBusyEntryId(null);
    }
  };

  const useSuggestion = async (entry: Entry) => {
    if (!user) return;
    setBusyEntryId(entry.id);
    try {
      const topic = await confirmTopicSuggestion(user.id, topics, entry.topicSuggestion);
      setTopics((prev) => (prev.some((t) => t.id === topic.id) ? prev : [...prev, topic]));
      await assignEntryTopic(entry, topic.id);
    } catch {
      setBusyEntryId(null);
    }
  };

  return (
    <Screen>
      <Kicker style={{ color: colors.neutral600 }}>Inbox</Kicker>
      <Text style={styles.title}>Today</Text>

      <RuleThick />

      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.center} />
      ) : error ? (
        <Text style={styles.footnote}>{error}</Text>
      ) : entries.length === 0 ? (
        <Text style={styles.footnote}>Nothing needs review right now.</Text>
      ) : (
        entries.map((entry) => (
          <View key={`${entry.kind}-${entry.id}`} style={styles.item}>
            <CardKicker>{entry.kicker}</CardKicker>
            <Text style={styles.itemTitle}>{entry.title}</Text>
            <Text style={styles.note}>
              AI thinks this belongs under &quot;{entry.topicSuggestion}&quot;
            </Text>
            <View style={styles.actions}>
              <Button
                label={busyEntryId === entry.id ? 'Saving…' : `Use "${entry.topicSuggestion}"`}
                disabled={busyEntryId === entry.id}
                onPress={() => useSuggestion(entry)}
                style={{ minHeight: 40 }}
                textStyle={{ fontSize: 12 }}
              />
              <Button
                variant="secondary"
                label="Pick topic"
                disabled={busyEntryId === entry.id}
                onPress={() => setPicking(entry)}
                style={{ minHeight: 40 }}
                textStyle={{ fontSize: 12 }}
              />
            </View>
          </View>
        ))
      )}

      <Modal
        visible={picking !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPicking(null)}
      >
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
  center: {
    marginTop: 24,
  },
  item: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  itemTitle: {
    fontFamily: font.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    marginTop: 4,
  },
  note: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral700,
    marginTop: 4,
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  footnote: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.neutral600,
    paddingVertical: 12,
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
