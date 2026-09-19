import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ChevronLeftIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, Kicker, RuleThick } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import { listMemoriesCreatedInRange, type Memory } from '@/services/memories';
import { listSessionsForDay, type Session } from '@/services/sessions';
import { listTasksCreatedInRange, type Task } from '@/services/tasks';
import { listTopics, type Topic } from '@/services/topics';
import { colors, font, h2 } from '@/theme';

type TopicGroup = {
  key: string;
  label: string;
  tasks: Task[];
  memories: Memory[];
};

export default function JournalScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { date } = useLocalSearchParams<{ date?: string }>();
  const resolvedDate = date ? new Date(date) : new Date();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      setLoading(true);
      setError(false);

      const dayStart = new Date(resolvedDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(resolvedDate);
      dayEnd.setHours(23, 59, 59, 999);
      const startIso = dayStart.toISOString();
      const endIso = dayEnd.toISOString();

      Promise.all([
        listSessionsForDay(user.id, resolvedDate),
        listTasksCreatedInRange(user.id, startIso, endIso),
        listMemoriesCreatedInRange(user.id, startIso, endIso),
        listTopics(user.id),
      ])
        .then(([sessionsForDay, tasksForDay, memoriesForDay, allTopics]) => {
          if (cancelled) return;
          setSessions(sessionsForDay);
          setTasks(tasksForDay);
          setMemories(memoriesForDay);
          setTopics(allTopics);
        })
        .catch(() => {
          if (cancelled) return;
          setError(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

      return () => {
        cancelled = true;
      };
      // resolvedDate is re-derived deterministically from `date` each render,
      // so keying off `date` itself avoids re-running on every render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, date])
  );

  const weekday = resolvedDate.toLocaleDateString(undefined, { weekday: 'long' });
  const titleDate = resolvedDate.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const stats = [
    { value: String(sessions.length), label: 'Sessions' },
    { value: String(tasks.length), label: 'Tasks' },
    { value: String(memories.length), label: 'Ideas' },
  ];

  const topicGroups: TopicGroup[] = topics
    .map((topic) => ({
      key: topic.id,
      label: topic.name,
      tasks: tasks.filter((t) => t.topic_id === topic.id),
      memories: memories.filter((m) => m.topic_id === topic.id),
    }))
    .filter((group) => group.tasks.length > 0 || group.memories.length > 0);

  const untaggedTasks = tasks.filter((t) => t.topic_id === null);
  const untaggedMemories = memories.filter((m) => m.topic_id === null);
  if (untaggedTasks.length > 0 || untaggedMemories.length > 0) {
    topicGroups.push({
      key: 'untagged',
      label: 'Untagged',
      tasks: untaggedTasks,
      memories: untaggedMemories,
    });
  }

  return (
    <Screen>
      <Button
        variant="ghost"
        label="Back"
        icon={<ChevronLeftIcon size={18} color={colors.accent} />}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        style={styles.back}
        textStyle={{ fontSize: 12 }}
      />
      <Kicker style={{ color: colors.neutral600 }}>Auto-generated · {weekday}</Kicker>
      <Text style={styles.title}>{titleDate}</Text>

      <RuleThick />
      {loading ? (
        <View style={styles.centerBlock}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <Text style={styles.errorText}>Couldn&apos;t load this day&apos;s journal.</Text>
      ) : (
        <>
          <View style={styles.stats}>
            {stats.map((stat, i) => (
              <View
                key={stat.label}
                style={[
                  styles.statCell,
                  i > 0 && { paddingHorizontal: 8 },
                  i < stats.length - 1 && styles.statDivider,
                ]}
              >
                <Text style={styles.statValue}>{stat.value}</Text>
                <Kicker style={{ color: colors.neutral600 }}>{stat.label}</Kicker>
              </View>
            ))}
          </View>

          <View style={styles.today}>
            <Kicker style={{ color: colors.accent, marginBottom: 6 }}>Today</Kicker>
            {sessions.length === 0 ? (
              <Text style={styles.todayText}>No recordings this day.</Text>
            ) : (
              sessions.map((session, i) => (
                <Text key={session.id} style={[styles.todayText, i > 0 && { marginTop: 8 }]}>
                  {session.summary ?? 'Still processing…'}
                </Text>
              ))
            )}
          </View>

          {topicGroups.length === 0 ? (
            <Text style={styles.sectionEmpty}>No tagged items yet for this day.</Text>
          ) : (
            topicGroups.map((group) => (
              <View key={group.key} style={styles.section}>
                <Kicker style={{ color: colors.neutral600, marginBottom: 6 }}>{group.label}</Kicker>
                {group.tasks.map((task) => (
                  <Text key={`task-${task.id}`} style={styles.sectionText}>
                    • {task.title}
                  </Text>
                ))}
                {group.memories.map((memory) => (
                  <Text key={`memory-${memory.id}`} style={styles.sectionText}>
                    • {memory.content}
                  </Text>
                ))}
              </View>
            ))
          )}

          <Text style={styles.footnote}>
            Built from {sessions.length} conversation{sessions.length === 1 ? '' : 's'}
          </Text>
        </>
      )}
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
  centerBlock: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  errorText: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.neutral600,
    paddingVertical: 16,
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
  sectionEmpty: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.neutral600,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingVertical: 12,
  },
  footnote: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral700,
    marginTop: 8,
  },
});
