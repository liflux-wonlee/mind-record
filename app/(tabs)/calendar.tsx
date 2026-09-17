import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ChevronLeftIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, CardKicker, Kicker, Row, RuleThick } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import { deleteSession, listSessionsInMonth, type Session } from '@/services/sessions';
import { useApp } from '@/store';
import { colors, font, h2 } from '@/theme';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
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

export default function CalendarScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { selectedDay, setSelectedDay } = useApp();

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = new Date(year, month, 1).getDay();
  const monthLabel = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const monthShort = now.toLocaleDateString(undefined, { month: 'long' });

  // useApp()'s selectedDay defaults to a fixed 11 (always a valid day in any
  // real month), but a real "today" is a friendlier first selection — set it
  // once, without overriding whatever the user picks afterwards.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    setSelectedDay(today);
  }, [today, setSelectedDay]);

  const [sessionsByDay, setSessionsByDay] = useState<Map<number, Session[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadMonth = useCallback(() => {
    if (!user) return;
    setLoading(true);
    setError(false);
    listSessionsInMonth(user.id, year, month)
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
  }, [user, year, month]);

  useFocusEffect(
    useCallback(() => {
      loadMonth();
    }, [loadMonth])
  );

  const dayConversations = sessionsByDay.get(selectedDay) ?? [];

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
              .then(loadMonth)
              .catch((e) => Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.')),
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
      <Kicker style={{ color: colors.neutral600 }}>Calendar</Kicker>
      <Text style={styles.title}>{monthLabel}</Text>

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
                const selected = n === selectedDay;
                return (
                  <Pressable
                    key={i}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${monthShort} ${n}`}
                    onPress={() => setSelectedDay(n)}
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
                        {
                          color: selected ? colors.bg : n > today ? colors.neutral500 : colors.text,
                        },
                      ]}
                    >
                      {n}
                    </Text>
                    <Text style={[styles.dots, { color: selected ? colors.bg : colors.text }]}>
                      {'•'.repeat(count)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}

          <View style={styles.selectedHead}>
            <Kicker style={{ color: colors.neutral600 }}>
              {new Date(year, month, selectedDay).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </Kicker>
            <Text style={styles.selectedCount}>
              {dayConversations.length}{' '}
              {dayConversations.length === 1 ? 'conversation' : 'conversations'}
            </Text>
          </View>

          <RuleThick style={{ marginTop: 6 }} />
          {dayConversations.map((session) => (
            <Row
              key={session.id}
              onPress={() => router.push({ pathname: '/summary', params: { sessionId: session.id } })}
              onLongPress={() => confirmDeleteSession(session)}
              style={styles.convo}
            >
              <Text style={styles.convoTime}>
                {new Date(session.started_at).toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Text>
              <View style={styles.convoBody}>
                <CardKicker>{capitalize(session.mode)}</CardKicker>
                <Text style={styles.convoTitle}>
                  {session.title ?? session.summary ?? 'Untitled session'}
                </Text>
                {session.processing_status !== 'done' ? (
                  <Text style={styles.convoMeta}>Processing…</Text>
                ) : null}
              </View>
            </Row>
          ))}
          {dayConversations.length === 0 ? (
            <Text style={styles.empty}>이 날은 대화가 없습니다.</Text>
          ) : null}
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
  center: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  weekdays: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: colors.divider,
    paddingBottom: 6,
  },
  weekday: {
    flex: 1,
    fontFamily: font.semibold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 9 * 0.08,
    color: colors.neutral600,
  },
  weekRow: {
    flexDirection: 'row',
  },
  day: {
    flex: 1,
    minHeight: 48,
  },
  dayCell: {
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingTop: 6,
    paddingHorizontal: 4,
    paddingBottom: 5,
  },
  dayRule: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  dayNumber: {
    fontFamily: font.semibold,
    fontSize: 14,
    lineHeight: 18,
  },
  dots: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 12,
    letterSpacing: 2,
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  convoTime: {
    width: 64,
    fontFamily: font.extrabold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.neutral700,
  },
  convoBody: {
    flex: 1,
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
});
