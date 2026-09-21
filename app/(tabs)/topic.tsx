import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { ChevronLeftIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { ShareSheet, type ShareContent } from '@/components/ShareSheet';
import { Button, CardKicker, Kicker, Row, RuleThick } from '@/components/ui';
import { friendlyMessage } from '@/lib/friendlyError';
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
import type { SessionsPageCursor } from '@/services/sessions';
import {
  createTopic,
  deleteTopic,
  descendantTopicIds,
  listSessionsByTopics,
  listSessionsUnclassifiedPage,
  listTopics,
  mergeTopics,
  moveTopic,
  renameTopic,
  wouldCreateCycle,
  type Topic,
} from '@/services/topics';
import { colors, font, h2, radius } from '@/theme';

type ItemMenuTone = 'share' | 'delete' | 'neutral';
type ItemMenuAction = { label: string; tone: ItemMenuTone; onPress: () => void };
type ItemMenu = { title: string; actions: ItemMenuAction[] };

const ITEM_MENU_TONE_COLOR: Record<ItemMenuTone, string> = {
  share: colors.pastelPeach,
  delete: colors.pastelPink,
  neutral: colors.pastelLavender,
};

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
  const [shareContent, setShareContent] = useState<ShareContent | null>(null);
  const [itemMenu, setItemMenu] = useState<ItemMenu | null>(null);
  const closeItemMenu = () => setItemMenu(null);
  // Unclassified sessions only -- real pagination, since a fixed cap here
  // would permanently hide older unclassified recordings (see
  // listSessionsUnclassifiedPage's own comment).
  const [sessionsCursor, setSessionsCursor] = useState<SessionsPageCursor | null>(null);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);

  const topic = id ? allTopics.find((t) => t.id === id) ?? null : null;
  const parent = topic?.parent_topic_id ? allTopics.find((t) => t.id === topic.parent_topic_id) ?? null : null;
  const hasChildren = id ? allTopics.some((t) => t.parent_topic_id === id) : false;

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);

    try {
      if (isUnclassified) {
        const [sPage, t, m] = await Promise.all([
          listSessionsUnclassifiedPage(user.id),
          listTasksUnclassified(user.id),
          listMemoriesUnclassified(user.id),
        ]);
        setSessions(sPage.sessions);
        setSessionsCursor(sPage.nextCursor);
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
      setLoadError(friendlyMessage(e, 'Could not load this topic.'));
    } finally {
      setLoading(false);
    }
  }, [user, id, isUnclassified, includeSubtopics]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // `topic` is a hidden tab (see (tabs)/_layout.tsx's comment) rather than a
  // pushed stack screen, so it doesn't have its own back-stack entry --
  // Android's hardware back button falls through to the bottom-tab
  // navigator's default behavior, which jumps straight to the FIRST tab
  // (Home) instead of back to wherever this topic was opened from. Route it
  // through the same "Topics" destination as the explicit back button above
  // instead, so hardware back and the on-screen back arrow always agree.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        router.push('/memory');
        return true;
      });
      return () => sub.remove();
    }, [router])
  );

  const loadMoreSessions = async () => {
    if (!user || !sessionsCursor || loadingMoreSessions) return;
    setLoadingMoreSessions(true);
    try {
      const page = await listSessionsUnclassifiedPage(user.id, { before: sessionsCursor });
      setSessions((prev) => [...prev, ...page.sessions]);
      setSessionsCursor(page.nextCursor);
    } catch (e) {
      Alert.alert('Could not load more', friendlyMessage(e, 'Please try again.'));
    } finally {
      setLoadingMoreSessions(false);
    }
  };

  const closeSheet = () => setSheet(null);
  const runAction = async (action: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    try {
      await action();
      closeSheet();
      if (after) after();
      else load();
    } catch (e) {
      Alert.alert('Something went wrong', friendlyMessage(e, 'Please try again.'));
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
              .catch((e) => Alert.alert('Could not delete', friendlyMessage(e, 'Please try again.'))),
        },
      ]
    );
  };

  const sessionMenu = (session: Session) => {
    setItemMenu({
      title: session.title ?? capitalize(session.mode),
      actions: [
        {
          label: 'Share',
          tone: 'share',
          onPress: () => {
            closeItemMenu();
            setShareContent({
              kicker: capitalize(session.mode),
              title: session.title ?? 'Recording',
              body: [
                session.title ?? 'Untitled recording',
                new Date(session.started_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                }),
                session.summary,
              ]
                .filter(Boolean)
                .join('\n\n'),
            });
          },
        },
        {
          label: 'Delete',
          tone: 'delete',
          onPress: () => {
            closeItemMenu();
            confirmDeleteSession(session);
          },
        },
      ],
    });
  };

  const taskMenu = (task: Task) => {
    const actions: ItemMenuAction[] = [
      {
        label: 'Share',
        tone: 'share',
        onPress: () => {
          closeItemMenu();
          setShareContent({ kicker: 'Task', title: task.title, body: task.title });
        },
      },
    ];
    if (!isUnclassified) {
      actions.push({
        label: 'Remove from this topic',
        tone: 'neutral',
        onPress: () => {
          closeItemMenu();
          clearTaskTopic(task.id)
            .then(load)
            .catch((e) => Alert.alert('Could not update', friendlyMessage(e, 'Please try again.')));
        },
      });
    }
    actions.push({
      label: 'Delete task',
      tone: 'delete',
      onPress: () => {
        closeItemMenu();
        deleteTask(task.id)
          .then(load)
          .catch((e) => Alert.alert('Could not delete', friendlyMessage(e, 'Please try again.')));
      },
    });
    setItemMenu({ title: task.title, actions });
  };

  const memoryMenu = (memory: Memory) => {
    const actions: ItemMenuAction[] = [
      {
        label: 'Share',
        tone: 'share',
        onPress: () => {
          closeItemMenu();
          setShareContent({ kicker: 'Idea', title: truncate(memory.content, 60), body: memory.content });
        },
      },
    ];
    if (!isUnclassified) {
      actions.push({
        label: 'Remove from this topic',
        tone: 'neutral',
        onPress: () => {
          closeItemMenu();
          clearMemoryTopic(memory.id)
            .then(load)
            .catch((e) => Alert.alert('Could not update', friendlyMessage(e, 'Please try again.')));
        },
      });
    }
    actions.push({
      label: 'Delete idea',
      tone: 'delete',
      onPress: () => {
        closeItemMenu();
        deleteMemory(memory.id)
          .then(load)
          .catch((e) => Alert.alert('Could not delete', friendlyMessage(e, 'Please try again.')));
      },
    });
    setItemMenu({ title: truncate(memory.content, 60), actions });
  };

  // Topic-level share: a digest of what's filed here, not a fixed set of
  // "user-selected records" (there's no multi-select UI on this screen) --
  // it lists everything currently in view, so the user can trim it down
  // themselves in the native share sheet's own compose step if they want less.
  const shareTopic = () => {
    if (!topic) return;
    const lines = [
      topic.name,
      `${sessions.length} recording${sessions.length === 1 ? '' : 's'}, ${tasks.length} task${tasks.length === 1 ? '' : 's'}, ${memories.length} idea${memories.length === 1 ? '' : 's'}`,
      '',
      ...sessions.map((s) => `• ${s.title ?? s.summary ?? 'Untitled recording'}`),
      ...tasks.map((t) => `• ${t.title}`),
      ...memories.map((m) => `• ${truncate(m.content, 90)}`),
    ];
    setShareContent({ kicker: 'Topic', title: topic.name, body: lines.join('\n') });
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
        <Text style={styles.hint}>Recordings, tasks and ideas that don&apos;t have a topic yet.</Text>
      ) : hasChildren ? (
        <View style={styles.subtopicToggle}>
          <Text style={styles.subtopicLabel}>Include sub-topics</Text>
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
        <Text style={styles.empty}>Nothing here yet.</Text>
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
                  onLongPress={() => sessionMenu(session)}
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
              {isUnclassified && sessionsCursor ? (
                <Button
                  variant="ghost"
                  label={loadingMoreSessions ? 'Loading…' : 'Load more recordings'}
                  disabled={loadingMoreSessions}
                  onPress={loadMoreSessions}
                  align="flex-start"
                  style={{ marginTop: 4 }}
                  textStyle={{ fontSize: 12 }}
                />
              ) : null}
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

          <Text style={[styles.hint, { marginTop: 14, textAlign: 'center' }]}>Hold an item for more options</Text>
        </>
      )}

      {/* Topic management menu */}
      <ActionModal visible={sheet?.kind === 'menu'} onClose={closeSheet} title={topic?.name ?? ''}>
        <View style={{ gap: 10 }}>
          <Button
            label="Share"
            align="flex-start"
            variant="secondary"
            onPress={() => {
              closeSheet();
              shareTopic();
            }}
          />
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
              // Only top-level targets: topics nest one level deep, and a
              // target inside the source would make the source its own
              // ancestor (merge re-parents the source's children too).
              .filter((t) => !t.parent_topic_id && !wouldCreateCycle(allTopics, topic.id, t.id))
              .map((t) => (
                <Button
                  key={t.id}
                  label={t.parent_topic_id ? `↳ ${t.name}` : t.name}
                  align="flex-start"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => {
                    if (sheet.kind === 'move') {
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

      <ShareSheet content={shareContent} onClose={() => setShareContent(null)} />

      {/* Per-item long-press menu -- pastel actions on a pale grey sheet,
          instead of the OS's own unstyleable action sheet. */}
      <BottomSheet
        visible={itemMenu !== null}
        onClose={closeItemMenu}
        title={itemMenu?.title ?? ''}
        titleLines={2}
        backgroundColor={colors.neutral200}
      >
        <View style={{ gap: 10 }}>
          {itemMenu?.actions.map((action) => (
            <Button
              key={action.label}
              label={action.label}
              align="flex-start"
              onPress={action.onPress}
              style={[styles.menuAction, { backgroundColor: ITEM_MENU_TONE_COLOR[action.tone] }]}
              textStyle={styles.menuActionText}
            />
          ))}
          <Button
            label="Cancel"
            align="flex-start"
            onPress={closeItemMenu}
            style={[styles.menuAction, { backgroundColor: colors.pastelBlue }]}
            textStyle={styles.menuActionText}
          />
        </View>
      </BottomSheet>
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
  menuAction: {
    minHeight: 48,
    borderRadius: radius.pastel,
    paddingHorizontal: 16,
  },
  menuActionText: {
    color: colors.text,
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
