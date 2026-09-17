import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ChevronRightIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, Kicker, Row, RuleThick } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import { deleteMemory, listRecentMemories, type Memory } from '@/services/memories';
import {
  createTopic,
  deleteTopic,
  listTopics,
  mergeTopics,
  moveTopic,
  renameTopic,
  wouldCreateCycle,
  type Topic,
} from '@/services/topics';
import { colors, font, h2 } from '@/theme';

function truncate(text: string, max = 60): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

type Sheet =
  | { kind: 'menu'; topic: Topic }
  | { kind: 'rename'; topic: Topic }
  | { kind: 'createTop' }
  | { kind: 'createChild'; parent: Topic }
  | { kind: 'move'; topic: Topic }
  | { kind: 'merge'; topic: Topic }
  | null;

export default function MemoryScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const [recentMemories, setRecentMemories] = useState<Memory[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(true);
  const [memoriesError, setMemoriesError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!user) return;
    setLoading(true);
    listTopics(user.id)
      .then(setTopics)
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not load topics.'))
      .finally(() => setLoading(false));
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const loadMemories = useCallback(() => {
    if (!user) return;
    setMemoriesLoading(true);
    setMemoriesError(null);
    listRecentMemories(user.id, 5)
      .then(setRecentMemories)
      .catch((e) => setMemoriesError(e instanceof Error ? e.message : 'Could not load recent ideas.'))
      .finally(() => setMemoriesLoading(false));
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadMemories();
    }, [loadMemories])
  );

  const confirmDeleteMemory = (memory: Memory) => {
    Alert.alert(
      'Delete this idea?',
      `"${truncate(memory.content, 80)}" will be permanently deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deleteMemory(memory.id)
              .then(loadMemories)
              .catch((e) => Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.')),
        },
      ]
    );
  };

  const roots = topics.filter((t) => !t.parent_topic_id);
  const childrenOf = (id: string) => topics.filter((t) => t.parent_topic_id === id);

  const closeSheet = () => setSheet(null);

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      closeSheet();
      reload();
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Kicker style={{ color: colors.neutral600 }}>Topics</Kicker>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Topics</Text>
        <Button
          variant="ghost"
          label="+ New topic"
          onPress={() => setSheet({ kind: 'createTop' })}
          style={{ minHeight: 40, justifyContent: 'center' }}
          textStyle={{ fontSize: 12 }}
        />
      </View>

      <RuleThick />

      <Row onPress={() => router.push('/topic?unclassified=1')} style={styles.topicRow}>
        <Text style={[styles.topicName, { color: colors.neutral700 }]}>Unclassified</Text>
      </Row>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : loadError ? (
        <Text style={styles.empty}>{loadError}</Text>
      ) : roots.length === 0 ? (
        <Text style={styles.empty}>No topics yet — create one, or just talk and one will get suggested.</Text>
      ) : (
        roots.map((topic) => {
          const children = childrenOf(topic.id);
          const isCollapsed = collapsed.has(topic.id);
          return (
            <View key={topic.id}>
              <Row
                onPress={() => router.push(`/topic?id=${topic.id}`)}
                onLongPress={() => setSheet({ kind: 'menu', topic })}
                style={styles.topicRow}
              >
                {children.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={isCollapsed ? 'Expand' : 'Collapse'}
                    hitSlop={10}
                    onPress={() => toggleCollapsed(topic.id)}
                    style={styles.chevron}
                  >
                    <View style={isCollapsed ? undefined : styles.chevronOpen}>
                      <ChevronRightIcon size={14} color={colors.neutral600} />
                    </View>
                  </Pressable>
                ) : (
                  <View style={styles.chevron} />
                )}
                <Text style={styles.topicName}>{topic.name}</Text>
              </Row>
              {!isCollapsed &&
                children.map((child) => (
                  <Row
                    key={child.id}
                    onPress={() => router.push(`/topic?id=${child.id}`)}
                    onLongPress={() => setSheet({ kind: 'menu', topic: child })}
                    style={[styles.topicRow, styles.childRow]}
                  >
                    <Text style={styles.childName}>{child.name}</Text>
                  </Row>
                ))}
            </View>
          );
        })
      )}

      <Kicker style={{ color: colors.neutral600, marginTop: 20 }}>Recent ideas</Kicker>
      <RuleThick style={{ marginTop: 6 }} />
      {memoriesLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : memoriesError ? (
        <Text style={styles.empty}>{memoriesError}</Text>
      ) : recentMemories.length === 0 ? (
        <Text style={styles.empty}>No ideas captured yet — they&apos;ll show up here after a session.</Text>
      ) : (
        recentMemories.map((memory) => (
          <Row
            key={memory.id}
            onPress={
              memory.source_session_id
                ? () => router.push({ pathname: '/summary', params: { sessionId: memory.source_session_id! } })
                : undefined
            }
            onLongPress={() => confirmDeleteMemory(memory)}
            style={styles.listRow}
          >
            <Text style={styles.listTitle} numberOfLines={1}>
              {truncate(memory.content)}
            </Text>
            <Text style={styles.listMeta}>
              {new Date(memory.created_at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </Text>
          </Row>
        ))
      )}

      <Kicker style={{ color: colors.neutral600, marginTop: 20 }}>Journal</Kicker>
      <RuleThick style={{ marginTop: 6 }} />
      <Row onPress={() => router.push('/journal')} style={styles.listRow}>
        <Text style={styles.listTitle}>
          {new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
        </Text>
        <Text style={styles.listMeta}>today</Text>
      </Row>

      {/* Action menu for a tapped topic */}
      <ActionModal visible={sheet?.kind === 'menu'} onClose={closeSheet} title={sheet?.kind === 'menu' ? sheet.topic.name : ''}>
        {sheet?.kind === 'menu' ? (
          <View style={{ gap: 10 }}>
            <Button label="Rename" align="flex-start" variant="secondary" onPress={() => setSheet({ kind: 'rename', topic: sheet.topic })} />
            {!sheet.topic.parent_topic_id ? (
              <Button
                label="Add sub-topic here"
                align="flex-start"
                variant="secondary"
                onPress={() => setSheet({ kind: 'createChild', parent: sheet.topic })}
              />
            ) : null}
            <Button label="Move" align="flex-start" variant="secondary" onPress={() => setSheet({ kind: 'move', topic: sheet.topic })} />
            <Button label="Merge into…" align="flex-start" variant="secondary" onPress={() => setSheet({ kind: 'merge', topic: sheet.topic })} />
            <Button
              label="Delete"
              align="flex-start"
              variant="secondary"
              textStyle={{ color: colors.accent700 }}
              onPress={() => {
                const topic = sheet.topic;
                Alert.alert('Delete topic?', `"${topic.name}" will be removed. Anything tagged with it keeps its content, just untagged.`, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => runAction(() => deleteTopic(topic.id)),
                  },
                ]);
              }}
            />
          </View>
        ) : null}
      </ActionModal>

      {/* Rename / create name input */}
      <NameModal
        visible={sheet?.kind === 'rename' || sheet?.kind === 'createTop' || sheet?.kind === 'createChild'}
        busy={busy}
        initialValue={sheet?.kind === 'rename' ? sheet.topic.name : ''}
        title={sheet?.kind === 'rename' ? 'Rename topic' : sheet?.kind === 'createChild' ? `New sub-topic of "${sheet.parent.name}"` : 'New topic'}
        onCancel={closeSheet}
        onSubmit={(name) => {
          if (!sheet || !user) return;
          if (sheet.kind === 'rename') {
            runAction(() => renameTopic(sheet.topic.id, name).then(() => undefined));
          } else if (sheet.kind === 'createTop') {
            runAction(() => createTopic(user.id, name, null).then(() => undefined));
          } else if (sheet.kind === 'createChild') {
            runAction(() => createTopic(user.id, name, sheet.parent.id).then(() => undefined));
          }
        }}
      />

      {/* Move / merge target picker */}
      <ActionModal
        visible={sheet?.kind === 'move' || sheet?.kind === 'merge'}
        onClose={closeSheet}
        title={sheet?.kind === 'move' ? 'Move under…' : 'Merge into…'}
      >
        {sheet?.kind === 'move' || sheet?.kind === 'merge' ? (
          <View style={{ gap: 4 }}>
            {sheet.kind === 'move' && sheet.topic.parent_topic_id ? (
              <Button
                label="Top level (no parent)"
                align="flex-start"
                variant="secondary"
                disabled={busy}
                onPress={() => runAction(() => moveTopic(sheet.topic.id, null).then(() => undefined))}
              />
            ) : null}
            {topics
              .filter((t) => t.id !== sheet.topic.id)
              .map((t) => (
                <Button
                  key={t.id}
                  label={t.parent_topic_id ? `↳ ${t.name}` : t.name}
                  align="flex-start"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => {
                    if (sheet.kind === 'move') {
                      if (wouldCreateCycle(topics, sheet.topic.id, t.id)) {
                        Alert.alert('Can’t do that', 'A topic can’t move under its own sub-topic.');
                        return;
                      }
                      runAction(() => moveTopic(sheet.topic.id, t.id).then(() => undefined));
                    } else {
                      runAction(() => mergeTopics(sheet.topic.id, t.id));
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.sheetTitle}>{title}</Text>
          {children}
          <Button label="Cancel" variant="ghost" align="flex-start" onPress={onClose} style={{ marginTop: 12 }} />
        </Pressable>
      </Pressable>
    </Modal>
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.sheetTitle}>{title}</Text>
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
            <Button
              label={busy ? 'Saving…' : 'Save'}
              disabled={busy || !value.trim()}
              onPress={() => onSubmit(value.trim())}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 8,
  },
  title: {
    ...h2,
  },
  center: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  empty: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.neutral600,
    paddingVertical: 14,
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  chevron: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronOpen: {
    transform: [{ rotate: '90deg' }],
  },
  childRow: {
    paddingLeft: 28,
    minHeight: 44,
  },
  topicName: {
    fontFamily: font.extrabold,
    fontSize: 17,
    color: colors.text,
  },
  childName: {
    fontFamily: font.semibold,
    fontSize: 14,
    color: colors.neutral800,
  },
  listRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  listTitle: {
    flex: 1,
    fontFamily: font.semibold,
    fontSize: 15,
    color: colors.text,
  },
  listMeta: {
    flexShrink: 0,
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral600,
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
