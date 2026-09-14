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

import { Screen } from '@/components/Screen';
import { Button, CardKicker, Kicker, Row, RuleThick } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
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

const THREADS = [
  { title: 'Subscription Service Idea', meta: '5 · Jun 4 → Sep 11' },
  { title: 'Migration Wizard', meta: '2 · paused' },
];

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
      <Kicker style={{ color: colors.neutral600 }}>Memory</Kicker>
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

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : loadError ? (
        <Text style={styles.empty}>{loadError}</Text>
      ) : roots.length === 0 ? (
        <Text style={styles.empty}>No topics yet — create one, or just talk and one will get suggested.</Text>
      ) : (
        roots.map((topic) => (
          <View key={topic.id}>
            <Row onPress={() => setSheet({ kind: 'menu', topic })} style={styles.topicRow}>
              <Text style={styles.topicName}>{topic.name}</Text>
            </Row>
            {childrenOf(topic.id).map((child) => (
              <Row
                key={child.id}
                onPress={() => setSheet({ kind: 'menu', topic: child })}
                style={[styles.topicRow, styles.childRow]}
              >
                <Text style={styles.childName}>{child.name}</Text>
              </Row>
            ))}
          </View>
        ))
      )}

      <Kicker style={{ color: colors.neutral600, marginTop: 20 }}>Idea threads</Kicker>
      <RuleThick style={{ marginTop: 6 }} />
      {THREADS.map((thread) => (
        <Row key={thread.title} onPress={() => router.push('/thread')} style={styles.listRow}>
          <Text style={styles.listTitle}>{thread.title}</Text>
          <Text style={styles.listMeta}>{thread.meta}</Text>
        </Row>
      ))}

      <Kicker style={{ color: colors.neutral600, marginTop: 20 }}>Journal</Kicker>
      <RuleThick style={{ marginTop: 6 }} />
      <Row onPress={() => router.push('/journal')} style={styles.listRow}>
        <Text style={styles.listTitle}>September 11, 2026</Text>
        <Text style={styles.listMeta}>auto-generated</Text>
      </Row>

      <View style={styles.rediscover}>
        <CardKicker>Rediscover</CardKicker>
        <Text style={styles.rediscoverTitle}>AI-based customer onboarding assistant</Text>
        <Text style={styles.rediscoverNote}>
          4개월 전에 이야기했지만 다시 언급하지 않은 아이디어입니다.
        </Text>
        <View style={styles.rediscoverActions}>
          <Button variant="secondary" label="Revisit" style={{ minHeight: 40 }} />
          <Button variant="ghost" label="Archive" style={{ minHeight: 40 }} />
        </View>
      </View>

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
    minHeight: 52,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  childRow: {
    paddingLeft: 16,
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
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  listTitle: {
    fontFamily: font.semibold,
    fontSize: 15,
    color: colors.text,
  },
  listMeta: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral600,
  },
  rediscover: {
    marginTop: 20,
    backgroundColor: colors.accent100,
    padding: 12,
  },
  rediscoverTitle: {
    fontFamily: font.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    marginTop: 4,
  },
  rediscoverNote: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral700,
    marginTop: 2,
    marginBottom: 8,
  },
  rediscoverActions: {
    flexDirection: 'row',
    gap: 8,
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
