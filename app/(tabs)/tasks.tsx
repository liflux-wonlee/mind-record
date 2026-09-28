import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { CheckIcon, ShareIcon, StarIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { ShareSheet, type ShareContent } from '@/components/ShareSheet';
import { Button, Tag } from '@/components/ui';
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
import { colors, font, GUTTER, h2, radius } from '@/theme';

/** Page keys for the two tabs that aren't lists; every other page's key is its list id. */
const STARRED_KEY = '__starred';
const ALL_KEY = '__all';

/** A page's pastel card color and the deeper shade of it used for the
 *  selected tab, the check circles and the + button. */
type Tone = { bg: string; deep: string };
const STARRED_TONE: Tone = { bg: colors.pastelYellow, deep: '#b98f1f' };
const ALL_TONE: Tone = { bg: colors.pastelBlue, deep: '#4f83a8' };
// Each list gets the next of these by position, so neighbouring tabs differ.
const LIST_TONES: readonly Tone[] = [
  { bg: colors.pastelPink, deep: '#c9584d' },
  { bg: colors.pastelGreen, deep: '#4f9468' },
  { bg: colors.pastelLavender, deep: '#7c62a8' },
  { bg: colors.pastelPeach, deep: '#d1793f' },
  { bg: colors.pastelBlue, deep: '#4f83a8' },
  { bg: colors.pastelYellow, deep: '#b98f1f' },
];

type TaskPage = { key: string; title: string; tone: Tone; list: TaskList | undefined };
// Same picker-target shape whether the sheet was opened from the "Needs a
// list" section or from a task's own edit sheet -- both just want to end
// up calling the same assign function.
type ListPickTarget = { taskId: string; onDone?: () => void };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A task title in the Edit/New task sheets wraps onto more lines instead of
 * scrolling sideways. On Android a text field that can scroll (a long
 * single-line title can, horizontally) keeps the touch for itself, so a
 * drag that started on it never scrolled the sheet -- which is why the
 * sheet only scrolled "sometimes". Return still means done, not a new line.
 */
const SHEET_TITLE_INPUT_PROPS = {
  multiline: true,
  scrollEnabled: false,
  submitBehavior: 'blurAndSubmit',
  returnKeyType: 'done',
} as const;

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
  // Which page the pager shows: STARRED_KEY, ALL_KEY (every task, plus
  // the "needs a list" review section), or a list's id.
  const [selectedKey, setSelectedKey] = useState<string>(ALL_KEY);
  // Pages whose "Completed (n)" section is expanded (collapsed by default,
  // like Google Tasks).
  const [expandedCompleted, setExpandedCompleted] = useState<ReadonlySet<string>>(new Set());
  const { width: pageWidth } = useWindowDimensions();
  const pagerRef = React.useRef<FlatList<TaskPage>>(null);
  const tabBarRef = React.useRef<ScrollView>(null);
  // Each tab's x in the tab bar, to keep the selected one scrolled into view.
  const tabOffsets = React.useRef<Record<string, number>>({});
  const [editing, setEditing] = useState<Task | null>(null);
  const [newTaskSeed, setNewTaskSeed] = useState<NewTaskSeed | null>(null);
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
  // list has loaded, on the All page with its section open behind it.
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const [consumedEdit, setConsumedEdit] = useState<string | null>(null);
  useEffect(() => {
    if (!edit || edit === consumedEdit || tasksState.status !== 'ready') return;
    const target = tasksState.tasks.find((t) => t.id === edit);
    if (!target) return;
    setConsumedEdit(edit);
    setSelectedKey(ALL_KEY);
    if (target.status === 'completed') setExpandedCompleted((prev) => new Set(prev).add(ALL_KEY));
    setEditing(target);
  }, [edit, consumedEdit, tasksState]);

  const lists = tasksState.status === 'ready' ? tasksState.lists : [];
  const tasks = tasksState.status === 'ready' ? tasksState.tasks : [];
  const listById = (id: string | null) => (id ? lists.find((l) => l.id === id) : undefined);

  // One page per tab, in tab order: Starred, All, then each list. Each gets
  // its own pastel tone (lists by position, cycling).
  const pages: TaskPage[] = [
    { key: STARRED_KEY, title: 'Starred', tone: STARRED_TONE, list: undefined },
    { key: ALL_KEY, title: 'All tasks', tone: ALL_TONE, list: undefined },
    ...lists.map((l, i) => ({ key: l.id, title: l.name, tone: LIST_TONES[i % LIST_TONES.length], list: l })),
  ];
  // A list deleted elsewhere (or on another device) falls back to All.
  const selectedIndex = Math.max(
    0,
    pages.findIndex((p) => p.key === selectedKey) === -1 ? 1 : pages.findIndex((p) => p.key === selectedKey)
  );
  const selectedPage = pages[selectedIndex];

  // A tab tap (or a new/deleted list) moves the pager to that page, and the
  // tab bar follows a swipe so the selected tab stays in view. After a
  // swipe the pager is already there, so its scroll is a no-op.
  const selectedPageKey = selectedPage.key;
  useEffect(() => {
    pagerRef.current?.scrollToOffset({ offset: selectedIndex * pageWidth, animated: true });
    const x = tabOffsets.current[selectedPageKey];
    if (x !== undefined) tabBarRef.current?.scrollTo({ x: Math.max(0, x - 40), animated: true });
  }, [selectedIndex, selectedPageKey, pageWidth]);

  const tasksForPage = (key: string) =>
    key === STARRED_KEY ? tasks.filter((t) => t.starred) : key === ALL_KEY ? tasks : tasks.filter((t) => t.list_id === key);
  const openCountFor = (key: string) => tasksForPage(key).filter((t) => t.status !== 'completed').length;

  const toggleCompleted = (key: string) =>
    setExpandedCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // The + button: a new task in the list on screen (starred, on Starred).
  const openNewTask = () =>
    setNewTaskSeed({
      title: '',
      listId: selectedPage.list?.id ?? null,
      starred: selectedPage.key === STARRED_KEY,
    });

  // Errors propagate to NewTaskSheet, which alerts and stays open.
  const saveNewTask = async (input: NewTaskInput) => {
    await tasksState.add(input.title, input.dueDate, input.listId, input.description, newTaskSeed?.starred ?? false);
    // Saved into a different list than the one on screen: follow it there
    // (or to All, when it has no list) so the new task is visible.
    if (selectedPage.list && selectedPage.list.id !== input.listId) setSelectedKey(input.listId ?? ALL_KEY);
    setNewTaskSeed(null);
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
            if (selectedKey === list.id) setSelectedKey(ALL_KEY);
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
      if (list) setSelectedKey(list.id);
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

  const renderPage = (page: TaskPage) => {
    const pageTasks = tasksForPage(page.key);
    // Extracted from a recording but not confident enough about which list
    // -- kept in their own section on All instead of mixed in with filed
    // tasks, so they don't get lost.
    const needsListReview =
      page.key === ALL_KEY ? pageTasks.filter((t) => t.status !== 'completed' && !t.list_id && t.list_suggestion) : [];
    const reviewIds = new Set(needsListReview.map((t) => t.id));
    const open = pageTasks.filter((t) => t.status !== 'completed' && !reviewIds.has(t.id));
    const completed = pageTasks.filter((t) => t.status === 'completed');
    const showCompleted = expandedCompleted.has(page.key);
    // Which list a task is in only matters on the pages that mix lists.
    const showListTag = page.list === undefined;
    const row = (task: Task) => (
      <TaskRow
        key={task.id}
        task={task}
        list={showListTag ? listById(task.list_id) : undefined}
        accent={page.tone.deep}
        onToggle={() =>
          tasksState.toggle(task).catch((e) => Alert.alert('Could not update', friendlyMessage(e, 'Please try again.')))
        }
        onOpen={() => setEditing(task)}
        onToggleStar={() => toggleStar(task)}
      />
    );

    return (
      <ScrollView
        style={{ width: pageWidth }}
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { backgroundColor: page.tone.bg }]}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {page.title}
            </Text>
            {page.list ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit list ${page.title}`}
                onPress={() => page.list && openManageList(page.list)}
                hitSlop={6}
                style={styles.cardMenu}
              >
                <Text style={styles.cardMenuText}>⋮</Text>
              </Pressable>
            ) : null}
          </View>

          {needsListReview.length > 0 ? (
            <View style={{ marginBottom: 6 }}>
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

          {open.length === 0 && needsListReview.length === 0 ? (
            <Text style={styles.emptyText}>
              {page.key === STARRED_KEY
                ? 'Star a task to see it here.'
                : completed.length > 0
                  ? 'All done here.'
                  : 'No tasks yet. Tap + to add one.'}
            </Text>
          ) : (
            open.map(row)
          )}

          {completed.length > 0 ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showCompleted }}
                onPress={() => toggleCompleted(page.key)}
                style={styles.completedHead}
              >
                <Text style={styles.completedHeadText}>Completed ({completed.length})</Text>
                <Text style={styles.completedChevron}>{showCompleted ? '▴' : '▾'}</Text>
              </Pressable>
              {showCompleted ? completed.map(row) : null}
            </>
          ) : null}
        </View>
      </ScrollView>
    );
  };

  return (
    <Screen scroll={false} padded={false} bottomPadding={0}>
      {/* paddingRight keeps the title clear of Screen's Account button. */}
      <View style={styles.header}>
        <Text style={styles.title}>Tasks</Text>
      </View>

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
          {/* Google Tasks' layout: a swipeable row of list tabs (Starred,
              All, each list, then + for a new list), the selected list's
              tasks in a card below, and a + button for a new task. */}
          <ScrollView
            ref={tabBarRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabBar}
            contentContainerStyle={styles.tabBarContent}
          >
            {pages.map((page, i) => {
              const selected = i === selectedIndex;
              const count = openCountFor(page.key);
              return (
                <Pressable
                  key={page.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={page.key === STARRED_KEY ? 'Starred' : page.title}
                  onPress={() => setSelectedKey(page.key)}
                  onLongPress={page.list ? () => page.list && openManageList(page.list) : undefined}
                  onLayout={(e) => {
                    tabOffsets.current[page.key] = e.nativeEvent.layout.x;
                  }}
                  style={styles.tab}
                >
                  <View style={styles.tabLabelRow}>
                    {page.key === STARRED_KEY ? (
                      <StarIcon size={20} filled color={selected ? page.tone.deep : colors.neutral500} />
                    ) : (
                      <Text
                        style={[styles.tabText, selected && { color: page.tone.deep, fontFamily: font.extrabold }]}
                        numberOfLines={1}
                      >
                        {page.key === ALL_KEY ? 'All' : page.title}
                      </Text>
                    )}
                    {count > 0 && page.key !== STARRED_KEY ? (
                      <View style={[styles.tabCount, { backgroundColor: page.tone.bg }]}>
                        <Text style={styles.tabCountText}>{count}</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={[styles.tabUnderline, selected && { backgroundColor: page.tone.deep }]} />
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New list"
              onPress={() => setCreatingList(true)}
              style={styles.tab}
            >
              <View style={styles.tabLabelRow}>
                <Text style={styles.newListTabText}>+ New list</Text>
              </View>
              <View style={styles.tabUnderline} />
            </Pressable>
          </ScrollView>
          <View style={styles.tabBarRule} />

          <FlatList
            ref={pagerRef}
            data={pages}
            keyExtractor={(p) => p.key}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={selectedIndex}
            getItemLayout={(_, index) => ({ length: pageWidth, offset: pageWidth * index, index })}
            onMomentumScrollEnd={(e) => {
              const index = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
              const page = pages[index];
              if (page && page.key !== selectedKey) setSelectedKey(page.key);
            }}
            renderItem={({ item }) => renderPage(item)}
            // Re-render pages when anything they show changes, not only `pages`.
            extraData={[tasks, expandedCompleted, busyTaskId, lists]}
            style={styles.pager}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New task"
            onPress={openNewTask}
            style={({ pressed }) => [
              styles.fab,
              { backgroundColor: selectedPage.tone.deep },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.fabText}>+</Text>
          </Pressable>
        </>
      )}

      <NewTaskSheet seed={newTaskSeed} lists={lists} onClose={() => setNewTaskSeed(null)} onSave={saveNewTask} />

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
  accent,
  onToggle,
  onOpen,
  onToggleStar,
}: {
  task: Task;
  list: TaskList | undefined;
  /** The page's deeper tone, for the check circle. */
  accent: string;
  onToggle: () => void;
  onOpen: () => void;
  onToggleStar: () => void;
}) {
  const done = task.status === 'completed';
  const due = task.due_date ? formatDueDate(task.due_date) : null;
  return (
    <View style={styles.task}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={task.title}
        onPress={onToggle}
        hitSlop={6}
        style={styles.checkHit}
      >
        <View style={[styles.checkCircle, { borderColor: accent }, done && { backgroundColor: accent }]}>
          {done ? <CheckIcon size={14} color={colors.bg} /> : null}
        </View>
      </Pressable>
      <Pressable style={styles.taskBody} onPress={onOpen} onLongPress={onOpen}>
        <Text style={[styles.taskTitle, done && styles.taskTitleDone]}>{task.title}</Text>
        {task.description && !done ? (
          <Text style={styles.taskNotes} numberOfLines={1}>
            {task.description}
          </Text>
        ) : null}
        {(due && !done) || list ? (
          <View style={styles.metaRow}>
            {due && !done ? <Text style={[styles.dueBadge, { color: accent, borderColor: accent }]}>{due}</Text> : null}
            {list ? <Tag variant="neutral">{list.name}</Tag> : null}
          </View>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={task.starred ? 'Unstar task' : 'Star task'}
        onPress={onToggleStar}
        hitSlop={6}
        style={styles.starButton}
      >
        <StarIcon size={22} filled={task.starred} color={task.starred ? '#e0a526' : colors.neutral500} />
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
    if (!checkDueDate(dueDate)) return;
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

  return (
    <BottomSheet visible={task !== null} onClose={onClose} title="Edit task" maxHeight="85%">
          <TextInput
            style={[styles.input, styles.titleInput]}
            value={title}
            onChangeText={setTitle}
            placeholder="Task title"
            placeholderTextColor={colors.neutral600}
            {...SHEET_TITLE_INPUT_PROPS}
          />

          <NotesField label="Details" value={description} onChange={setDescription} />

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

          <DueDateField value={dueDate} onChange={setDueDate} />

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

/** Alerts and returns false for a typed due date that isn't a real YYYY-MM-DD. */
function checkDueDate(dueDate: string | null): boolean {
  if (dueDate && !parseLocalDate(dueDate)) {
    Alert.alert('Check the date', 'Use the format YYYY-MM-DD, e.g. 2026-09-19.');
    return false;
  }
  return true;
}

// The field blocks shared by the Edit task and New task sheets, so the two
// stay identical to fill in.

function NotesField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, styles.descriptionInput]}
        value={value}
        onChangeText={onChange}
        placeholder="Add notes for this task"
        placeholderTextColor={colors.neutral600}
        multiline
        // Grows with its text instead of scrolling inside itself, so a drag
        // that starts on it scrolls the sheet (see SHEET_TITLE_INPUT_PROPS).
        scrollEnabled={false}
        textAlignVertical="top"
      />
    </>
  );
}

function DueDateField({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const today = isoDate(new Date());
  const tomorrow = isoDate(new Date(Date.now() + 86_400_000));
  const nextWeek = isoDate(new Date(Date.now() + 7 * 86_400_000));
  return (
    <>
      <Text style={styles.fieldLabel}>Due date</Text>
      <View style={styles.dateRow}>
        <DateChip label="No date" selected={value === null} onPress={() => onChange(null)} />
        <DateChip label="Today" selected={value === today} onPress={() => onChange(today)} />
        <DateChip label="Tomorrow" selected={value === tomorrow} onPress={() => onChange(tomorrow)} />
        <DateChip label="+1 week" selected={value === nextWeek} onPress={() => onChange(nextWeek)} />
      </View>
      <TextInput
        style={styles.input}
        value={value ?? ''}
        onChangeText={(v) => onChange(v.trim() || null)}
        placeholder="Or type YYYY-MM-DD"
        placeholderTextColor={colors.neutral600}
        keyboardType="numbers-and-punctuation"
      />
    </>
  );
}

type NewTaskInput = { title: string; description: string | null; dueDate: string | null; listId: string | null };
/** What the New task sheet opens with: a title typed into the quick-add row (or ''), and the list to start in. */
/** A new task starts in the list on screen -- and starred when added from the Starred page. */
type NewTaskSeed = { title: string; listId: string | null; starred: boolean };

/** Create a task by typing -- the same fields as Edit task, plus a list picker. */
function NewTaskSheet({
  seed,
  lists,
  onClose,
  onSave,
}: {
  seed: NewTaskSeed | null;
  lists: TaskList[];
  onClose: () => void;
  onSave: (input: NewTaskInput) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [listId, setListId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fresh fields every time the sheet opens; a failed save leaves them as typed.
  React.useEffect(() => {
    if (seed) {
      setTitle(seed.title);
      setDescription('');
      setDueDate(null);
      setListId(seed.listId);
    }
  }, [seed]);

  // Backdrop, Android back and Cancel all come through here: never while a
  // save is in flight (a failure would have nowhere left to keep the fields),
  // and only after asking when something was typed.
  const close = () => {
    if (saving) return;
    const typed = (title.trim() && title.trim() !== seed?.title.trim()) || description.trim();
    if (!typed) {
      onClose();
      return;
    }
    Alert.alert('Discard this task?', 'What you typed will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };

  const save = async () => {
    if (!title.trim() || saving) return;
    if (!checkDueDate(dueDate)) return;
    setSaving(true);
    try {
      await onSave({ title: title.trim(), description: description.trim() || null, dueDate, listId });
    } catch (e) {
      Alert.alert('Could not add task', friendlyMessage(e, 'Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={seed !== null}
      onClose={close}
      title="New task"
      maxHeight="85%"
      // Pinned, not at the end of the scrolling fields: with the title's
      // keyboard up, Save would otherwise be scrolled out of sight.
      footer={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <View style={{ flex: 1 }} />
          <Button label="Cancel" variant="ghost" onPress={close} disabled={saving} />
          <Button
            label={saving ? 'Saving…' : 'Save'}
            variant="save"
            disabled={saving || !title.trim()}
            onPress={save}
            style={{ paddingHorizontal: 20 }}
          />
        </View>
      }
    >
      <TextInput
        style={[styles.input, styles.titleInput]}
        value={title}
        onChangeText={setTitle}
        placeholder="What needs doing?"
        placeholderTextColor={colors.neutral600}
        autoFocus
        onSubmitEditing={save}
        editable={!saving}
        {...SHEET_TITLE_INPUT_PROPS}
      />

      <NotesField label="Notes" value={description} onChange={setDescription} />

      <DueDateField value={dueDate} onChange={setDueDate} />

      <Text style={styles.fieldLabel}>List</Text>
      <View style={styles.dateRow}>
        <ListChip label="No list" selected={listId === null} onPress={() => setListId(null)} muted />
        {lists.map((l) => (
          <ListChip key={l.id} label={l.name} selected={listId === l.id} onPress={() => setListId(l.id)} />
        ))}
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
  header: {
    paddingHorizontal: GUTTER,
    // Clear of Screen's Account button, top-right.
    paddingRight: GUTTER + 44,
  },
  title: {
    ...h2,
    marginTop: 6,
    marginBottom: 6,
  },
  tabBar: {
    // A horizontal ScrollView defaults to flexGrow: 1 -- it must not take
    // the page's height from the pager below.
    flexGrow: 0,
  },
  tabBarContent: {
    paddingHorizontal: GUTTER - 6,
    alignItems: 'flex-end',
  },
  tab: {
    minHeight: 48,
    paddingHorizontal: 12,
    justifyContent: 'flex-end',
  },
  tabLabelRow: {
    // Fixed height so a tab without a count badge (or the star) lines up
    // with the ones that have one.
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  tabText: {
    fontFamily: font.semibold,
    fontSize: 15,
    color: colors.neutral700,
    maxWidth: 160,
  },
  tabCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabCountText: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: colors.text,
  },
  tabUnderline: {
    height: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: 'transparent',
  },
  newListTabText: {
    fontFamily: font.semibold,
    fontSize: 15,
    color: colors.neutral600,
  },
  tabBarRule: {
    height: 1,
    backgroundColor: colors.neutral300,
  },
  pager: {
    flex: 1,
  },
  pageContent: {
    paddingHorizontal: GUTTER - 4,
    paddingTop: 14,
    // Room for the + button over the end of the list.
    paddingBottom: 96,
  },
  card: {
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 10,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingLeft: 6,
  },
  cardTitle: {
    flex: 1,
    fontFamily: font.extrabold,
    fontSize: 19,
    color: colors.text,
  },
  cardMenu: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMenuText: {
    fontFamily: font.extrabold,
    fontSize: 22,
    color: colors.neutral700,
  },
  completedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: 6,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(32,30,29,0.12)',
  },
  completedHeadText: {
    fontFamily: font.semibold,
    fontSize: 14,
    color: colors.neutral700,
  },
  completedChevron: {
    fontSize: 16,
    color: colors.neutral700,
  },
  fab: {
    position: 'absolute',
    right: GUTTER,
    bottom: 18,
    width: 60,
    height: 60,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  fabText: {
    fontFamily: font.regular,
    fontSize: 34,
    lineHeight: 38,
    color: colors.bg,
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
  centerBlock: {
    paddingVertical: 24,
    paddingHorizontal: GUTTER,
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
    color: colors.neutral700,
    textAlign: 'center',
    paddingVertical: 18,
  },
  sectionHeading: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 11 * 0.08,
    textTransform: 'uppercase',
    color: colors.neutral700,
    marginBottom: 8,
    paddingLeft: 6,
  },
  reviewCard: {
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: radius.pastel,
    padding: 12,
    marginBottom: 8,
  },
  task: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 52,
  },
  checkHit: {
    width: 44,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskBody: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 12,
    paddingLeft: 4,
  },
  starButton: {
    width: 44,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskTitle: {
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
  },
  taskTitleDone: {
    textDecorationLine: 'line-through',
    color: colors.neutral600,
  },
  taskNotes: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.neutral700,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  dueBadge: {
    fontFamily: font.semibold,
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
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
  titleInput: {
    paddingTop: 12,
    paddingBottom: 12,
    textAlignVertical: 'top',
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
});
