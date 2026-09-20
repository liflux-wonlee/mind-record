import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

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
import { colors, font, radius } from '@/theme';

/**
 * Available regardless of which provider (Google/Apple/email) the user
 * actually signed into Mind Record with -- this is a completely separate
 * consent/connection (see src/services/googleTasks.ts), never the login
 * token. "Send" (not "sync"): sending a task never links it to keep
 * updating both ways -- see the Tasks screen's own send action for the
 * per-item side of this.
 */
export default function GoogleTasksSettingsScreen() {
  const [status, setStatus] = useState<GoogleTasksStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [pickingList, setPickingList] = useState(false);
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

  const connect = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      await connectGoogleTasks();
      refresh();
    } catch (e) {
      if (!(e instanceof GoogleTasksCancelledError)) {
        Alert.alert('Could not connect', e instanceof Error ? e.message : 'Please try again.');
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
              Alert.alert('Could not disconnect', e instanceof Error ? e.message : 'Please try again.');
            } finally {
              setDisconnecting(false);
            }
          },
        },
      ]
    );
  };

  const openListPicker = async () => {
    setPickingList(true);
    setLoadingLists(true);
    try {
      const result = await listGoogleTaskLists();
      setLists(result);
    } catch (e) {
      Alert.alert('Could not load your lists', e instanceof Error ? e.message : 'Please try again.');
      setPickingList(false);
    } finally {
      setLoadingLists(false);
    }
  };

  const chooseList = async (list: GoogleTaskList) => {
    setSavingList(list.id);
    try {
      await setDefaultGoogleTaskList(list.id, list.title);
      setStatus((s) => (s ? { ...s, defaultListId: list.id, defaultListTitle: list.title } : s));
      setPickingList(false);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
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
            <Text style={[styles.body, { marginBottom: 14 }]}>{status.defaultListTitle ?? 'Not chosen yet'}</Text>
            <Button
              variant="secondary"
              label="Change"
              onPress={openListPicker}
              align="flex-start"
              style={{ minHeight: 44, borderRadius: radius.pastel, paddingHorizontal: 16 }}
            />
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
            what to send, from that task&apos;s own menu.
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

      <BottomSheet visible={pickingList} onClose={() => setPickingList(false)} title="Choose a list">
        {loadingLists ? (
          <ActivityIndicator color={colors.accent} />
        ) : !lists || lists.length === 0 ? (
          <Text style={styles.body}>No lists found.</Text>
        ) : (
          lists.map((list) => (
            <Button
              key={list.id}
              label={savingList === list.id ? 'Saving…' : list.title}
              align="flex-start"
              variant="secondary"
              disabled={savingList !== null}
              onPress={() => chooseList(list)}
              style={{ marginBottom: 8, borderRadius: radius.pastel }}
            />
          ))
        )}
        <Button label="Cancel" variant="ghost" align="flex-start" onPress={() => setPickingList(false)} />
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
});
