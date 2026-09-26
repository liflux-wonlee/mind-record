import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { ShareIcon, StarIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { ShareSheet, type ShareContent } from '@/components/ShareSheet';
import { Button, RuleThick, Tag } from '@/components/ui';
import { useTasks } from '@/hooks/useTasks';
import {
  getGoogleTasksSendRecord,
  getGoogleTasksStatus,
  listGoogleTaskLists,
  sendToGoogleTasks,
  type GoogleTaskList,
  type GoogleTasksSendRecord,
} from '@/services/googleTasks';
import { friendlyMessage } from '@/lib/friendlyError';
import { useAuth } from '@/providers/AuthProvider';
import { confirmListSuggestion, type TaskList } from '@/services/taskLists';
import type { Task } from '@/services/tasks';
import { colors, font, h2, radius } from '@/theme';

type Filter = 'open' | 'completed';
// Same picker-target shape whether the sheet was opened from the "Needs a
// list" section or from a task's own edit sheet -- both just want to end
// up calling the same assign function.
type ListPickTarget = { taskId: string; onDone?: () => void };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PICKER_COLORS = [
  colors.pastelGreen,
  colors.pastelBlue,
  colors.pastelPeach,
  colors.pastelLavender,
  colors.pastelYellow,
  colors.pastelPink,
];

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
  const { user } = useAuth();
  const tasksState = useTasks();
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');
  // 'all' shows every list (plus the "needs a list" review section);
  // otherwise the id of the one list currently selected.
  const [selectedListId, setSelectedListId] = useState<string>('all');
  const [editing, setEditing] = useState<Task | null>(null);
  const [shareContent, setShareContent] = useState<ShareContent | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  // Long-press (or tap) a list chip other than "All"/"+ New list" to rename/delete it.
  const [managingList, setManagingList] = useState<TaskList | null>(null);
  const [manageListName, setManageListName] = useState('');
  const [savingList, setSavingList] = useState(false);
  // Which Google Tasks list the managed list's tasks are sent to (see
  // supabase/migrations/20260926000001_task_list_google_mapping.sql).
  // null while checking whether Google Tasks is connected at all.
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  const [googleLists, setGoogleLists] = useState<GoogleTaskList[] | null>(null);
  const [googlePickerOpen, setGooglePickerOpen] = useState(false);
  const [savingGoogleList, setSavingGoogleList] = useState(false);
  // Which list the Edit list sheet is showing right now -- a Google-list save
  // that finishes after the sheet closed or moved on must not touch it.
  const managingListIdRef = React.useRef<string | null>(null);
  managingListIdRef.current = managingList?.id ?? null;

  // "+ New list" chip.
  const [creatingList, setCreatingList] = useState(false);
  const [newListName, setNewListName] = useState('');

  // The "Pick a list" sheet, shared by the "Needs a list" section and each
  // task's own "Change" button (see TaskEditSheet).
  const [picking, setPicking] = useState<ListPickTarget | null>(null);
  const [pickNewListName, setPickNewListName] = useState('');
  const [creatingPickList, setCreatingPickList] = useState(false);
  useEffect(() => {
    if (picking === null) setPickNewListName('');
  }, [picking]);

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
    setSelectedListId('all');
    setEditing(target);
  }, [edit, consumedEdit, tasksState]);

  const lists = tasksState.status === 'ready' ? tasksState.lists : [];
  const tasks = tasksState.status === 'ready' ? tasksState.tasks : [];
  const listById = (id: string | null) => (id ? lists.find((l) => l.id === id) : undefined);

  const statusFiltered = tasks.filter((t) => (filter === 'open' ? t.status !== 'completed' : t.status === 'completed'));
  // Extracted from a recording but not confident enough about which list --
  // kept separate from the ordinary list below instead of dumped in
  // wherever they'd otherwise sort, so they don't get lost among filed tasks.
  const needsListReview = selectedListId === 'all' ? statusFiltered.filter((t) => !t.list_id && t.list_suggestion) : [];
  const needsReviewIds = new Set(needsListReview.map((t) => t.id));
  const visibleTasks = statusFiltered.filter((t) => {
    if (needsReviewIds.has(t.id)) return false;
    if (selectedListId === 'all') return true;
    return t.list_id === selectedListId;
  });

  const submitNewTask = async () => {
    const title = newTitle.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      await tasksState.add(title, undefined, selectedListId !== 'all' ? selectedListId : undefined);
      setNewTitle('');
    } catch (e) {
      Alert.alert('Could not add task', friendlyMessage(e, 'Please try again.'));
    } finally {
      setAdding(false);
    }
  };

  const openManageList = (list: TaskList) => {
    setManagingList(list);
    setManageListName(list.name);
    setGooglePickerOpen(false);
    setGoogleLists(null);
    setGoogleConnected(null);
    getGoogleTasksStatus()
      .then((status) => setGoogleConnected(status.connected))
      .catch(() => setGoogleConnected(false));
  };

  const openGooglePicker = async () => {
    setGooglePickerOpen(true);
    if (googleLists) return;
    try {
      setGoogleLists(await listGoogleTaskLists());
    } catch (e) {
      setGooglePickerOpen(false);
      Alert.alert('Could not load your Google lists', friendlyMessage(e, 'Please try again.'));
    }
  };

  const chooseGoogleList = async (choice: GoogleTaskList | null) => {
    if (!managingList || savingGoogleList) return;
    const listId = managingList.id;
    setSavingGoogleList(true);
    try {
      const updated = await tasksState.setListGoogleList(managingList, choice);
      if (managingListIdRef.current === listId) {
        setManagingList((cur) => (cur && cur.id === listId ? updated : cur));
        setGooglePickerOpen(false);
      }
    } catch (e) {
      Alert.alert('Could not save', friendlyMessage(e, 'Please try again.'));
    } finally {
      setSavingGoogleList(false);
    }
  };

  const saveListRename = async () => {
    if (!managingList || !manageListName.trim() || savingList) return;
    setSavingList(true);
    try {
      await tasksState.renameList(managingList, manageListName.trim());
      setManagingList(null);
    } catch (e) {
      Alert.alert('Could not rename', friendlyMessage(e, 'Please try again.'));
    } finally {
      setSavingList(false);
    }
  };

  const confirmDeleteList = () => {
    if (!managingList) return;
    const list = managingList;
    Alert.alert(`Delete "${list.name}"?`, 'Tasks in it are kept, just unfiled from any list.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await tasksState.removeList(list);
            if (selectedListId === list.id) setSelectedListId('all');
            setManagingList(null);
          } catch (e) {
            Alert.alert('Could not delete', friendlyMessage(e, 'Please try again.'));
          }
        },
      },
    ]);
  };

  const createList = async () => {
    if (!newListName.trim()) return;
    try {
      const list = await tasksState.addList(newListName.trim());
      setNewListName('');
      setCreatingList(false);
      if (list) setSelectedListId(list.id);
    } catch (e) {
      Alert.alert('Could not create list', friendlyMessage(e, 'Please try again.'));
    }
  };

  const moveTaskToList = async (taskId: string, listId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    setBusyTaskId(taskId);
    try {
      await tasksState.moveToList(task, listId);
      setPicking(null);
    } catch (e) {
      Alert.alert('Could not move task', friendlyMessage(e, 'Please try again.'));
    } finally {
      setBusyTaskId(null);
    }
  };

  const useTaskListSuggestion = async (task: Task) => {
    if (!user || !task.list_suggestion) return;
    setBusyTaskId(task.id);
    try {
      const list = await confirmListSuggestion(user.id, lists, task.list_suggestion);
      await moveTaskToList(task.id, list.id);
    } catch (e) {
      Alert.alert('Could not file this task', friendlyMessage(e, 'Please try again.'));
      setBusyTaskId(null);
    }
  };

  const createAndPickList = async () => {
    if (!user || !pickNewListName.trim() || !picking) return;
    setCreatingPickList(true);
    try {
      const list = await tasksState.addList(pickNewListName.trim());
      if (list) await moveTaskToList(picking.taskId, list.id);
    } catch (e) {
      Alert.alert('Could not create list', friendlyMessage(e, 'Please try again.'));
    } finally {
      setCreatingPickList(false);
    }
  };

  const toggleStar = (task: Task) =>
    tasksState.toggleStar(task).catch((e) => Alert.alert('Could not update', friendlyMessage(e, 'Please try again.')));

  return (
    <Screen>
      <View style={[styles.head, { paddingRight: 44 }]}>
        {/* Spacer, not removed outright -- keeps the row's height (and so
            the big title below it) exactly where the small "Tasks" kicker
            this used to show left it, while letting "open" sit flush right. */}
        <View style={{ height: 15 }} />
        <Text style={styles.openCount}>{tasksState.openCount} open</Text>
      </View>
      <Text style={styles.title}>Tasks</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.listChipRow} contentContainerStyle={{ gap: 8 }}>
        <ListChip label="All" selected={selectedListId === 'all'} onPress={() => setSelectedListId('all')} />
        {lists.map((l) => (
          <ListChip
            key={l.id}
            label={l.name}
            selected={selectedListId === l.id}
            onPress={() => setSelectedListId(l.id)}
            onLongPress={() => openManageList(l)}
          />
        ))}
        <ListChip label="+ New list" selected={false} onPress={() => setCreatingList(true)} muted />
      </ScrollView>

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
          <Button variant="secondary" label="Retry" onPress={tasksState.refresh} style={{ minHeight: 44 }} />
        </View>
      ) : (
        <>
          {needsListReview.length > 0 ? (
            <View style={{ marginBottom: 10 }}>
              <Text style={styles.sectionHeading}>Needs a list</Text>
              {needsListReview.map((task) => (
                <View key={task.id} style={styles.reviewCard}>
                  <Text style={styles.taskTitle}>{task.title}</Text>
                  <Text style={styles.suggestText}>
                    AI thinks this belongs in &quot;{task.list_suggestion}&quot;
                  </Text>
                  <View style={styles.suggestActions}>
                    <Button
                      label={busyTaskId === task.id ? 'Saving…' : `Use "${task.list_suggestion}"`}
                      disabled={busyTaskId === task.id}
                      onPress={() => useTaskListSuggestion(task)}
                      style={[styles.suggestButton, { backgroundColor: colors.pastelGreen }]}
                      textStyle={styles.pastelSmallText}
                    />
                    <Button
                      label="Pick list"
                      disabled={busyTaskId === task.id}
                      onPress={() => setPicking({ taskId: task.id })}
                      style={[styles.suggestButton, { backgroundColor: colors.pastelLavender }]}
                      textStyle={styles.pastelSmallText}
                    />
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {visibleTasks.length === 0 && needsListReview.length === 0 ? (
            <View style={styles.centerBlock}>
              <Text style={styles.emptyText}>
                {filter === 'open' ? 'Nothing here yet — add your first task above.' : 'No completed tasks yet.'}
              </Text>
            </View>
          ) : (
            visibleTasks.map((task, i) => (
              <TaskRow
                key={task.id}
                task={task}
                list={selectedListId === 'all' ? listById(task.list_id) : undefined}
                color={i % 2 === 0 ? colors.pastelYellow : colors.pastelGreen}
                onToggle={() =>
                  tasksState
                    .toggle(task)
                    .catch((e) => Alert.alert('Could not update', friendlyMessage(e, 'Please try again.')))
                }
                onOpen={() => setEditing(task)}
                onToggleStar={() => toggleStar(task)}
              />
            ))
          )}
          {visibleTasks.length > 0 ? <Text style={styles.hint}>Hold a task to view or edit its details</Text> : null}
        </>
      )}

      <TaskEditSheet
        task={editing}
        list={editing ? listById(editing.list_id) : undefined}
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
        onChangeList={() => editing && setPicking({ taskId: editing.id, onDone: () => setEditing(null) })}
        onShare={() =>
          editing &&
          setShareContent({
            kicker: 'Task',
            title: editing.title,
            body: [editing.title, editing.due_date ? formatDueDate(editing.due_date) : null, editing.description]
              .filter(Boolean)
              .join('\n\n'),
          })
        }
      />

      <BottomSheet visible={managingList !== null} onClose={() => setManagingList(null)} title="Edit list">
        <TextInput
          style={styles.input}
          value={manageListName}
          onChangeText={setManageListName}
          placeholder="List name"
          placeholderTextColor={colors.neutral600}
        />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          <Button label="Cancel" variant="ghost" onPress={() => setManagingList(null)} style={{ flex: 1 }} />
          <Button
            label={savingList ? 'Saving…' : 'Save'}
            disabled={savingList || !manageListName.trim()}
            onPress={saveListRename}
            variant="save"
            style={{ flex: 1 }}
          />
        </View>

        <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Google Tasks</Text>
        {googleConnected === null ? (
          <ActivityIndicator color={colors.accent} style={{ alignSelf: 'flex-start' }} />
        ) : !googleConnected ? (
          <Text style={styles.sendHint}>Connect Google Tasks in Account to send this list&apos;s tasks there.</Text>
        ) : managingList ? (
          <>
            <View style={styles.listFieldRow}>
              <Text style={styles.listFieldText}>
                {managingList.google_task_list_title ?? `Same name ("${managingList.name}")`}
              </Text>
              <Button
                variant="ghost"
                label={googlePickerOpen ? 'Close' : 'Change'}
                onPress={googlePickerOpen ? () => setGooglePickerOpen(false) : openGooglePicker}
                style={{ minHeight: 44, paddingHorizontal: 6 }}
                textStyle={{ fontSize: 12 }}
              />
            </View>
            {googlePickerOpen ? (
              googleLists === null ? (
                <ActivityIndicator color={colors.accent} style={{ alignSelf: 'flex-start', marginTop: 6 }} />
              ) : (
                <View style={{ marginTop: 6 }}>
                  <GoogleListOption
                    label={`Automatic -- same name ("${managingList.name}")`}
                    selected={!managingList.google_task_list_id}
                    disabled={savingGoogleList}
                    onPress={() => chooseGoogleList(null)}
                  />
                  {googleLists.map((g) => (
                    <GoogleListOption
                      key={g.id}
                      label={g.title || '(untitled)'}
                      selected={managingList.google_task_list_id === g.id}
                      disabled={savingGoogleList}
                      onPress={() => chooseGoogleList(g)}
                    />
                  ))}
                </View>
              )
            ) : null}
            <Text style={styles.sendHint}>
              Sending a task from this list puts it in this Google list. Automatic uses the Google list with the same
              name, and creates it there if it doesn&apos;t exist yet.
            </Text>
          </>
        ) : null}

        <Button label="Delete list" variant="danger" align="flex-start" onPress={confirmDeleteList} style={{ marginTop: 10 }} />
      </BottomSheet>

      <BottomSheet visible={creatingList} onClose={() => setCreatingList(false)} title="New list">
        <TextInput
          style={styles.input}
          value={newListName}
          onChangeText={setNewListName}
          placeholder="List name"
          placeholderTextColor={colors.neutral600}
          autoFocus
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button label="Cancel" variant="ghost" onPress={() => setCreatingList(false)} style={{ flex: 1 }} />
          <Button
            label="Create"
            disabled={!newListName.trim()}
            onPress={createList}
            style={{ flex: 1, backgroundColor: colors.pastelGreen, borderRadius: radius.pastel }}
            textStyle={{ color: colors.text }}
          />
        </View>
      </BottomSheet>

      <BottomSheet
        visible={picking !== null}
        onClose={() => {
          picking?.onDone?.();
          setPicking(null);
        }}
        title="Pick a list"
      >
        {lists.length === 0 ? (
          <Text style={styles.footnote}>No lists yet -- create one below.</Text>
        ) : (
          lists.map((l, i) => (
            <Button
              key={l.id}
              label={l.name}
              align="flex-start"
              disabled={busyTaskId !== null}
              onPress={() => picking && moveTaskToList(picking.taskId, l.id)}
              style={{
                marginBottom: 8,
                borderRadius: radius.pastel,
                backgroundColor: PICKER_COLORS[i % PICKER_COLORS.length],
              }}
              textStyle={{ color: colors.text }}
            />
          ))
        )}
        <View style={styles.newListRow}>
          <TextInput
            style={styles.newListInput}
            value={pickNewListName}
            onChangeText={setPickNewListName}
            placeholder="New list name"
            placeholderTextColor={colors.neutral600}
          />
          <Button
            label={creatingPickList ? '…' : 'Create'}
            disabled={creatingPickList || !pickNewListName.trim()}
            onPress={createAndPickList}
            style={{
              minHeight: 44,
              paddingHorizontal: 14,
              borderRadius: radius.pastel,
              backgroundColor: colors.pastelGreen,
            }}
            textStyle={{ color: colors.text }}
          />
        </View>
        <Button
          label="Cancel"
          variant="ghost"
          align="flex-start"
          onPress={() => {
            picking?.onDone?.();
            setPicking(null);
          }}
        />
      </BottomSheet>

      <ShareSheet content={shareContent} onClose={() => setShareContent(null)} />
    </Screen>
  );
}

function GoogleListOption({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.googleOption, selected && styles.googleOptionSelected]}
    >
      <Text style={styles.googleOptionText}>{label}</Text>
      {selected ? <Text style={styles.googleOptionCheck}>✓</Text> : null}
    </Pressable>
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

function ListChip({
  label,
  selected,
  onPress,
  onLongPress,
  muted,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  muted?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.listChip,
        selected ? { backgroundColor: colors.accent } : { backgroundColor: colors.surface },
        muted && !selected && { borderWidth: 1, borderColor: colors.divider },
      ]}
    >
      <Text style={[styles.listChipText, selected && { color: colors.bg }]}>{label}</Text>
    </Pressable>
  );
}

function TaskRow({
  task,
  list,
  color,
  onToggle,
  onOpen,
  onToggleStar,
}: {
  task: Task;
  list: TaskList | undefined;
  color: string;
  onToggle: () => void;
  onOpen: () => void;
  onToggleStar: () => void;
}) {
  const done = task.status === 'completed';
  return (
    <View style={[styles.task, { backgroundColor: done ? colors.neutral200 : color }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={task.title}
        onPress={onToggle}
        style={[styles.checkbox, done && { backgroundColor: colors.text }]}
      />
      <Pressable style={styles.taskBody} onPress={onOpen} onLongPress={onOpen}>
        <Text style={[styles.taskTitle, done && { textDecorationLine: 'line-through', color: colors.neutral500 }]}>
          {task.title}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.meta, { color: !done && task.due_date ? colors.accent : colors.neutral700 }]}>
            {task.due_date
              ? formatDueDate(task.due_date)
              : `Added ${new Date(task.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
          </Text>
          {list ? <Tag variant="neutral">{list.name}</Tag> : null}
        </View>
        {task.description ? (
          <View style={styles.quoteBox}>
            <Text style={styles.quote}>{task.description}</Text>
          </View>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={task.starred ? 'Unstar task' : 'Star task'}
        onPress={onToggleStar}
        hitSlop={8}
        style={styles.starButton}
      >
        <StarIcon size={20} filled={task.starred} color={task.starred ? colors.accent700 : colors.neutral500} />
      </Pressable>
    </View>
  );
}

function TaskEditSheet({
  task,
  list,
  onClose,
  onSave,
  onDelete,
  onOpenSource,
  onChangeList,
  onShare,
}: {
  task: Task | null;
  list: TaskList | undefined;
  onClose: () => void;
  onSave: (input: { title: string; description?: string | null; dueDate?: string | null }) => Promise<void>;
  onDelete: () => Promise<void>;
  onOpenSource: (sessionId: string) => void;
  onChangeList: () => void;
  onShare: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sendRecord, setSendRecord] = useState<GoogleTasksSendRecord | null>(null);
  const [sending, setSending] = useState(false);

  React.useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? '');
      setDueDate(task.due_date);
      setSendRecord(null);
      getGoogleTasksSendRecord('task', task.id)
        .then(setSendRecord)
        .catch(() => {
          // Not worth surfacing an error for -- the Send button just
          // stays available and a duplicate send is harmlessly deduped
          // server-side anyway.
        });
    }
  }, [task]);

  const send = async () => {
    if (!task || sending) return;
    setSending(true);
    try {
      const result = await sendToGoogleTasks('task', task.id);
      setSendRecord({ googleTaskId: result.googleTaskId, listTitle: result.listTitle, sentAt: new Date().toISOString() });
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'NotConnectedError') {
        Alert.alert('Not connected', 'Connect Google Tasks first in Account -> Google Tasks.');
      } else if (name === 'NeedsListError') {
        Alert.alert(
          'Choose a list first',
          "This task isn't in any list. Put it in a list, or pick a default list in Account -> Google Tasks."
        );
      } else if (name === 'MappedListMissingError') {
        Alert.alert('Google list not found', friendlyMessage(e, 'Pick another Google list for this list.'));
      } else {
        Alert.alert('Could not send', friendlyMessage(e, 'Please try again.'));
      }
    } finally {
      setSending(false);
    }
  };

  const save = async () => {
    if (!title.trim() || saving) return;
    if (dueDate && !parseLocalDate(dueDate)) {
      Alert.alert('Check the date', 'Use the format YYYY-MM-DD, e.g. 2026-09-19.');
      return;
    }
    setSaving(true);
    try {
      await onSave({ title: title.trim(), description: description.trim() || null, dueDate });
    } catch (e) {
      Alert.alert('Could not save', friendlyMessage(e, 'Please try again.'));
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
          onDelete().catch((e) => Alert.alert('Could not delete', friendlyMessage(e, 'Please try again.'))),
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

          <Text style={styles.fieldLabel}>Details</Text>
          <TextInput
            style={[styles.input, styles.descriptionInput]}
            value={description}
            onChangeText={setDescription}
            placeholder="Add notes for this task"
            placeholderTextColor={colors.neutral600}
            multiline
            textAlignVertical="top"
          />

          <Text style={styles.fieldLabel}>List</Text>
          <View style={styles.listFieldRow}>
            <Text style={styles.listFieldText}>{list ? list.name : 'No list'}</Text>
            <Button
              variant="ghost"
              label="Change"
              onPress={onChangeList}
              style={{ minHeight: 44, paddingHorizontal: 6 }}
              textStyle={{ fontSize: 12 }}
            />
          </View>

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
            keyboardType="numbers-and-punctuation"
          />

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            {task?.source_session_id ? (
              <Button
                label="Open source recording"
                align="flex-start"
                onPress={() => task.source_session_id && onOpenSource(task.source_session_id)}
                style={{ flex: 1, backgroundColor: colors.pastelLavender, borderRadius: radius.pastel }}
                textStyle={{ color: colors.text }}
              />
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share this task"
              onPress={onShare}
              style={styles.shareIconButton}
            >
              <ShareIcon size={18} color={colors.neutral700} />
            </Pressable>
          </View>

          <Button
            label={sending ? 'Sending…' : sendRecord ? 'Sent to Google Tasks ✓' : 'Send to Google Tasks'}
            align="flex-start"
            disabled={sending || !!sendRecord}
            onPress={send}
            style={{ marginTop: 10, backgroundColor: colors.pastelGreen, borderRadius: radius.pastel }}
            textStyle={{ color: colors.text }}
          />
          {sendRecord ? (
            <Text style={styles.sendHint}>
              {sendRecord.listTitle ? `In ${sendRecord.listTitle}. ` : ''}Editing or completing this task here
              won&apos;t update it in Google Tasks.
            </Text>
          ) : null}

          {/* One row: Delete on the left, Cancel + Save on the right -- short
              enough to stay above the navigation bar on small screens. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }}>
            <Button label="Delete" variant="danger" onPress={confirmDelete} style={{ paddingHorizontal: 16 }} />
            <View style={{ flex: 1 }} />
            <Button label="Cancel" variant="ghost" onPress={onClose} />
            <Button
              label={saving ? 'Saving…' : 'Save'}
              variant="save"
              disabled={saving || !title.trim()}
              onPress={save}
              style={{ paddingHorizontal: 20 }}
            />
          </View>
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
    marginBottom: 12,
  },
  listChipRow: {
    marginBottom: 12,
  },
  listChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.pastel,
  },
  listChipText: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: colors.text,
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
    borderRadius: radius.pastel,
  },
  addButton: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: radius.pastel,
  },
  filterSeg: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.pastel,
    overflow: 'hidden',
    marginBottom: 8,
  },
  filterOpt: {
    minHeight: 44,
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
  sectionHeading: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 11 * 0.08,
    textTransform: 'uppercase',
    color: colors.neutral600,
    marginBottom: 8,
  },
  reviewCard: {
    backgroundColor: colors.pastelPeach,
    borderRadius: radius.pastel,
    padding: 12,
    marginBottom: 8,
  },
  task: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    marginBottom: 8,
    borderRadius: radius.pastel,
  },
  checkbox: {
    width: 24,
    height: 24,
    marginTop: 2,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.text,
    backgroundColor: 'transparent',
  },
  taskBody: {
    flex: 1,
    minWidth: 0,
  },
  starButton: {
    paddingTop: 2,
    paddingLeft: 4,
  },
  taskTitle: {
    fontFamily: font.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
    borderRadius: radius.pastel,
    marginBottom: 10,
  },
  descriptionInput: {
    minHeight: 80,
    paddingTop: 12,
  },
  listFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.pastel,
    paddingHorizontal: 12,
    minHeight: 44,
    marginBottom: 10,
  },
  listFieldText: {
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.text,
  },
  shareIconButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pastel,
  },
  googleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.pastel,
    backgroundColor: colors.surface,
    marginBottom: 6,
  },
  googleOptionSelected: {
    backgroundColor: colors.pastelGreen,
  },
  googleOptionText: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.text,
  },
  googleOptionCheck: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: colors.text,
    marginLeft: 8,
  },
  sendHint: {
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 16,
    color: colors.neutral600,
    marginTop: 6,
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
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.pastel,
  },
  dateChipText: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.text,
  },
  suggestText: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral800,
    marginTop: 4,
  },
  suggestActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  suggestButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: radius.pastel,
  },
  pastelSmallText: {
    color: colors.text,
    fontSize: 12,
  },
  footnote: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.neutral600,
    paddingVertical: 12,
  },
  newListRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    marginBottom: 12,
  },
  newListInput: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 12,
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.bg,
    borderRadius: radius.pastel,
  },
  hint: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral600,
    marginTop: 2,
    textAlign: 'center',
  },
});
