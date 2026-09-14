import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { MicIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, CardKicker, Kicker, Row, RuleThick } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import { listRecentMemories, type Memory } from '@/services/memories';
import { listRecentSessions, type Session } from '@/services/sessions';
import { listTasks, type Task } from '@/services/tasks';
import { colors, font, h2 } from '@/theme';

export default function SearchScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [query, setQuery] = useState('');

  const [tasks, setTasks] = useState<Task[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      setLoading(true);
      setError(null);

      Promise.all([listTasks(user.id), listRecentMemories(user.id, 100), listRecentSessions(user.id, 100)])
        .then(([t, m, s]) => {
          if (cancelled) return;
          setTasks(t);
          setMemories(m);
          setSessions(s);
        })
        .catch((e) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : 'Could not load your data.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }, [user])
  );

  const needle = query.trim().toLowerCase();
  const taskMatches = needle ? tasks.filter((t) => t.title.toLowerCase().includes(needle)) : [];
  const memoryMatches = needle ? memories.filter((m) => m.content.toLowerCase().includes(needle)) : [];
  const sessionMatches = needle
    ? sessions.filter((s) => (s.title ?? s.summary ?? '').toLowerCase().includes(needle))
    : [];
  const totalMatches = taskMatches.length + memoryMatches.length + sessionMatches.length;

  return (
    <Screen scroll={false}>
      <Kicker style={{ color: colors.neutral600 }}>Search</Kicker>
      <Text style={styles.title}>Ask my memory</Text>

      <RuleThick />

      <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
        {loading ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error ? (
          <Text style={styles.emptyText}>{error}</Text>
        ) : !needle ? (
          <Text style={styles.emptyText}>Type to search your tasks, ideas, and recordings.</Text>
        ) : totalMatches === 0 ? (
          <Text style={styles.emptyText}>No matches.</Text>
        ) : (
          <>
            {taskMatches.map((task) => (
              <Row key={`task-${task.id}`} onPress={() => router.push('/tasks')} style={styles.resultRow}>
                <CardKicker>Task</CardKicker>
                <Text style={styles.resultText} numberOfLines={2}>
                  {task.title}
                </Text>
              </Row>
            ))}
            {memoryMatches.map((memory) => (
              <Row key={`memory-${memory.id}`} onPress={() => router.push('/memory')} style={styles.resultRow}>
                <CardKicker>Idea</CardKicker>
                <Text style={styles.resultText} numberOfLines={2}>
                  {memory.content}
                </Text>
              </Row>
            ))}
            {sessionMatches.map((session) => (
              <Row
                key={`session-${session.id}`}
                onPress={() => router.push({ pathname: '/summary', params: { sessionId: session.id } })}
                style={styles.resultRow}
              >
                <CardKicker>Recording</CardKicker>
                <Text style={styles.resultText} numberOfLines={2}>
                  {session.title ?? session.summary ?? 'Untitled session'}
                </Text>
              </Row>
            ))}
          </>
        )}
      </ScrollView>

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
          onPress={() => router.push('/talk')}
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
  results: {
    flex: 1,
  },
  centerBlock: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.neutral600,
    paddingVertical: 14,
  },
  resultRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  resultText: {
    fontFamily: font.semibold,
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
    marginTop: 3,
  },
  askRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
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
