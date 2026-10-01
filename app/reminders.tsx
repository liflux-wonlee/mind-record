/**
 * Everything the app will bring back up: "Today" (the agenda's `now`
 * bucket -- the count Home shows), "Later" (snoozed, not today, upcoming,
 * each with when it comes back) and "By place" (context items, grouped by
 * tag). Every item can be opened, marked done, pushed later, skipped for
 * today or stopped (the task/record itself always stays).
 *
 * Reached from Home's card and from a tapped reminder notification
 * (?focus=<targetType>:<targetId>, see usePushBootstrap). The list is always
 * re-read from the server, so an old notification for something already
 * finished or deleted shows a plain message and never reopens anything.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/BottomSheet';
import { ChevronLeftIcon, XIcon } from '@/components/Icon';
import { Button } from '@/components/ui';
import { useAgenda, usePushPermission } from '@/hooks/useReminders';
import { friendlyMessage } from '@/lib/friendlyError';
import { openNotificationSettings } from '@/lib/push';
import { useAuth } from '@/providers/AuthProvider';
import {
  act,
  agendaReasonLabel,
  DEFAULT_REMINDER_TIME,
  formatDate,
  formatWhen,
  getReminderSettings,
  getTargetState,
  type AgendaItem,
} from '@/services/reminders';
import { setTaskStatus } from '@/services/tasks';
import type { ReminderTargetType } from '@/types/database';
import { colors, font, GUTTER, h2, radius } from '@/theme';

const keyOf = (item: Pick<AgendaItem, 'target_type' | 'target_id'>) => `${item.target_type}:${item.target_id}`;
const TARGET_TYPES: readonly string[] = ['task', 'session', 'memory'];

function parseFocus(focus: string | undefined): { type: ReminderTargetType; id: string } | null {
  if (!focus) return null;
  const [type, id] = focus.split(':');
  if (!TARGET_TYPES.includes(type) || !id) return null;
  return { type: type as ReminderTargetType, id };
}

type LaterOption = { label: string; until: Date };

/** 'at 3:00 PM' / 'tomorrow at 9:00 AM' / 'on Oct 5 at 3:00 PM'. */
function whenPhrase(iso: string): string {
  const text = formatWhen(iso);
  if (text.startsWith('Tomorrow ')) return `tomorrow at ${text.slice('Tomorrow '.length)}`;
  const comma = text.indexOf(', ');
  if (comma > 0) return `on ${text.slice(0, comma)} at ${text.slice(comma + 2)}`;
  return `at ${text}`;
}

function laterOptions(defaultTime: string): LaterOption[] {
  const now = new Date();
  const options: LaterOption[] = [{ label: 'In 1 hour', until: new Date(now.getTime() + 60 * 60 * 1000) }];
  const evening = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0);
  if (evening.getTime() - now.getTime() > 90 * 60 * 1000) {
    options.push({ label: `This evening, ${formatWhen(evening.toISOString())}`, until: evening });
  }
  const [h, m] = defaultTime.split(':').map(Number);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, h || 9, m || 0);
  options.push({ label: `Tomorrow morning, ${formatWhen(tomorrow.toISOString()).replace(/^Tomorrow /, '')}`, until: tomorrow });
  return options;
}

export default function RemindersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const agenda = useAgenda();
  const permission = usePushPermission();
  const [defaultTime, setDefaultTime] = useState(DEFAULT_REMINDER_TIME);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [menuItem, setMenuItem] = useState<AgendaItem | null>(null);
  const [laterItem, setLaterItem] = useState<AgendaItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }, []);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    []
  );

  useEffect(() => {
    if (!user) return;
    getReminderSettings(user.id)
      .then((s) => s?.reminder_time && setDefaultTime(s.reminder_time))
      .catch(() => {});
  }, [user]);

  // ── ?focus= from a notification ─────────────────────────────────────
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [focusMessage, setFocusMessage] = useState<string | null>(null);
  const handledFocusRef = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const itemY = useRef<Record<string, number>>({});
  const scrolledToRef = useRef<string | null>(null);

  const scrollToFocus = useCallback((key: string) => {
    const y = itemY.current[key];
    if (y === undefined || scrolledToRef.current === key) return;
    scrolledToRef.current = key;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
  }, []);

  useEffect(() => {
    if (!focus || handledFocusRef.current === focus || agenda.state.status !== 'ready') return;
    handledFocusRef.current = focus;
    const target = parseFocus(focus);
    if (!target) return;
    const key = `${target.type}:${target.id}`;
    const found = agenda.state.items.find((i) => keyOf(i) === key);
    if (found) {
      setFocusKey(key);
      setFocusMessage(null);
      scrolledToRef.current = null;
      scrollToFocus(key);
      return;
    }
    setFocusKey(null);
    getTargetState(target.type, target.id)
      .then((state) => {
        if (!state.exists) setFocusMessage('This item no longer exists.');
        else if (state.done) setFocusMessage(`Already done: “${state.title}”.`);
        else setFocusMessage(`Nothing to remind you about for “${state.title}” right now.`);
      })
      .catch(() => setFocusMessage('Could not check that reminder. Pull down to refresh.'));
  }, [focus, agenda.state, scrollToFocus]);

  // ── actions ─────────────────────────────────────────────────────────
  const run = async (item: AgendaItem, fn: () => Promise<string | null>) => {
    const key = keyOf(item);
    if (busyKey) return;
    setBusyKey(key);
    try {
      const message = await fn();
      if (message) showNotice(message);
      await agenda.refresh();
    } catch (e) {
      Alert.alert('Could not update', friendlyMessage(e, 'Please try again.'));
    } finally {
      setBusyKey(null);
    }
  };

  const markDone = (item: AgendaItem) =>
    run(item, async () => {
      if (!user) return null;
      if (item.target_type === 'task') {
        const updated = await setTaskStatus(item.target_id, 'completed');
        // A repeating task stays open, moved to its next occurrence.
        if (updated.status === 'open' && updated.due_date) {
          return `Done for this time. Next: ${formatDate(updated.due_date)}.`;
        }
        return `Done: “${item.title}”.`;
      }
      await act(user.id, item.target_type, item.target_id, 'acknowledge');
      return item.purpose === 'waiting' ? 'Got it — no more reply checks for this.' : 'Got it — no more reminders for this.';
    });

  const snooze = (item: AgendaItem, option: LaterOption) => {
    setLaterItem(null);
    return run(item, async () => {
      if (!user) return null;
      const result = await act(user.id, item.target_type, item.target_id, 'snooze', option.until);
      const eff = result.effectiveUntil;
      if (eff && Math.abs(new Date(eff).getTime() - option.until.getTime()) > 60_000) {
        return `Moved to ${formatWhen(eff)} — quiet hours.`;
      }
      return `I’ll remind you ${whenPhrase(eff ?? option.until.toISOString())}.`;
    });
  };

  const notToday = (item: AgendaItem) => {
    setMenuItem(null);
    return run(item, async () => {
      if (!user) return null;
      await act(user.id, item.target_type, item.target_id, 'not_today');
      return 'Okay, not today. It comes back tomorrow.';
    });
  };

  const resume = (item: AgendaItem) => {
    setMenuItem(null);
    return run(item, async () => {
      if (!user) return null;
      await act(user.id, item.target_type, item.target_id, 'resume');
      return 'Back on the list.';
    });
  };

  const confirmStop = (item: AgendaItem) => {
    setMenuItem(null);
    Alert.alert(
      'Stop reminding?',
      item.target_type === 'task'
        ? 'No more reminders for this task. The task itself stays in Tasks.'
        : 'No more reminders for this. The record itself stays.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop reminding',
          style: 'destructive',
          onPress: () =>
            run(item, async () => {
              if (!user) return null;
              await act(user.id, item.target_type, item.target_id, 'stop');
              return 'Stopped. You won’t be reminded about this again.';
            }),
        },
      ]
    );
  };

  const openTarget = (item: AgendaItem) => {
    setMenuItem(null);
    if (item.target_type === 'task') {
      router.push({ pathname: '/tasks', params: { edit: item.target_id } });
    } else if (item.target_type === 'session') {
      router.push({ pathname: '/summary', params: { sessionId: item.target_id } });
    } else if (item.source_session_id) {
      router.push({ pathname: '/summary', params: { sessionId: item.source_session_id } });
    }
  };
  const canOpen = (item: AgendaItem) => item.target_type !== 'memory' || !!item.source_session_id;

  // ── render ──────────────────────────────────────────────────────────
  const renderItem = (item: AgendaItem, tone: string) => {
    const key = keyOf(item);
    const busy = busyKey === key;
    const focused = focusKey === key;
    return (
      <View
        key={key}
        onLayout={(e) => {
          itemY.current[key] = e.nativeEvent.layout.y;
          if (focusKey === key) scrollToFocus(key);
        }}
        style={[styles.item, { backgroundColor: tone }, focused && styles.itemFocused]}
      >
        <Pressable
          accessibilityRole={canOpen(item) ? 'button' : undefined}
          disabled={!canOpen(item)}
          onPress={() => openTarget(item)}
          style={({ pressed }) => [styles.itemBody, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.itemTitle}>{item.title}</Text>
          <Text style={styles.itemReason}>
            {agendaReasonLabel(item)}
            {item.is_recurring ? ' · repeats' : ''}
            {item.target_type !== 'task' ? (item.target_type === 'session' ? ' · record' : ' · idea') : ''}
          </Text>
          {item.note ? (
            <Text style={styles.itemNote} numberOfLines={2}>
              {item.note}
            </Text>
          ) : null}
        </Pressable>
        <View style={styles.itemActions}>
          <Button
            label={busy ? '…' : item.purpose === 'waiting' ? 'Got a reply' : 'Done'}
            variant="save"
            disabled={busyKey !== null}
            onPress={() => markDone(item)}
            style={styles.actionButton}
          />
          <Button
            label="Remind later"
            variant="secondary"
            disabled={busyKey !== null}
            onPress={() => setLaterItem(item)}
            style={styles.actionButton}
          />
          <Button
            label="More"
            variant="ghost"
            disabled={busyKey !== null}
            onPress={() => setMenuItem(item)}
            accessibilityLabel={`More options for ${item.title}`}
          />
        </View>
      </View>
    );
  };

  const contextGroups = agenda.context.reduce<Record<string, AgendaItem[]>>((acc, item) => {
    const tag = item.context_tag?.trim() || 'Somewhere';
    (acc[tag] ??= []).push(item);
    return acc;
  }, {});

  const pushOff = permission.supported && permission.push && !permission.granted;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={agenda.refreshing} onRefresh={agenda.pullToRefresh} />}
      >
        <View style={styles.headerRow}>
          <Button
            variant="ghost"
            label="Back"
            icon={<ChevronLeftIcon size={18} color={colors.accent} />}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            style={styles.back}
            textStyle={{ fontSize: 12 }}
          />
          <Button
            variant="ghost"
            label="Settings"
            onPress={() => router.push('/settings/reminders')}
            textStyle={{ fontSize: 12 }}
          />
        </View>
        <Text style={styles.title}>Reminders</Text>

        {/* Reads out every reminder, then listens: "the second one is
            done", "add a reminder for ..." (a voice conversation). */}
        {agenda.items.length > 0 ? (
          <Button
            label="Listen to all reminders & reply"
            variant="save"
            align="flex-start"
            onPress={() => router.push({ pathname: '/talk', params: { mode: 'conv', briefing: '1' } })}
            style={styles.listen}
          />
        ) : null}

        {pushOff ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Notifications are off on this phone. Reminders still show here and when you listen.
            </Text>
            <Button
              label={permission.push?.canAskAgain ? 'Turn on notifications' : 'Open Settings'}
              variant="secondary"
              align="flex-start"
              onPress={permission.push?.canAskAgain ? permission.turnOn : openNotificationSettings}
              style={styles.bannerButton}
            />
          </View>
        ) : null}

        {focusMessage ? (
          <View style={styles.focusMessage}>
            <Text style={[styles.bannerText, { flex: 1 }]}>{focusMessage}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              onPress={() => setFocusMessage(null)}
              style={styles.dismiss}
            >
              <XIcon size={16} color={colors.neutral700} />
            </Pressable>
          </View>
        ) : null}

        {agenda.state.status === 'loading' ? (
          <Text style={styles.empty}>Loading…</Text>
        ) : agenda.state.status === 'error' ? (
          <View>
            <Text style={styles.empty}>{agenda.state.message}</Text>
            <Button label="Retry" variant="secondary" align="flex-start" onPress={agenda.refresh} />
          </View>
        ) : (
          <>
            <Text style={styles.section}>Today</Text>
            {agenda.now.length === 0 ? (
              <Text style={styles.empty}>Nothing to keep in mind right now.</Text>
            ) : (
              agenda.now.map((item) => renderItem(item, colors.pastelYellow))
            )}

            <Text style={styles.section}>Later</Text>
            {agenda.later.length === 0 ? (
              <Text style={styles.empty}>Nothing scheduled yet. Tasks with a due date are reminded the day before and on the day.</Text>
            ) : (
              agenda.later.map((item) => renderItem(item, colors.pastelBlue))
            )}

            {agenda.context.length > 0 ? (
              <>
                <Text style={styles.section}>By place</Text>
                <Text style={styles.hint}>
                  Automatic location detection isn’t available yet — open this list when you get there, or ask
                  “what should I do at home?”
                </Text>
                {Object.entries(contextGroups).map(([tag, items]) => (
                  <React.Fragment key={tag}>
                    <Text style={styles.placeHeading}>{tag}</Text>
                    {items.map((item) => renderItem(item, colors.pastelGreen))}
                  </React.Fragment>
                ))}
              </>
            ) : null}

            <Text style={[styles.hint, { marginTop: 24 }]}>
              Reminders are sent by our server and can arrive a little late depending on your network and phone.
            </Text>
          </>
        )}
      </ScrollView>

      {notice ? (
        <View style={[styles.snackbar, { bottom: 16 + insets.bottom }]}>
          <Text style={styles.snackbarText}>{notice}</Text>
        </View>
      ) : null}

      <BottomSheet
        visible={laterItem !== null}
        onClose={() => setLaterItem(null)}
        title={laterItem ? `Remind me later: ${laterItem.title}` : ''}
        titleLines={1}
      >
        <View style={{ gap: 8 }}>
          {laterItem
            ? laterOptions(defaultTime).map((option) => (
                <Button
                  key={option.label}
                  label={option.label}
                  align="flex-start"
                  variant="secondary"
                  onPress={() => snooze(laterItem, option)}
                  style={{ borderRadius: radius.pastel }}
                />
              ))
            : null}
        </View>
        <Text style={[styles.hint, { marginTop: 8 }]}>
          Only the reminder moves — the due date stays the same.
        </Text>
        <Button label="Cancel" variant="ghost" align="flex-start" onPress={() => setLaterItem(null)} style={{ marginTop: 8 }} />
      </BottomSheet>

      <BottomSheet
        visible={menuItem !== null}
        onClose={() => setMenuItem(null)}
        title={menuItem?.title ?? ''}
        titleLines={1}
      >
        {menuItem ? (
          <View style={{ gap: 8 }}>
            {canOpen(menuItem) ? (
              <Button
                label={menuItem.target_type === 'task' ? 'Open task' : 'Open record'}
                variant="secondary"
                align="flex-start"
                onPress={() => openTarget(menuItem)}
                style={{ borderRadius: radius.pastel }}
              />
            ) : null}
            {menuItem.bucket === 'now' ? (
              <Button
                label="Not today"
                variant="secondary"
                align="flex-start"
                onPress={() => notToday(menuItem)}
                style={{ borderRadius: radius.pastel }}
              />
            ) : null}
            {menuItem.reason === 'snoozed' || menuItem.reason === 'not_today' ? (
              <Button
                label="Bring back now"
                variant="secondary"
                align="flex-start"
                onPress={() => resume(menuItem)}
                style={{ borderRadius: radius.pastel }}
              />
            ) : null}
            <Button
              label="Stop reminding"
              variant="danger"
              align="flex-start"
              onPress={() => confirmStop(menuItem)}
            />
          </View>
        ) : null}
        <Button label="Cancel" variant="ghost" align="flex-start" onPress={() => setMenuItem(null)} style={{ marginTop: 8 }} />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: GUTTER,
    paddingTop: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  back: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingLeft: 0,
    marginLeft: -4,
  },
  title: {
    ...h2,
    marginTop: 2,
    marginBottom: 12,
  },
  listen: {
    borderRadius: radius.pastel,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  banner: {
    marginTop: 12,
    padding: 14,
    borderRadius: radius.pastel,
    backgroundColor: colors.pastelPeach,
  },
  bannerText: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.text,
  },
  bannerButton: {
    marginTop: 10,
    borderRadius: radius.pastel,
    alignSelf: 'flex-start',
  },
  focusMessage: {
    marginTop: 12,
    paddingLeft: 14,
    borderRadius: radius.pastel,
    backgroundColor: colors.pastelPink,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dismiss: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    fontFamily: font.extrabold,
    fontSize: 13,
    letterSpacing: 13 * 0.08,
    textTransform: 'uppercase',
    color: colors.neutral700,
    marginTop: 22,
    marginBottom: 8,
  },
  placeHeading: {
    fontFamily: font.semibold,
    fontSize: 15,
    color: colors.text,
    marginTop: 8,
    marginBottom: 6,
  },
  empty: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.neutral700,
    paddingVertical: 6,
  },
  hint: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.neutral600,
    marginBottom: 6,
  },
  item: {
    borderRadius: radius.pastel,
    padding: 12,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  itemFocused: {
    borderColor: colors.accent700,
  },
  itemBody: {
    minHeight: 44,
    paddingHorizontal: 2,
  },
  itemTitle: {
    fontFamily: font.semibold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
  },
  itemReason: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.neutral800,
    marginTop: 2,
  },
  itemNote: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.neutral700,
    marginTop: 4,
  },
  itemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  actionButton: {
    borderRadius: radius.pastel,
    paddingHorizontal: 14,
  },
  snackbar: {
    position: 'absolute',
    left: GUTTER,
    right: GUTTER,
    padding: 14,
    borderRadius: radius.pastel,
    backgroundColor: colors.neutral900,
  },
  snackbarText: {
    fontFamily: font.semibold,
    fontSize: 13,
    lineHeight: 19,
    color: colors.bg,
  },
});
