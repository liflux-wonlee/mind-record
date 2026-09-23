// Read-only lookups of a user's app data -- topics, task lists, open tasks
// -- shared by converse's voice tools (converse/tools.ts) and Search's
// Ask (search-ask), so "오늘 할 일 뭐야?" gets the same answer in both.
// Every query goes through the service-role client with an explicit
// user_id filter (the caller has already authenticated the user).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0';

export type AppDataContext = {
  db: SupabaseClient;
  userId: string;
  /** Validated IANA timezone -- what "today" means for this user. */
  timezone: string;
};

export type TopicRow = { id: string; name: string; parent_topic_id: string | null };
export type ListRow = { id: string; name: string };

export const TASK_SCOPES = ['today', 'overdue', 'upcoming', 'starred', 'open'] as const;
export type TaskScope = (typeof TASK_SCOPES)[number];
const MAX_TASKS_RETURNED = 8;

export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function localToday(timezone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export async function loadTopics(ctx: AppDataContext): Promise<TopicRow[]> {
  const { data, error } = await ctx.db
    .from('topics')
    .select('id, name, parent_topic_id')
    .eq('user_id', ctx.userId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TopicRow[];
}

export async function loadLists(ctx: AppDataContext): Promise<ListRow[]> {
  const { data, error } = await ctx.db
    .from('task_lists')
    .select('id, name')
    .eq('user_id', ctx.userId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ListRow[];
}

export function topicDisplay(topic: TopicRow, all: TopicRow[]): string {
  if (!topic.parent_topic_id) return topic.name;
  const parent = all.find((t) => t.id === topic.parent_topic_id);
  return parent ? `${parent.name} · ${topic.name}` : topic.name;
}

export function formatTopicTree(topics: TopicRow[]): string {
  const lines: string[] = [];
  for (const root of topics.filter((t) => !t.parent_topic_id)) {
    lines.push(`- ${root.name}`);
    for (const child of topics.filter((t) => t.parent_topic_id === root.id)) lines.push(`  - ${child.name}`);
  }
  return lines.join('\n');
}

export async function listTopics(ctx: AppDataContext) {
  const topics = await loadTopics(ctx);
  if (topics.length === 0) return { count: 0, note: 'The user has no topics yet.' };
  return { count: topics.length, tree: formatTopicTree(topics) };
}

export async function listTaskLists(ctx: AppDataContext) {
  const lists = await loadLists(ctx);
  const { data: open, error } = await ctx.db
    .from('tasks')
    .select('list_id')
    .eq('user_id', ctx.userId)
    .eq('status', 'open');
  if (error) throw error;
  const counts = new Map<string | null, number>();
  for (const row of open ?? []) counts.set(row.list_id, (counts.get(row.list_id) ?? 0) + 1);
  return {
    lists: lists.map((l) => ({ name: l.name, open_tasks: counts.get(l.id) ?? 0 })),
    open_tasks_not_in_any_list: counts.get(null) ?? 0,
    note: lists.length === 0 ? 'The user has no task lists yet.' : undefined,
  };
}

type TaskRowLite = { title: string; due_date: string | null; starred: boolean | null; list_id: string | null };

export async function listTasks(ctx: AppDataContext, args: { scope?: string; listName?: string }) {
  const scope: TaskScope = (TASK_SCOPES as readonly string[]).includes(args.scope ?? '') ? (args.scope as TaskScope) : 'open';
  const today = localToday(ctx.timezone);
  const lists = await loadLists(ctx);

  let listFilter: ListRow | null = null;
  const listName = args.listName?.trim() ?? '';
  if (listName) {
    listFilter = lists.find((l) => sameName(l.name, listName)) ?? null;
    if (!listFilter) {
      return { error: `There is no task list named "${listName}".`, available_lists: lists.map((l) => l.name) };
    }
  }

  const base = () => {
    let q = ctx.db
      .from('tasks')
      .select('title, due_date, starred, list_id', { count: 'exact' })
      .eq('user_id', ctx.userId)
      .eq('status', 'open');
    if (listFilter) q = q.eq('list_id', listFilter.id);
    return q;
  };

  const describeDue = (due: string | null): string | null => {
    if (!due) return null;
    if (due < today) return `overdue (was due ${due})`;
    if (due === today) return 'today';
    if (due === addDays(today, 1)) return 'tomorrow';
    return due;
  };
  const shape = (rows: TaskRowLite[]) =>
    rows.map((t) => ({
      title: t.title,
      due: describeDue(t.due_date),
      list: lists.find((l) => l.id === t.list_id)?.name ?? null,
      starred: t.starred === true,
    }));

  if (scope === 'today') {
    // Due today and overdue separately, today first -- ordered together,
    // a backlog of old overdue tasks would push today's out of view.
    const [dueToday, overdue] = await Promise.all([
      base().eq('due_date', today).order('created_at', { ascending: false }).limit(5),
      base().lt('due_date', today).order('due_date', { ascending: false }).limit(5),
    ]);
    if (dueToday.error) throw dueToday.error;
    if (overdue.error) throw overdue.error;
    const result: Record<string, unknown> = {
      scope,
      today,
      due_today_total: dueToday.count ?? 0,
      due_today: shape((dueToday.data ?? []) as TaskRowLite[]),
      overdue_total: overdue.count ?? 0,
      overdue: shape((overdue.data ?? []) as TaskRowLite[]),
      note: "Lead with what's due today; mention overdue ones after that.",
    };
    // Most tasks come out of recordings without a due date, so "what's on
    // for today?" would often be "nothing" -- offer what IS there.
    if ((dueToday.count ?? 0) === 0 && (overdue.count ?? 0) === 0) {
      const [starred, undated] = await Promise.all([
        base().eq('starred', true).order('created_at', { ascending: false }).limit(3),
        base().is('due_date', null).order('created_at', { ascending: false }).limit(3),
      ]);
      if (starred.error) throw starred.error;
      if (undated.error) throw undated.error;
      result.nothing_due_today = true;
      result.starred = shape((starred.data ?? []) as TaskRowLite[]);
      result.starred_total = starred.count ?? 0;
      result.recent_without_due_date = shape((undated.data ?? []) as TaskRowLite[]);
      result.without_due_date_total = undated.count ?? 0;
      result.note = 'Nothing is due today. Say so, then mention the starred ones (if any) or offer the most recent open tasks.';
    }
    return result;
  }

  let query = base();
  if (scope === 'overdue') query = query.lt('due_date', today);
  else if (scope === 'upcoming') query = query.gte('due_date', today).lte('due_date', addDays(today, 7));
  else if (scope === 'starred') query = query.eq('starred', true);
  const { data, count, error } = await query
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(MAX_TASKS_RETURNED);
  if (error) throw error;

  const rows = (data ?? []) as TaskRowLite[];
  return {
    scope,
    today,
    total: count ?? rows.length,
    shown: rows.length,
    tasks: shape(rows),
  };
}
