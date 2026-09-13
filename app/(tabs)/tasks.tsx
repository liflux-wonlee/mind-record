import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Button, Kicker, RuleThick } from '@/components/ui';
import { useTasks } from '@/hooks/useTasks';
import type { Task } from '@/services/tasks';
import { colors, font, h2 } from '@/theme';

function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return 'No date';
  const due = new Date(dueDate);
  const today = new Date();
  const diffDays = Math.round((due.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86_400_000);
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays > 1 && diffDays <= 7) return 'This week';
  if (diffDays < 0) return 'Overdue';
  return new Date(dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function TasksScreen() {
  const router = useRouter();
  const tasksState = useTasks();
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);

  const submitNewTask = async () => {
    const title = newTitle.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      await tasksState.add(title);
      setNewTitle('');
    } catch {
      // The list just won't include it — the user can see nothing changed and retry.
    } finally {
      setAdding(false);
    }
  };

  return (
    <Screen>
      <View style={styles.head}>
        <Kicker style={{ color: colors.neutral600 }}>Tasks</Kicker>
        <Text style={styles.openCount}>{tasksState.openCount} open</Text>
      </View>
      <Text style={styles.title}>This week</Text>

      <View style={styles.addRow}>
        <TextInput
          style={styles.addInput}
          value={newTitle}
          onChangeText={setNewTitle}
          placeholder="Add a task"
          placeholderTextColor={colors.neutral600}
          onSubmitEditing={submitNewTask}
          returnKeyType="done"
          editable={!adding}
        />
        <Button
          label={adding ? '…' : 'Add'}
          onPress={submitNewTask}
          disabled={adding || !newTitle.trim()}
          style={styles.addButton}
        />
      </View>

      <RuleThick />

      {tasksState.status === 'loading' ? (
        <View style={styles.centerBlock}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : tasksState.status === 'error' ? (
        <View style={styles.centerBlock}>
          <Text style={styles.errorText}>{tasksState.message}</Text>
          <Button variant="secondary" label="Retry" onPress={tasksState.refresh} style={{ minHeight: 40 }} />
        </View>
      ) : tasksState.tasks.length === 0 ? (
        <View style={styles.centerBlock}>
          <Text style={styles.emptyText}>Nothing here yet — add your first task above.</Text>
        </View>
      ) : (
        tasksState.tasks.map((task, i) => (
          <TaskRow key={task.id} task={task} urgent={i === 0} onToggle={() => tasksState.toggle(task)} />
        ))
      )}

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

function TaskRow({ task, urgent, onToggle }: { task: Task; urgent: boolean; onToggle: () => void }) {
  const done = task.status === 'completed';
  return (
    <View style={styles.task}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={task.title}
        onPress={onToggle}
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
            style={[styles.meta, { color: urgent && !done ? colors.accent : colors.neutral700 }]}
          >
            {formatDueDate(task.due_date)}
          </Text>
        </View>
        {task.description ? (
          <View style={styles.quoteBox}>
            <Text style={styles.quote}>{task.description}</Text>
          </View>
        ) : null}
      </View>
    </View>
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
  addRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  addInput: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 10,
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  addButton: {
    minHeight: 44,
    paddingHorizontal: 18,
  },
  centerBlock: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 10,
  },
  errorText: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.accent700,
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.neutral600,
    textAlign: 'center',
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
