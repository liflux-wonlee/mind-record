import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { ChevronLeftIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, CardKicker, Kicker, Row, RuleThick } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import {
  clearMemoryTopic,
  deleteMemory,
  listMemoriesByTopics,
  listMemoriesUnclassified,
  type Memory,
} from '@/services/memories';
import { deleteSession, type Session } from '@/services/sessions';
import {
  clearTaskTopic,
  deleteTask,
  listTasksByTopics,
  listTasksUnclassified,
  type Task,
} from '@/services/tasks';
import {
  createTopic,
  deleteTopic,
  descendantTopicIds,
  listSessionsByTopics,
  listSessionsUnclassified,
  listTopics,
  mergeTopics,
  moveTopic,
  renameTopic,
  wouldCreateCycle,
  type Topic,
} from '@/services/topics';
import { colors, font, h2 } from '@/theme';

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function truncate(text: string, max = 90): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

type Sheet =
  | { kind: 'menu' }
  | { kind: 'rename' }
  | { kind: 'createChild' }
  | { kind: 'move' }
  | { kind: 'merge' }
  | null;

export default function TopicDetailScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { id, unclassified } = useLocalSearchParams<{ id?: string; unclassified?: string }>();
  const isUnclassified = unclassified === '1';

  const [allTopics, setAllTopics] = useState<Topic[]>([]);
  const [includeSubtopics, setIncludeSubtopics] = useState(true);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const topic = id ? allTopics.find((t) => t.id === id) ?? null : null;
  const parent = topic?.parent_topic_id ? allTopics.find((t) => t.id === topic.parent_topic_id) ?? null : null;
  const hasChildren = id ? allTopics.some((t) => t.parent_topic_id === id) : false;

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);

    try {
      if (isUnclassified) {
        const s = await listSessionsUnclassified(user.id);
        const t = await listTasksUnclassified(user.id);
        const m = await listMemoriesUnclassified(user.id);
        setSessions(s);
        setTasks(t);
        setMemories(m);
        return;
      }

      if (!id) return;

      const topics = await listTopics(user.id);
      setAllTopics(topics);
      const scopeIds = includeSubtopics ? descendantTopicIds(topics, id) : [id];
      const s = await listSessionsByTopics(scopeIds);
      const t = await listTasksByTopics(scopeIds);
      const m = await listMemoriesByTopics(scopeIds);
      setSessions(s);
      setTasks(t);
      setMemories(m);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load this topic.');
    } finally {
      setLoading(false);
    }
  }, [user, id, isUnclassified, includeSubtopics]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const closeSheet = () => setSheet(null);
  const runAction = async (action: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    try {
      await action();
      closeSheet();
      if (after) after();
      else load();
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteTopic = () => {
    if (!topic) return;
    Alert.alert(
      'Delete topic?',
      `"${topic.name}" will be removed. Anything tagged with it keeps its content, just untagged.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => runAction(() => deleteTopic(topic.id), () => router.push('/memory')),
        },
      ]
    );
  };

  const confirmDeleteSession = (session: Session) => {
    Alert.alert(
      'Delete this recording?',
      `${session.title ?? session.mode} will be permanently deleted, including its audio. Tasks or ideas it already created are kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deleteSession(session.id)
              .then(load)
              .catch((e) => Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.')),
        },
      ]
    );
  };

  const taskMenu = (task: Task) => {
    const options: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [];
    if (!isUnclassified) {
      options.push({ text: 'Remove from this topic', onPress: () => clearTaskTopic(task.id).then(load) });
    }
    options.push({
      text: 'Delete task',
      style: 'destructive',
      onPress: () =>
        deleteTask(task.id)
          .then(load)
          .catch((e) => Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.')),
    });
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(task.title, undefined, options);
  };

  const memoryMenu = (memory: Memory) => {
    const options: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [];
    if (!isUnclassified) {
      options.push({ text: 'Remove from this topic', onPress: () => clearMemoryTopic(memory.id).then(load) });
    }
    options.push({
      text: 'Delete idea',
      style: 'destructive',
      onPress: () =>
        deleteMemory(memory.id)
          .then(load)
          .catch((e) => Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.')),
    });
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(truncate(memory.content, 60), undefined, options);
  };

  const title = isUnclassified ? 'Unclassified' : topic?.name ?? '';

  return (
    <Screen>
      <Button
        variant="ghost"
        label="Topics"
        icon={<ChevronLeftIcon size={18} color={colors.accent} />}
        onPress={() => router.push('/memory')}
        style={styles.back}
        textStyle={{ fontSize: 12 }}
      />

      {parent ? <Kicker style={{ color: colors.neutral600 }}>{parent.name} /</Kicker> : null}
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {!isUnclassified && topic ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Topic actions"
            onPress={() => setSheet({ kind: 'menu' })}
            style={styles.moreButton}
          >
            <Text style={styles.moreText}>⋯</Text>
          </Pressable>
        ) : null}
      </View>

      {isUnclassified ? (
        <Text style={styles.hint}>토픽이 아직 없는 기록·할 일·아이디어입니다.</Text>
      ) : hasChildren ? (
        <View style={styles.subtopicToggle}>
          <Text style={styles.subtopicLabel}>하위 토픽 포함</Text>
          <Switch value={includeSubtopics} onValueChange={setIncludeSubtopics} />
        </View>
      ) : null}

      <RuleThick style={{ marginTop: 10 }} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : loadError ? (
        <Text style={styles.empty}>{loadError}</Text>
      ) : !isUnclassified && !topic ? (
        <Text style={styles.empty}>Topic not found.</Text>
      ) : sessions.length === 0 && tasks.length === 0 && memories.length === 0 ? (
        <Text style={styles.empty}>여기엔 아직 아무것도 없습니다.</Text>
      ) : (
        <>
          {sessions.length > 0 ? (
            <>
              <Kicker style={{ color: colors.neutral600, marginTop: 10, marginBottom: 4 }}>
                Recordings ({sessions.length})
              </Kicker>
              {sessions.map((session) => (
                <Row
                  key={session.id}
                  onPress={() => router.push({ pathname: '/summary', params: { sessionId: session.id } })}
                  onLongPress={() => confirmDeleteSession(session)}
                  style={styles.entryRow}
                >
                  <CardKicker>{capitalize(session.mode)}</CardKicker>
                  <Text style={styles.entryTitle} numberOfLines={1}>
                    {session.title ?? session.summary ?? 'Untitled session'}
                  </Text>
                  <Text style={styles.entryMeta}>
                    {new Date(session.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </Text>
                </Row>
              ))}
            </>
          ) : null}

          {tasks.length > 0 ? (
            <>
              <Kicker style={{ color: colors.neutral600, marginTop: 14, marginBottom: 4 }}>
                Tasks ({tasks.length})
              </Kicker>
              {tasks.map((task) => (
                <Row
                  key={task.id}
                  onPress={
                    task.source_session_id
                      ? () => router.push({ pathname: '/summary', params: { sessionId: task.source_session_id! } })
                      : undefined
                  }
                  onLongPress={() => taskMenu(task)}
                  style={styles.entryRow}
                >
                  <CardKicker>{task.status === 'completed' ? 'Done' : 'Task'}</CardKicker>
                  <Text style={styles.entryTitle} numberOfLines={1}>
                    {task.title}
                  </Text>
                </Row>
              ))}
            </>
          ) : null}

          {memories.length > 0 ? (
            <>
              <Kicker style={{ color: colors.neutral600, marginTop: 14, marginBottom: 4 }}>
                Ideas ({memories.length})
              </Kicker>
              {memories.map((memory) => (
                <Row
                  key={memory.id}
                  onPress={
                    memory.source_session_id
                      ? () => router.push({ pathname: '/summary', params: { sessionId: memory.source_session_id! } })
                      : undefined
                  }
                  onLongPress={() => memoryMenu(memory)}
                  style={styles.entryRow}
                >
                  <CardKicker>Idea</CardKicker>
                  <Text style={styles.entryTitle} numberOfLines={2}>
                    {memory.content}
                  </Text>
                </Row>
              ))}
            </>
          ) : null}
        </>
      )}

      {/* Topic management menu */}
      <ActionModal visible={sheet?.kind === 'menu'} onClose={closeSheet} title={topic?.name ?? ''}>
        <View style={{ gap: 10 }}>
          <Button label="Rename" align="flex-start" variant="secondary" onPress={() => setSheet({ kind: 'rename' })} />
          {topic && !topic.parent_topic_id ? (
            <Button label="Add sub-topic here" align="flex-start" variant="secondary" onPress={() => setSheet({ kind: 'createChild' })} />
          ) : null}
          <Button label="Move" align="flex-start" variant="secondary" onPress={() => setSheet({ kind: 'move' })} />
          <Button label="Merge into…" align="flex-start" variant="secondary" onPress={() => setSheet({ kind: 'merge' })} />
          <Button label="Delete" align="flex-start" variant="secondary" textStyle={{ color: colors.accent700 }} onPress={confirmDeleteTopic} />
        </View>
      </ActionModal>

      {/* Rename / create sub-topic name input */}
      <NameModal
        visible={sheet?.kind === 'rename' || sheet?.kind === 'createChild'}
        busy={busy}
        initialValue={sheet?.kind === 'rename' ? topic?.name ?? '' : ''}
        title={sheet?.kind === 'rename' ? 'Rename topic' : `New sub-topic of "${topic?.name ?? ''}"`}
        onCancel={closeSheet}
        onSubmit={(name) => {
          if (!sheet || !user || !topic) return;
          if (sheet.kind === 'rename') {
            runAction(() => renameTopic(topic.id, name).then(() => undefined));
          } else if (sheet.kind === 'createChild') {
            runAction(() => createTopic(user.id, name, topic.id).then(() => undefined));
          }
        }}
      />

      {/* Move / merge target picker */}
      <ActionModal
        visible={sheet?.kind === 'move' || sheet?.kind === 'merge'}
        onClose={closeSheet}
        title={sheet?.kind === 'move' ? 'Move under…' : 'Merge into…'}
      >
        {(sheet?.kind === 'move' || sheet?.kind === 'merge') && topic ? (
          <View style={{ gap: 4 }}>
            {sheet.kind === 'move' && topic.parent_topic_id ? (
              <Button
                label="Top level (no parent)"
                align="flex-start"
                variant="secondary"
                disabled={busy}
                onPress={() => runAction(() => moveTopic(topic.id, null).then(() => undefined))}
              />
            ) : null}
            {allTopics
              .filter((t) => t.id !== topic.id)
              .map((t) => (
                <Button
                  key={t.id}
                  label={t.parent_topic_id ? `↳ ${t.name}` : t.name}
                  align="flex-start"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => {
                    if (sheet.kind === 'move') {
                      if (wouldCreateCycle(allTopics, topic.id, t.id)) {
                        Alert.alert('Can’t do that', 'A topic can’t move under its own sub-topic.');
                        return;
                      }
                      runAction(() => moveTopic(topic.id, t.id).then(() => undefined));
                    } else {
                      runAction(() => mergeTopics(topic.id, t.id), () => router.push(`/topic?id=${t.id}`));
                    }
                  }}
                />
              ))}
          </View>
        ) : null}
      </ActionModal>
    </Screen>
  );
}

function ActionModal({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      {children}
      <Button label="Cancel" variant="ghost" align="flex-start" onPress={onClose} style={{ marginTop: 12 }} />
    </BottomSheet>
  );
}

function NameModal({
  visible,
  title,
  initialValue,
  busy,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  initialValue: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  React.useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  return (
    <BottomSheet visible={visible} onClose={onCancel} title={title}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        placeholder="Topic name"
        placeholderTextColor={colors.neutral600}
        autoFocus
      />
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <Button label="Cancel" variant="ghost" onPress={onCancel} />
        <Button label={busy ? 'Saving…' : 'Save'} disabled={busy || !value.trim()} onPress={() => onSubmit(value.trim())} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingLeft: 0,
    marginLeft: -4,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  title: {
    ...h2,
    flex: 1,
    marginTop: 2,
  },
  moreButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: {
    fontFamily: font.extrabold,
    fontSize: 22,
    color: colors.neutral700,
  },
  hint: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.neutral600,
    marginTop: 6,
  },
  subtopicToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  subtopicLabel: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.neutral700,
  },
  center: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  empty: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.neutral600,
    marginTop: 14,
  },
  entryRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  entryTitle: {
    fontFamily: font.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
    marginTop: 3,
  },
  entryMeta: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral600,
    marginTop: 2,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 12,
    fontFamily: font.regular,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
});
