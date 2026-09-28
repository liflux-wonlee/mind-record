import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ChevronLeftIcon, ChevronRightIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { StarToggle } from '@/components/StarToggle';
import { Button, CardKicker, Kicker, Row, RuleThick } from '@/components/ui';
import { friendlyMessage } from '@/lib/friendlyError';
import { useAuth } from '@/providers/AuthProvider';
import {
  deleteSession,
  deleteSessionMessage,
  listSessionsInMonth,
  listSessionsPage,
  listStarredSessionsPage,
  sessionModeLabel,
  setSessionStarred,
  type Session,
  type SessionsPageCursor,
} from '@/services/sessions';
import { colors, font, h2, monthColors, radius } from '@/theme';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const LIST_PAGE_SIZE = 30;

const CARD_COLORS = [
  colors.pastelPink,
  colors.pastelBlue,
  colors.pastelGreen,
  colors.pastelYellow,
  colors.pastelLavender,
  colors.pastelPeach,
];
function cardColor(i: number): string {
  return CARD_COLORS[i % CARD_COLORS.length];
}

/**
 * Splits the month into explicit 7-cell week rows (`null` for a leading/
 * trailing blank). Rendering each week as its own `flexDirection: 'row'`
 * of exactly 7 `flex: 1` cells -- rather than one long `flexWrap: 'wrap'`
 * row of `width: '14.2857…%'` cells -- avoids a real bug that showed up
 * here: percentage widths that don't divide evenly accumulate enough
 * sub-pixel rounding error that the 7th cell of a row overflows and wraps
 * early, which silently shifts every later day by however many cells wrapped
 * prematurely (e.g. the 16th rendering under Friday instead of Wednesday).
 */
function weeksOf(leadingBlanks: number, daysInMonth: number): (number | null)[][] {
  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

type ViewMode = 'calendar' | 'list' | 'starred';

export default function RecordsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [mode, setMode] = useState<ViewMode>('calendar');

  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState(now);

  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();
  const today = now.getDate();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const leadingBlanks = new Date(viewYear, viewMonth, 1).getDay();
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  const monthShort = new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, { month: 'long' });

  const goToMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };
  const goToToday = () => {
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setSelectedDate(now);
  };

  const [sessionsByDay, setSessionsByDay] = useState<Map<number, Session[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadMonth = useCallback(() => {
    if (!user) return;
    setLoading(true);
    setError(false);
    listSessionsInMonth(user.id, viewYear, viewMonth)
      .then((sessions) => {
        const map = new Map<number, Session[]>();
        for (const s of sessions) {
          const day = new Date(s.started_at).getDate();
          const list = map.get(day) ?? [];
          list.push(s);
          map.set(day, list);
        }
        setSessionsByDay(map);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [user, viewYear, viewMonth]);

  useFocusEffect(
    useCallback(() => {
      if (mode === 'calendar') loadMonth();
    }, [mode, loadMonth])
  );

  const [listSessions, setListSessions] = useState<Session[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listLoadingMore, setListLoadingMore] = useState(false);
  const [listHasMore, setListHasMore] = useState(true);
  const [listError, setListError] = useState(false);

  const loadList = useCallback(() => {
    if (!user) return;
    setListLoading(true);
    setListError(false);
    listSessionsPage(user.id, { limit: LIST_PAGE_SIZE })
      .then((sessions) => {
        setListSessions(sessions);
        setListHasMore(sessions.length === LIST_PAGE_SIZE);
      })
      .catch(() => setListError(true))
      .finally(() => setListLoading(false));
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (mode === 'list') loadList();
    }, [mode, loadList])
  );

  const loadMoreList = () => {
    if (!user || listLoadingMore || listSessions.length === 0) return;
    setListLoadingMore(true);
    const last = listSessions[listSessions.length - 1];
    const cursor: SessionsPageCursor = { startedAt: last.started_at, id: last.id };
    listSessionsPage(user.id, { before: cursor, limit: LIST_PAGE_SIZE })
      .then((sessions) => {
        setListSessions((prev) => [...prev, ...sessions]);
        setListHasMore(sessions.length === LIST_PAGE_SIZE);
      })
      .catch(() => setListError(true))
      .finally(() => setListLoadingMore(false));
  };

  // The Starred view: favorite records only, newest first, paged like List.
  const [starredSessions, setStarredSessions] = useState<Session[]>([]);
  const [starredLoading, setStarredLoading] = useState(true);
  const [starredLoadingMore, setStarredLoadingMore] = useState(false);
  const [starredHasMore, setStarredHasMore] = useState(false);
  const [starredError, setStarredError] = useState(false);

  const loadStarred = useCallback(() => {
    if (!user) return;
    setStarredLoading(true);
    setStarredError(false);
    listStarredSessionsPage(user.id, { limit: LIST_PAGE_SIZE })
      .then((sessions) => {
        setStarredSessions(sessions);
        setStarredHasMore(sessions.length === LIST_PAGE_SIZE);
      })
      .catch(() => setStarredError(true))
      .finally(() => setStarredLoading(false));
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (mode === 'starred') loadStarred();
    }, [mode, loadStarred])
  );

  const loadMoreStarred = () => {
    if (!user || starredLoadingMore || starredSessions.length === 0) return;
    setStarredLoadingMore(true);
    const last = starredSessions[starredSessions.length - 1];
    listStarredSessionsPage(user.id, { before: { startedAt: last.started_at, id: last.id }, limit: LIST_PAGE_SIZE })
      .then((sessions) => {
        setStarredSessions((prev) => [...prev, ...sessions]);
        setStarredHasMore(sessions.length === LIST_PAGE_SIZE);
      })
      .catch(() => setStarredError(true))
      .finally(() => setStarredLoadingMore(false));
  };

  // Star/unstar from any view: update every loaded copy of the row in place
  // (unstarring in the Starred view drops it from that view).
  const toggleStar = (session: Session) => {
    setSessionStarred(session.id, !session.starred)
      .then((updated) => {
        const swap = (list: Session[]) => list.map((s) => (s.id === updated.id ? updated : s));
        setListSessions(swap);
        setSessionsByDay((prev) => {
          const next = new Map<number, Session[]>();
          prev.forEach((list, day) => next.set(day, swap(list)));
          return next;
        });
        setStarredSessions((prev) =>
          updated.starred
            ? prev.some((s) => s.id === updated.id)
              ? swap(prev)
              : prev
            : prev.filter((s) => s.id !== updated.id)
        );
      })
      .catch((e) => Alert.alert('Could not update', friendlyMessage(e, 'Please try again.')));
  };

  const dayConversations = sessionsByDay.get(selectedDate.getDate()) ?? [];
  const selectedInViewMonth =
    selectedDate.getFullYear() === viewYear && selectedDate.getMonth() === viewMonth;

  const confirmDeleteSession = (session: Session, onDone: () => void) => {
    Alert.alert(
      session.mode === 'note' ? 'Delete this note?' : 'Delete this recording?',
      deleteSessionMessage(session),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deleteSession(session.id)
              .then(onDone)
              .catch((e) => Alert.alert('Could not delete', friendlyMessage(e, 'Please try again.'))),
        },
      ]
    );
  };

  return (
    <Screen>
      <Button
        variant="ghost"
        label="Home"
        icon={<ChevronLeftIcon size={18} color={colors.accent} />}
        onPress={() => router.push('/')}
        style={styles.back}
        textStyle={{ fontSize: 12 }}
      />
      <View style={styles.headRow}>
        <Kicker style={{ color: colors.neutral600 }}>All records</Kicker>
        <View style={styles.modeSeg}>
          <ModeOption label="Calendar" selected={mode === 'calendar'} onPress={() => setMode('calendar')} />
          <ModeOption label="List" selected={mode === 'list'} onPress={() => setMode('list')} divided />
          <ModeOption label="★ Starred" selected={mode === 'starred'} onPress={() => setMode('starred')} divided />
        </View>
      </View>

      {mode === 'calendar' ? (
        <>
          <View style={styles.monthRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => goToMonth(-1)} style={styles.monthArrow}>
              <ChevronLeftIcon size={20} color={colors.text} />
            </Pressable>
            <Text style={[styles.title, { color: monthColors[viewMonth] }]}>{monthLabel}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => goToMonth(1)} style={styles.monthArrow}>
              <ChevronRightIcon size={20} color={colors.text} />
            </Pressable>
          </View>
          {!isCurrentMonth ? (
            <Button variant="ghost" label="Today" onPress={goToToday} style={styles.todayButton} textStyle={{ fontSize: 12 }} />
          ) : null}

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : error ? (
            <Text style={styles.empty}>Couldn&apos;t load your calendar.</Text>
          ) : (
            <>
              <View style={styles.weekdays}>
                {WEEKDAYS.map((d) => (
                  <Text key={d} style={styles.weekday}>
                    {d}
                  </Text>
                ))}
              </View>

              {weeksOf(leadingBlanks, daysInMonth).map((week, w) => (
                <View key={w} style={styles.weekRow}>
                  {week.map((n, i) => {
                    if (n === null) {
                      return <View key={i} style={[styles.day, styles.dayRule]} />;
                    }
                    const count = (sessionsByDay.get(n) ?? []).length;
                    const selected = selectedInViewMonth && n === selectedDate.getDate();
                    const isFuture = isCurrentMonth && n > today;
                    return (
                      <Pressable
                        key={i}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`${monthShort} ${n}`}
                        onPress={() => setSelectedDate(new Date(viewYear, viewMonth, n))}
                        style={({ pressed }) => [
                          styles.day,
                          styles.dayCell,
                          styles.dayRule,
                          selected && { backgroundColor: colors.accent },
                          pressed && !selected && { backgroundColor: colors.neutral200 },
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayNumber,
                            { color: selected ? colors.bg : isFuture ? colors.neutral500 : colors.text },
                          ]}
                        >
                          {n}
                        </Text>
                        <Text style={[styles.dots, { color: selected ? colors.bg : colors.text }]}>
                          {'•'.repeat(Math.min(count, 6))}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}

              <View style={styles.selectedHead}>
                <Kicker style={{ color: colors.neutral600 }}>
                  {selectedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </Kicker>
                <Text style={styles.selectedCount}>
                  {dayConversations.length} {dayConversations.length === 1 ? 'conversation' : 'conversations'}
                </Text>
              </View>

              <RuleThick style={{ marginTop: 8, marginBottom: 20 }} />
              {dayConversations.map((session, i) => (
                <Row
                  key={session.id}
                  onPress={() => router.push({ pathname: '/summary', params: { sessionId: session.id } })}
                  onLongPress={() => confirmDeleteSession(session, loadMonth)}
                  style={[styles.convo, { backgroundColor: cardColor(i) }]}
                >
                  <Text style={styles.convoTime}>
                    {new Date(session.started_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                  <View style={styles.convoBody}>
                    <CardKicker>{sessionModeLabel(session.mode)}</CardKicker>
                    <Text style={styles.convoTitle}>{session.title ?? session.summary ?? 'Untitled session'}</Text>
                    {session.processing_status !== 'done' ? <Text style={styles.convoMeta}>Processing…</Text> : null}
                  </View>
                  <StarToggle starred={session.starred} onToggle={() => toggleStar(session)} label="record" style={styles.star} />
                </Row>
              ))}
              {dayConversations.length > 0 ? <Text style={styles.hint}>Hold a conversation for more options</Text> : null}
              {dayConversations.length === 0 ? <Text style={styles.empty}>No conversations on this day.</Text> : null}
            </>
          )}
        </>
      ) : mode === 'starred' ? (
        <>
          {starredLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : starredError ? (
            <Text style={styles.empty}>Couldn&apos;t load your starred records.</Text>
          ) : starredSessions.length === 0 ? (
            <Text style={styles.empty}>No starred records yet. Tap the ☆ on a record to keep it here.</Text>
          ) : (
            <>
              <RuleThick style={{ marginTop: 10, marginBottom: 20 }} />
              {starredSessions.map((session, i) => (
                <Row
                  key={session.id}
                  onPress={() => router.push({ pathname: '/summary', params: { sessionId: session.id } })}
                  onLongPress={() => confirmDeleteSession(session, loadStarred)}
                  style={[styles.convo, { backgroundColor: cardColor(i) }]}
                >
                  <Text style={styles.convoDate}>
                    {new Date(session.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </Text>
                  <View style={styles.convoBody}>
                    <CardKicker>{sessionModeLabel(session.mode)}</CardKicker>
                    <Text style={styles.convoTitle}>{session.title ?? session.summary ?? 'Untitled session'}</Text>
                  </View>
                  <StarToggle starred={session.starred} onToggle={() => toggleStar(session)} label="record" style={styles.star} />
                </Row>
              ))}
              {starredHasMore ? (
                <Button
                  variant="secondary"
                  label={starredLoadingMore ? 'Loading…' : 'Load more'}
                  disabled={starredLoadingMore}
                  onPress={loadMoreStarred}
                  style={{ marginTop: 14, minHeight: 48 }}
                />
              ) : null}
            </>
          )}
        </>
      ) : (
        <>
          {listLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : listError ? (
            <Text style={styles.empty}>Couldn&apos;t load your records.</Text>
          ) : listSessions.length === 0 ? (
            <Text style={styles.empty}>No records yet.</Text>
          ) : (
            <>
              <RuleThick style={{ marginTop: 10, marginBottom: 20 }} />
              {listSessions.map((session, i) => (
                <Row
                  key={session.id}
                  onPress={() => router.push({ pathname: '/summary', params: { sessionId: session.id } })}
                  onLongPress={() => confirmDeleteSession(session, loadList)}
                  style={[styles.convo, { backgroundColor: cardColor(i) }]}
                >
                  <Text style={styles.convoDate}>
                    {new Date(session.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </Text>
                  <View style={styles.convoBody}>
                    <CardKicker>{sessionModeLabel(session.mode)}</CardKicker>
                    <Text style={styles.convoTitle}>{session.title ?? session.summary ?? 'Untitled session'}</Text>
                    {session.processing_status !== 'done' ? <Text style={styles.convoMeta}>Processing…</Text> : null}
                  </View>
                  <StarToggle starred={session.starred} onToggle={() => toggleStar(session)} label="record" style={styles.star} />
                </Row>
              ))}
              <Text style={styles.hint}>Hold a conversation for more options</Text>
              {listHasMore ? (
                <Button
                  variant="secondary"
                  label={listLoadingMore ? 'Loading…' : 'Load more'}
                  disabled={listLoadingMore}
                  onPress={loadMoreList}
                  style={{ marginTop: 14, minHeight: 48 }}
                />
              ) : (
                <Text style={styles.empty}>No more records.</Text>
              )}
            </>
          )}
        </>
      )}
    </Screen>
  );
}

function ModeOption({
  label,
  selected,
  onPress,
  divided,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  divided?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.modeOpt, divided && styles.modeDivider, selected && { backgroundColor: colors.accent }]}
    >
      <Text style={[styles.modeText, selected && { color: colors.bg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingLeft: 0,
    marginLeft: -4,
  },
  headRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modeSeg: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.pastel,
    overflow: 'hidden',
  },
  modeOpt: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  modeDivider: {
    borderLeftWidth: 1,
    borderLeftColor: colors.divider,
  },
  modeText: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.text,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
  },
  monthArrow: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...h2,
    fontSize: 24,
    lineHeight: 27,
    flex: 1,
    textAlign: 'center',
  },
  todayButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    marginBottom: 6,
    paddingHorizontal: 0,
  },
  center: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  weekdays: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: colors.divider,
    paddingBottom: 6,
    marginTop: 8,
  },
  weekday: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    textAlign: 'center',
    fontFamily: font.semibold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 9 * 0.08,
    color: colors.neutral600,
  },
  weekRow: {
    flexDirection: 'row',
  },
  // Every cell -- blank or not -- must be exactly 1/7 of the row, matching
  // the weekday header. Yoga counts horizontal padding as a cell's minimum
  // width on top of `flex: 1`, so padded day cells next to unpadded blanks
  // came out wider and the numbers drifted off their weekday columns in
  // any week with blanks (the first and last). Hence: no horizontal
  // padding, a zero basis, and no min-content width.
  day: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 48,
  },
  dayCell: {
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 5,
    overflow: 'hidden',
  },
  dayRule: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  dayNumber: {
    fontFamily: font.semibold,
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
  },
  dots: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 12,
    letterSpacing: 2,
    textAlign: 'center',
  },
  selectedHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 18,
  },
  selectedCount: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral600,
  },
  convo: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    marginBottom: 8,
    borderRadius: radius.pastel,
  },
  convoTime: {
    width: 64,
    fontFamily: font.extrabold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.neutral700,
  },
  convoDate: {
    width: 64,
    fontFamily: font.extrabold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.neutral700,
  },
  convoBody: {
    flex: 1,
  },
  star: {
    // Sits in the card's padding so the title keeps its width.
    marginTop: -10,
    marginRight: -10,
  },
  convoTitle: {
    fontFamily: font.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
    marginTop: 4,
  },
  convoMeta: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral700,
  },
  empty: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.neutral600,
    marginTop: 12,
  },
  hint: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral600,
    marginTop: 2,
    marginBottom: 4,
    textAlign: 'center',
  },
});
