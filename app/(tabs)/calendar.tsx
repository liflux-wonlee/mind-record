import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChevronLeftIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, CardKicker, Kicker, Row, RuleThick, Tag } from '@/components/ui';
import { conversationsByDay } from '@/data';
import { useApp } from '@/store';
import { colors, font, h2 } from '@/theme';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
/** September 2026 opens on a Tuesday, so the grid starts with two blanks. */
const LEADING_BLANKS = 2;
const DAYS_IN_MONTH = 30;

export default function CalendarScreen() {
  const router = useRouter();
  const { selectedDay, setSelectedDay } = useApp();

  const dayConversations = conversationsByDay[selectedDay] ?? [];

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
      <Text style={styles.title}>September 2026</Text>

      <View style={styles.weekdays}>
        {WEEKDAYS.map((d) => (
          <Text key={d} style={styles.weekday}>
            {d}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {Array.from({ length: LEADING_BLANKS }, (_, i) => (
          <View key={`blank-${i}`} style={[styles.day, styles.dayRule]} />
        ))}
        {Array.from({ length: DAYS_IN_MONTH }, (_, i) => {
          const n = i + 1;
          const count = (conversationsByDay[n] ?? []).length;
          const selected = n === selectedDay;
          return (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`September ${n}`}
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
                    color: selected ? colors.bg : n > 12 ? colors.neutral500 : colors.text,
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

      <View style={styles.selectedHead}>
        <Kicker style={{ color: colors.neutral600 }}>Sep {selectedDay}, 2026</Kicker>
        <Text style={styles.selectedCount}>
          {dayConversations.length}{' '}
          {dayConversations.length === 1 ? 'conversation' : 'conversations'}
        </Text>
      </View>

      <RuleThick style={{ marginTop: 6 }} />
      {dayConversations.map((c) => (
        <Row key={c.time} onPress={() => router.push(c.to)} style={styles.convo}>
          <Text style={styles.convoTime}>{c.time}</Text>
          <View style={styles.convoBody}>
            <View style={styles.convoHead}>
              <CardKicker>{c.mode}</CardKicker>
              <Tag variant="neutral">{c.topic}</Tag>
            </View>
            <Text style={styles.convoTitle}>{c.title}</Text>
            <Text style={styles.convoMeta}>{c.meta}</Text>
          </View>
        </Row>
      ))}
      {dayConversations.length === 0 ? (
        <Text style={styles.empty}>이 날은 대화가 없습니다.</Text>
      ) : null}
    </Screen>
  );
}

const CELL = `${100 / 7}%` as const;

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
  weekdays: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: colors.divider,
    paddingBottom: 6,
  },
  weekday: {
    width: CELL,
    fontFamily: font.semibold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 9 * 0.08,
    color: colors.neutral600,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  day: {
    width: CELL,
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
  convoHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
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
