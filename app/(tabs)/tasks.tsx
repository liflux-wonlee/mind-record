import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Button, Kicker, RuleThick } from '@/components/ui';
import { tasks } from '@/data';
import { useApp } from '@/store';
import { colors, font, h2 } from '@/theme';

export default function TasksScreen() {
  const router = useRouter();
  const { tasksDone, toggleTask, openTaskCount } = useApp();

  return (
    <Screen>
      <View style={styles.head}>
        <Kicker style={{ color: colors.neutral600 }}>Tasks</Kicker>
        <Text style={styles.openCount}>{openTaskCount} open</Text>
      </View>
      <Text style={styles.title}>This week</Text>

      <RuleThick />

      {tasks.map((task, i) => {
        const done = tasksDone[i];
        return (
          <View key={task.title} style={styles.task}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: done }}
              accessibilityLabel={task.title}
              onPress={() => toggleTask(i)}
              style={[styles.checkbox, done && { backgroundColor: colors.text }]}
            />
            <View style={styles.taskBody}>
              <Text
                style={[
                  styles.taskTitle,
                  done && { textDecorationLine: 'line-through', color: colors.neutral500 },
                ]}
              >
                {task.title}
              </Text>
              <View style={styles.metaRow}>
                <Text
                  style={[
                    styles.meta,
                    { color: i === 0 && !done ? colors.accent : colors.neutral700 },
                  ]}
                >
                  {task.due}
                </Text>
                <Text style={styles.meta}>{task.topic}</Text>
              </View>
              <View style={styles.quoteBox}>
                <Text style={styles.quote}>
                  “{task.quote}” <Text style={{ color: colors.accent }}>{task.src} →</Text>
                </Text>
              </View>
            </View>
          </View>
        );
      })}

      <View style={styles.scheduleHead}>
        <Kicker style={{ color: colors.neutral600 }}>Schedule</Kicker>
        <Button
          variant="ghost"
          label="Calendar →"
          onPress={() => router.push('/calendar')}
          style={{ minHeight: 44, justifyContent: 'center' }}
          textStyle={{ fontSize: 11, color: colors.accent700 }}
        />
      </View>
      <RuleThick />
      <View style={styles.scheduleRow}>
        <Text style={styles.scheduleTitle}>Meeting with David</Text>
        <Text style={styles.scheduleWhen}>Tue 2:00 PM</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  openCount: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral600,
  },
  title: {
    ...h2,
    marginTop: 6,
    marginBottom: 14,
  },
  task: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  checkbox: {
    width: 24,
    height: 24,
    marginTop: 2,
    borderWidth: 2,
    borderColor: colors.text,
    backgroundColor: 'transparent',
  },
  taskBody: {
    flex: 1,
    minWidth: 0,
  },
  taskTitle: {
    fontFamily: font.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 3,
  },
  meta: {
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 16,
    color: colors.neutral700,
  },
  quoteBox: {
    marginTop: 6,
    borderLeftWidth: 2,
    borderLeftColor: colors.neutral300,
    paddingLeft: 8,
  },
  quote: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral700,
  },
  scheduleHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 6,
  },
  scheduleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  scheduleTitle: {
    fontFamily: font.semibold,
    fontSize: 14,
    color: colors.text,
  },
  scheduleWhen: {
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.neutral700,
  },
});
