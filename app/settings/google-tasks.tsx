import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Screen } from '@/components/Screen';
import { SettingsHeader } from '@/components/SettingsHeader';
import { Button, Kicker } from '@/components/ui';
import {
  connectGoogleTasks,
  disconnectGoogleTasks,
  getGoogleTasksStatus,
  GoogleTasksCancelledError,
  listGoogleTaskLists,
  setDefaultGoogleTaskList,
  type GoogleTaskList,
  type GoogleTasksStatus,
} from '@/services/googleTasks';
import { listTaskLists, setTaskListGoogleList, type TaskList } from '@/services/taskLists';
import { friendlyMessage } from '@/lib/friendlyError';
import { useAuth } from '@/providers/AuthProvider';
import { colors, font, radius } from '@/theme';

/**
 * Available regardless of which provider (Google/Apple/email) the user
 * actually signed into Mind Record with -- this is a completely separate
 * consent/connection (see src/services/googleTasks.ts), never the login
 * token. "Send" (not "sync"): sending a task never links it to keep
 * updating both ways -- see the Tasks screen's own send action for the
 * per-item side of this.
 *
 * Each of the app's task lists can go to its own Google list: automatic
 * (the Google list with the same name, created on first send) or one the
 * user picks -- listed here all together, and also editable per list from
 * the Tasks screen (long-press the list).
 */
/** What the list picker is choosing for: the default list, or one app list's destination. */
type PickerTarget = { kind: 'default' } | { kind: 'list'; list: TaskList };

export default function GoogleTasksSettingsScreen() {
  const { user } = useAuth();
  const [status, setStatus] = useState<GoogleTasksStatus | null>(null);
  const [appLists, setAppLists] = useState<TaskList[] | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [pickingList, setPickingList] = useState<PickerTarget | null>(null);
  const [lists, setLists] = useState<GoogleTaskList[] | null>(null);
  const [loadingLists, setLoadingLists] = useState(false);
  const [savingList, setSavingList] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getGoogleTasksStatus()
      .then(setStatus)
      .catch(() => {
        // Leave the section in its previous state rather than showing an
        // error card for what's a secondary, optional settings section.
      });
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    if (!user || !status?.connected) return;
    let cancelled = false;
    listTaskLists(user.id)
      .then((result) => {
        if (!cancelled) setAppLists(result);
      })
      .catch(() => {
        if (!cancelled) setAppLists([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user, status?.connected]);

  const connect = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      await connectGoogleTasks();
      refresh();
    } catch (e) {
      if (!(e instanceof GoogleTasksCancelledError)) {
        Alert.alert('Could not connect', friendlyMessage(e, 'Please try again.'));
      }
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    if (disconnecting) return;
    Alert.alert(
      'Disconnect Google Tasks?',
      'Tasks already sent stay in Google Tasks -- this only stops future sends.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setDisconnecting(true);
            try {
              await disconnectGoogleTasks();
              setStatus({ connected: false, email: null, defaultListId: null, defaultListTitle: null });
            } catch (e) {
              Alert.alert('Could not disconnect', friendlyMessage(e, 'Please try again.'));
            } finally {
              setDisconnecting(false);
            }
          },
        },
      ]
    );
  };

  const openListPicker = async (target: PickerTarget) => {
    setPickingList(target);
    if (lists) return; // already loaded this visit
    setLoadingLists(true);
    try {
      const result = await listGoogleTaskLists();
      setLists(result);
    } catch (e) {
      Alert.alert('Could not load your lists', friendlyMessage(e, 'Please try again.'));
      setPickingList(null);
    } finally {
      setLoadingLists(false);
    }
  };

  // `list` null = automatic (same name) -- only offered for an app list.
  const chooseList = async (list: GoogleTaskList | null) => {
    const target = pickingList;
    if (!target) return;
    setSavingList(list?.id ?? 'auto');
    try {
      if (target.kind === 'default') {
        if (!list) return;
        await setDefaultGoogleTaskList(list.id, list.title);
        setStatus((s) => (s ? { ...s, defaultListId: list.id, defaultListTitle: list.title } : s));
      } else {
        const updated = await setTaskListGoogleList(target.list.id, list ? { id: list.id, title: list.title } : null);
        setAppLists((cur) => cur?.map((l) => (l.id === updated.id ? updated : l)) ?? cur);
      }
      setPickingList(null);
    } catch (e) {
      Alert.alert('Could not save', friendlyMessage(e, 'Please try again.'));
    } finally {
      setSavingList(null);
    }
  };

  return (
    <Screen showAccount={false}>
      <SettingsHeader title="Google Tasks" />
      {!status ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} />
      ) : status.connected ? (
        <>
          <View style={[styles.card, { backgroundColor: colors.pastelGreen }]}>
            <Kicker style={{ color: colors.neutral700, marginBottom: 6 }}>Connected</Kicker>
            <Text style={styles.body}>{status.email}</Text>
          </View>

          <View style={styles.card}>
            <Kicker style={{ color: colors.neutral600, marginBottom: 6 }}>Default list</Kicker>
            <Text style={[styles.body, { marginBottom: 6 }]}>{status.defaultListTitle ?? 'Not chosen yet'}</Text>
            <Text style={[styles.hint, { marginBottom: 14 }]}>
              For tasks that aren&apos;t in any of your lists.
            </Text>
            <Button
              variant="secondary"
              label="Change"
              onPress={() => openListPicker({ kind: 'default' })}
              align="flex-start"
              style={{ minHeight: 44, borderRadius: radius.pastel, paddingHorizontal: 16 }}
            />
          </View>

          <View style={styles.card}>
            <Kicker style={{ color: colors.neutral600, marginBottom: 6 }}>Your lists</Kicker>
            <Text style={[styles.hint, { marginBottom: 10 }]}>
              Where each list&apos;s tasks go when sent. Automatic uses the Google list with the same name, and
              creates it there on the first send if it doesn&apos;t exist yet. Tap a list to change it.
            </Text>
            {appLists === null ? (
              <ActivityIndicator color={colors.accent} style={{ alignSelf: 'flex-start' }} />
            ) : appLists.length === 0 ? (
              <Text style={styles.body}>No lists yet -- make one in Tasks.</Text>
            ) : (
              appLists.map((l) => (
                <Pressable
                  key={l.id}
                  onPress={() => openListPicker({ kind: 'list', list: l })}
                  style={({ pressed }) => [styles.mappingRow, pressed && { opacity: 0.6 }]}
                >
                  <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>
                    {l.name}
                  </Text>
                  <Text style={[styles.hint, { flexShrink: 1, textAlign: 'right' }]} numberOfLines={1}>
                    → {l.google_task_list_title ?? `Automatic ("${l.name}")`}
                  </Text>
                </Pressable>
              ))
            )}
          </View>

          <Button
            variant="ghost"
            label={disconnecting ? 'Disconnecting…' : 'Disconnect'}
            disabled={disconnecting}
            onPress={disconnect}
            align="flex-start"
            style={{ marginTop: 4 }}
            textStyle={{ fontSize: 13, color: colors.accent700 }}
          />
        </>
      ) : (
        <View style={styles.card}>
          <Text style={styles.body}>
            Connect a Google account to send tasks to Google Tasks. This never syncs automatically -- you choose
            what to send, from that task&apos;s own menu, or by asking in a Conversation (&quot;구글 태스크에도
            넣어줘&quot;).
          </Text>
          <Button
            label={connecting ? 'Connecting…' : 'Connect Google Tasks'}
            disabled={connecting}
            onPress={connect}
            align="flex-start"
            style={{ minHeight: 46, borderRadius: radius.pastel, paddingHorizontal: 18, marginTop: 14 }}
          />
        </View>
      )}

      <BottomSheet
        visible={pickingList !== null}
        onClose={() => setPickingList(null)}
        title={pickingList?.kind === 'list' ? `Send "${pickingList.list.name}" to` : 'Choose a list'}
      >
        {loadingLists ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <>
            {pickingList?.kind === 'list' ? (
              <Button
                label={savingList === 'auto' ? 'Saving…' : `Automatic -- same name ("${pickingList.list.name}")`}
                align="flex-start"
                variant="secondary"
                disabled={savingList !== null}
                onPress={() => chooseList(null)}
                style={{
                  marginBottom: 8,
                  borderRadius: radius.pastel,
                  backgroundColor: !pickingList.list.google_task_list_id ? colors.pastelGreen : undefined,
                }}
              />
            ) : null}
            {!lists || lists.length === 0 ? (
              <Text style={styles.body}>No lists found.</Text>
            ) : (
              lists.map((list) => {
                const selected =
                  pickingList?.kind === 'list'
                    ? pickingList.list.google_task_list_id === list.id
                    : status?.defaultListId === list.id;
                return (
                  <Button
                    key={list.id}
                    label={savingList === list.id ? 'Saving…' : list.title}
                    align="flex-start"
                    variant="secondary"
                    disabled={savingList !== null}
                    onPress={() => chooseList(list)}
                    style={{
                      marginBottom: 8,
                      borderRadius: radius.pastel,
                      backgroundColor: selected ? colors.pastelGreen : undefined,
                    }}
                  />
                );
              })
            )}
          </>
        )}
        <Button label="Cancel" variant="ghost" align="flex-start" onPress={() => setPickingList(null)} />
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.pastel,
    backgroundColor: colors.surface,
    padding: 16,
    marginBottom: 14,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.text,
  },
  mappingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.neutral300,
  },
  hint: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral600,
  },
});
