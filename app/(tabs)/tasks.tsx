import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Screen } from '@/components/Screen';
import { Button, Kicker, RuleThick } from '@/components/ui';
import { useTasks } from '@/hooks/useTasks';
import type { Task } from '@/services/tasks';
import { colors, font, h2 } from '@/theme';

type Filter = 'open' | 'completed';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses a YYYY-MM-DD as a LOCAL calendar date. `new Date('2026-09-19')`
 *  is UTC midnight, which in any zone west of UTC is still the 18th --
 *  that made "today" read as Overdue and "tomorrow" as Due today. */
function parseLocalDate(ymd: string): Date | null {
  if (!DATE_RE.test(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return 'No date';
  const due = parseLocalDate(dueDate);
  if (!due) return dueDate;
  const today = new Date();
  const diffDays = Math.round((due.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86_400_000);
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays > 1 && diffDays <= 7) return 'This week';
  if (diffDays < 0) return 'Overdue';
  return due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** YYYY-MM-DD for the given day, in local time (not UTC -- toISOString would shift near midnight). */
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function TasksScreen() {
  const router = useRouter();
  const tasksState = useTasks();
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');
  const [editing, setEditing] = useState<Task | null>(null);

  // Search deep-links to a task with ?edit=<id>: open its sheet once the
  // list has loaded, and switch the filter so it's visible behind it.
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const [consumedEdit, setConsumedEdit] = useState<string | null>(null);
  useEffect(() => {
    if (!edit || edit === consumedEdit || tasksState.status !== 'ready') return;
    const target = tasksState.tasks.find((t) => t.id === edit);
    if (!target) return;
    setConsumedEdit(edit);
    setFilter(target.status === 'completed' ? 'completed' : 'open');
    setEditing(target);
  }, [edit, consumedEdit, tasksState]);

  const submitNewTask = async () => {
    const title = newTitle.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      await tasksState.add(title);
      setNewTitle('');
    } catch (e) {
      Alert.alert('Could not add task', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setAdding(false);
    }
  };

  const tasks = tasksState.status === 'ready' ? tasksState.tasks : [];
  const visibleTasks = tasks.filter((t) => (filter === 'open' ? t.status !== 'completed' : t.status === 'completed'));

  return (
    <Screen>
      <View style={[styles.head, { paddingRight: 44 }]}>
        <Kicker style={{ color: colors.neutral600 }}>Tasks</Kicker>
        <Text style={styles.openCount}>{tasksState.openCount} open</Text>
      </View>
      <Text style={styles.title}>Tasks</Text>

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

      <View style={styles.filterSeg}>
        <FilterOption label="Open" selected={filter === 'open'} onPress={() => setFilter('open')} />
        <FilterOption label="Completed" selected={filter === 'completed'} onPress={() => setFilter('completed')} divided />
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
      ) : visibleTasks.length === 0 ? (
        <View style={styles.centerBlock}>
          <Text style={styles.emptyText}>
            {filter === 'open' ? 'Nothing here yet — add your first task above.' : 'No completed tasks yet.'}
          </Text>
        </View>
      ) : (
        visibleTasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            onToggle={() =>
              tasksState
                .toggle(task)
                .catch((e) => Alert.alert('Could not update', e instanceof Error ? e.message : 'Please try again.'))
            }
            onPress={() => setEditing(task)}
          />
        ))
      )}

      <TaskEditSheet
        task={editing}
        onClose={() => setEditing(null)}
        onOpenSource={(sessionId) => {
          setEditing(null);
          router.push({ pathname: '/summary', params: { sessionId } });
        }}
        onSave={async (input) => {
          if (!editing) return;
          await tasksState.update(editing, input);
          setEditing(null);
        }}
        onDelete={async () => {
          if (!editing) return;
          await tasksState.remove(editing);
          setEditing(null);
        }}
      />
    </Screen>
  );
}

function FilterOption({
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
      style={[styles.filterOpt, divided && styles.filterDivider, selected && { backgroundColor: colors.accent }]}
    >
      <Text style={[styles.filterText, selected && { color: colors.bg }]}>{label}</Text>
    </Pressable>
  );
}

function TaskRow({ task, onToggle, onPress }: { task: Task; onToggle: () => void; onPress: () => void }) {
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
      <Pressable style={styles.taskBody} onPress={onPress}>
        <Text style={[styles.taskTitle, done && { textDecorationLine: 'line-through', color: colors.neutral500 }]}>
          {task.title}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.meta, { color: !done && task.due_date ? colors.accent : colors.neutral700 }]}>
            {task.due_date
              ? formatDueDate(task.due_date)
              : `Added ${new Date(task.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
          </Text>
        </View>
        {task.description ? (
          <View style={styles.quoteBox}>
            <Text style={styles.quote}>{task.description}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

function TaskEditSheet({
  task,
  onClose,
  onSave,
  onDelete,
  onOpenSource,
}: {
  task: Task | null;
  onClose: () => void;
  onSave: (input: { title: string; dueDate?: string | null }) => Promise<void>;
  onDelete: () => Promise<void>;
  onOpenSource: (sessionId: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDueDate(task.due_date);
    }
  }, [task]);

  const save = async () => {
    if (!title.trim() || saving) return;
    if (dueDate && !parseLocalDate(dueDate)) {
      Alert.alert('Check the date', 'Use the format YYYY-MM-DD, e.g. 2026-09-19.');
      return;
    }
    setSaving(true);
    try {
      await onSave({ title: title.trim(), dueDate });
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert('Delete this task?', 'The recording it came from is kept — only this task goes.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          onDelete().catch((e) => Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.')),
      },
    ]);
  };

  const today = isoDate(new Date());
  const tomorrow = isoDate(new Date(Date.now() + 86_400_000));
  const nextWeek = isoDate(new Date(Date.now() + 7 * 86_400_000));

  return (
    <BottomSheet visible={task !== null} onClose={onClose} title="Edit task" maxHeight="85%">
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Task title"
            placeholderTextColor={colors.neutral600}
          />

          <Text style={styles.fieldLabel}>Due date</Text>
          <View style={styles.dateRow}>
            <DateChip label="No date" selected={dueDate === null} onPress={() => setDueDate(null)} />
            <DateChip label="Today" selected={dueDate === today} onPress={() => setDueDate(today)} />
            <DateChip label="Tomorrow" selected={dueDate === tomorrow} onPress={() => setDueDate(tomorrow)} />
            <DateChip label="+1 week" selected={dueDate === nextWeek} onPress={() => setDueDate(nextWeek)} />
          </View>
          <TextInput
            style={styles.input}
            value={dueDate ?? ''}
            onChangeText={(v) => setDueDate(v.trim() || null)}
            placeholder="Or type YYYY-MM-DD"
            placeholderTextColor={colors.neutral600}
          />

          {task?.source_session_id ? (
            <Button
              variant="secondary"
              label="Open source recording"
              align="flex-start"
              onPress={() => task.source_session_id && onOpenSource(task.source_session_id)}
              style={{ marginTop: 14 }}
            />
          ) : null}

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            <Button label="Cancel" variant="ghost" onPress={onClose} />
            <Button label={saving ? 'Saving…' : 'Save'} disabled={saving || !title.trim()} onPress={save} />
          </View>
          <Button
            label="Delete task"
            variant="ghost"
            align="flex-start"
            textStyle={{ color: colors.accent700 }}
            onPress={confirmDelete}
            style={{ marginTop: 10 }}
          />
    </BottomSheet>
  );
}

function DateChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.dateChip, selected && { backgroundColor: colors.accent, borderColor: colors.accent }]}
    >
      <Text style={[styles.dateChipText, selected && { color: colors.bg }]}>{label}</Text>
    </Pressable>
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
  filterSeg: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: 'hidden',
    marginBottom: 8,
  },
  filterOpt: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  filterDivider: {
    borderLeftWidth: 1,
    borderLeftColor: colors.divider,
  },
  filterText: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.text,
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
  input: {
    minHeight: 48,
    paddingHorizontal: 12,
    fontFamily: font.regular,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: 10,
  },
  fieldLabel: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 11 * 0.08,
    textTransform: 'uppercase',
    color: colors.neutral600,
    marginBottom: 6,
  },
  dateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  dateChip: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  dateChipText: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.text,
  },
});
