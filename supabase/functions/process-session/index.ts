// Runs after a recording ends: downloads the session's audio segments,
// transcribes them with OpenAI Whisper, then asks GPT to extract tasks,
// ideas, a summary, and a topic for each one from the transcript. Writes
// everything back to `sessions` / `tasks` / `memories` / `topics` /
// `session_topics`.
//
// Invoked by the app via
//   supabase.functions.invoke('process-session', { body: { sessionId } })
// right after src/hooks/useCaptureSession.ts ends a capture session (see
// src/services/processing.ts). The OpenAI API key never touches the mobile
// app -- it only lives here, as an Edge Function secret:
//   supabase secrets set OPENAI_API_KEY=sk-...
//
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are provided
// automatically by the Edge Functions runtime; only OPENAI_API_KEY needs to
// be set by hand.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0';

import { errorMessage } from '../_shared/errorMessage.ts';
import { parseActionRecord, type ActionRecord } from '../_shared/actionLog.ts';
import { findSimilarName } from '../_shared/nameMatch.ts';
import { localDay, resolveUserTimeZone } from '../_shared/timezone.ts';
import { recordUsage } from '../_shared/usage.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Below this, an item's topic_name is kept only as `topic_suggestion` (not
// auto-assigned) -- the app asks the user to confirm it on Summary instead
// of silently filing something AI wasn't sure about.
const TOPIC_CONFIDENCE_THRESHOLD = 0.6;
// Same idea, for a task's list_name -- see resolveList.
const LIST_CONFIDENCE_THRESHOLD = 0.6;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type TopicRow = { id: string; name: string; parent_topic_id: string | null };
/** Flat -- unlike topics, task lists (e.g. "Shopping", "Work") have no nesting. */
type ListRow = { id: string; name: string };

type ExtractedTask = {
  title: string;
  priority?: 'low' | 'normal' | 'high';
  /** YYYY-MM-DD, only when the speaker stated a deadline. */
  due_date?: string | null;
  topic_name?: string | null;
  topic_parent_name?: string | null;
  topic_confidence?: number;
  /** Which task list (e.g. "Shopping", "Work") this task belongs in -- a
   *  separate concept from topic_name (subject-matter categorization);
   *  only tasks get lists, not ideas or outline sections. */
  list_name?: string | null;
  list_confidence?: number;
};
type ExtractedMemory = {
  content: string;
  category?: string | null;
  topic_name?: string | null;
  topic_parent_name?: string | null;
  topic_confidence?: number;
};
/**
 * An outline section files under its own topic, independently of every
 * other section in the same recording -- a single recording can genuinely
 * cover more than one topic (e.g. a work errand and a personal note about a
 * friend, back to back), so there is no longer one "session_topic" for the
 * whole recording. `topic_name`/`topic_parent_name`/`topic_confidence` here
 * are GPT's per-section extraction, resolved via `resolveTopic` below the
 * same way a task/memory's topic is.
 */
type OutlineSection = {
  heading: string;
  bullets: string[];
  topic_name?: string | null;
  topic_parent_name?: string | null;
  topic_confidence?: number;
};
type RequestedTopic = { name: string; parent_name?: string | null };

type Extraction = {
  summary: string;
  outline: OutlineSection[];
  /** Standout, verbatim lines worth pulling out on their own -- empty for most casual, day-to-day recordings. */
  notable_quotes: string[];
  tasks: ExtractedTask[];
  memories: ExtractedMemory[];
  /** Topics the speaker explicitly asked to have created, even with nothing to file under them yet. */
  requested_topics: RequestedTopic[];
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (!OPENAI_API_KEY) {
    return json({ error: 'OPENAI_API_KEY is not configured on this project.' }, 500);
  }

  let sessionId: string | undefined;
  // The device's IANA timezone (src/lib/timezone.ts) -- what "today" and
  // "내일" meant when the recording was made.
  let deviceTimezone: unknown;
  try {
    ({ sessionId, timezone: deviceTimezone } = await req.json());
  } catch {
    // handled by the missing-sessionId check below
  }
  if (!sessionId) {
    return json({ error: 'sessionId is required.' }, 400);
  }

  // Identify the caller from their JWT -- a bare sessionId alone proves nothing.
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const {
    data: { user },
    error: authError,
  } = await callerClient.auth.getUser();
  if (authError || !user) {
    return json({ error: 'Not authenticated.' }, 401);
  }

  // Service-role client for the multi-table writes below -- RLS is bypassed
  // here, so every read/write is manually scoped to `user.id` instead,
  // mirroring the ownership checks the RLS policies themselves would run.
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: session, error: sessionError } = await db
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionError) return json({ error: errorMessage(sessionError, 'Could not load this session.') }, 500);
  if (!session || session.user_id !== user.id) {
    return json({ error: 'Session not found.' }, 404);
  }

  // A session that already finished processing must not be extracted
  // again -- a retried upload, a duplicate invoke, or anything else that
  // calls this a second time for the same session would otherwise create
  // a second copy of every task/idea it already filed. This is a no-op,
  // not an error: the session was already handled.
  if (session.processing_status === 'done') {
    return json({ status: 'done', summary: session.summary ?? '', taskCount: null, memoryCount: null });
  }

  // Atomically claim the session: only a row still in 'pending' or 'error'
  // can be claimed, and the conditional UPDATE (not a separate read-then-
  // write) means at most one of two concurrent/retried invocations (e.g. a
  // double-tap on Summary's Retry button) actually wins and proceeds --
  // the loser sees `claimed: null` and backs off instead of re-running the
  // whole extraction and duplicating every task/idea a moment later.
  const { data: claimed, error: claimError } = await db
    .from('sessions')
    .update({ processing_status: 'transcribing' })
    .eq('id', sessionId)
    .in('processing_status', ['pending', 'error'])
    .select('id')
    .maybeSingle();
  if (claimError) {
    console.error('process-session claim failed:', claimError);
    return json({ error: errorMessage(claimError, 'Could not start processing this recording.') }, 500);
  }
  if (!claimed) {
    return json({ status: 'already_processing' }, 409);
  }

  try {
    // Conversation mode (see supabase/functions/converse) already transcribes
    // each turn live and leaves the result in `messages` -- reuse that
    // instead of re-running Whisper on the same audio a second time. Capture
    // mode never writes to `messages`, so it always falls through to the
    // attachment-transcription path below.
    const { data: existingMessages, error: messagesError } = await db
      .from('messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('position', { ascending: true });
    if (messagesError) throw messagesError;

    // Accumulated across every attachment actually sent to Whisper below
    // (either branch) so this session's transcription cost is recorded as
    // one usage event, not one per segment.
    let transcribedSeconds = 0;
    let transcribedBytes = 0;
    // The language Whisper detected for the first segment that actually had
    // one -- used to steer the analysis step's output language below,
    // instead of leaving GPT to re-detect it from the transcript text alone.
    let detectedLanguage: string | null = null;

    let transcript: string;
    // For a conversation, what the analysis reads is the whole exchange,
    // labelled (see below) -- raw_transcript, shown on Summary, stays the
    // user's own words only.
    let analysisInput: string | null = null;
    const actionRecords: ActionRecord[] = [];
    if (existingMessages && existingMessages.length > 0) {
      const conversationTranscript = existingMessages
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .join('\n\n');

      // A turn whose audio was uploaded but never made it into `messages`
      // (the app lost connection or was killed between upload and the
      // converse reply, or converse itself errored before saving the
      // transcript) leaves an orphaned attachment here -- transcribe it
      // too instead of silently dropping that turn's content just because
      // other turns in the same conversation succeeded.
      const { data: leftoverAudio, error: leftoverError } = await db
        .from('attachments')
        .select('*')
        .eq('session_id', sessionId)
        .eq('type', 'audio')
        .order('created_at', { ascending: true });
      if (leftoverError) throw leftoverError;

      let leftoverTranscript = '';
      if (leftoverAudio && leftoverAudio.length > 0) {
        const parts: string[] = [];
        for (const attachment of leftoverAudio) {
          const { data: file, error: downloadError } = await db.storage
            .from('recordings')
            .download(attachment.storage_path);
          if (downloadError) throw downloadError;
          const result = await transcribeAudio(file, attachment.file_name);
          transcribedSeconds += result.durationSeconds;
          transcribedBytes += result.bytes;
          if (result.text.trim()) parts.push(result.text.trim());
          if (!detectedLanguage && result.language) detectedLanguage = result.language;
        }
        leftoverTranscript = parts.join('\n\n');
      }

      transcript = leftoverTranscript ? `${conversationTranscript}\n\n${leftoverTranscript}` : conversationTranscript;

      // The AI's replies, and the changes it made in the app when asked
      // (converse's tools -- see _shared/actionLog.ts), are context for
      // reading the user's words, not content: a turn like "오늘 할 일
      // 뭐야?" or "카메라 설치 할 일로 넣어줘" was an instruction to the app
      // that was already handled.
      const lines: string[] = [];
      for (const m of existingMessages) {
        if (m.role === 'user') lines.push(`User: ${m.content}`);
        else if (m.role === 'assistant') lines.push(`AI: ${m.content}`);
        else {
          const record = parseActionRecord(m);
          if (!record) continue;
          actionRecords.push(record);
          lines.push(`[App did: ${record.label}${record.undone ? ' -- then UNDONE at the user\'s request' : ''}]`);
        }
      }
      if (leftoverTranscript) {
        for (const part of leftoverTranscript.split('\n\n')) lines.push(`User: ${part}`);
      }
      analysisInput = lines.join('\n');
    } else {
      const { data: attachments, error: attachmentsError } = await db
        .from('attachments')
        .select('*')
        .eq('session_id', sessionId)
        .eq('type', 'audio')
        .order('created_at', { ascending: true });
      if (attachmentsError) throw attachmentsError;

      if (!attachments || attachments.length === 0) {
        await db
          .from('sessions')
          .update({
            processing_status: 'error',
            processing_error: 'No audio was recorded for this session.',
          })
          .eq('id', sessionId);
        return json({ error: 'No audio to process.' }, 400);
      }

      const transcriptParts: string[] = [];
      for (const attachment of attachments) {
        const { data: file, error: downloadError } = await db.storage
          .from('recordings')
          .download(attachment.storage_path);
        if (downloadError) throw downloadError;
        const result = await transcribeAudio(file, attachment.file_name);
        transcribedSeconds += result.durationSeconds;
        transcribedBytes += result.bytes;
        if (result.text.trim()) transcriptParts.push(result.text.trim());
        if (!detectedLanguage && result.language) detectedLanguage = result.language;
      }
      transcript = transcriptParts.join('\n\n');
    }

    if (transcribedSeconds > 0 || transcribedBytes > 0) {
      await recordUsage(db, {
        userId: user.id,
        eventType: 'transcribe',
        source: 'process_session',
        sessionId,
        dedupeKey: `process_session:transcribe:${sessionId}`,
        audioSeconds: transcribedSeconds,
        audioBytes: transcribedBytes,
      });
    }

    const { error: transcriptError } = await db
      .from('sessions')
      .update({ raw_transcript: transcript, processing_status: 'analyzing' })
      .eq('id', sessionId);
    if (transcriptError) throw transcriptError;

    const { data: existingTopics, error: topicsError } = await db
      .from('topics')
      .select('id, name, parent_topic_id')
      .eq('user_id', user.id);
    if (topicsError) throw topicsError;
    const topics: TopicRow[] = existingTopics ?? [];

    const { data: existingLists, error: listsError } = await db
      .from('task_lists')
      .select('id, name')
      .eq('user_id', user.id);
    if (listsError) throw listsError;
    const lists: ListRow[] = existingLists ?? [];

    // Tasks that already exist for this session: ones the user added out
    // loud DURING the conversation (converse's create_task tool), or ones
    // left behind by an earlier attempt at this same run that failed
    // partway. The analysis is told about them, and any re-extraction of
    // one is dropped below, instead of filing the same to-do twice.
    const { data: existingSessionTasks, error: existingTasksError } = await db
      .from('tasks')
      .select('title')
      .eq('source_session_id', sessionId)
      .eq('user_id', user.id);
    if (existingTasksError) throw existingTasksError;
    const existingTaskTitles = (existingSessionTasks ?? []).map((t) => t.title as string);

    // What the user had the voice assistant do live, and what they then
    // undid -- saving the conversation must neither redo the undone nor
    // lose the done. Something undone and then done again live counts as done.
    const undone = actionRecords.filter((r) => r.undone);
    const live = actionRecords.filter((r) => !r.undone);
    const liveTaskTitles = new Set(live.filter((r) => r.type === 'task_created').map((r) => normalizeTaskTitle(r.subject)));
    const liveTopicKeys = new Set(live.filter((r) => r.type !== 'task_created').map((r) => normalizeTopicKey(r.subject)));
    const liveTopicIds = new Set(live.flatMap((r) => [...r.topic_ids, ...(r.linked_topic_id ? [r.linked_topic_id] : [])]));

    const undoneTaskTitles = new Set(
      undone
        .filter((r) => r.type === 'task_created')
        .map((r) => normalizeTaskTitle(r.subject))
        .filter((key) => !liveTaskTitles.has(key))
    );
    // Topics the user created by voice and then undid (undo deleted them):
    // never re-create them. Keyed by full display name ("business · liflux"),
    // plus the parent's own name when that record created the parent too.
    const undoneCreatedTopics = new Set<string>();
    for (const r of undone) {
      if (r.topic_ids.length === 0) continue;
      const key = normalizeTopicKey(r.subject);
      if (!liveTopicKeys.has(key)) undoneCreatedTopics.add(key);
      const parts = r.subject.split('·').map((p) => normalizeTopicKey(p));
      if (parts.length > 1 && r.topic_ids.length > 1 && !liveTopicKeys.has(parts[0])) undoneCreatedTopics.add(parts[0]);
    }
    // Filings into a topic that still exists, which the user undid: don't
    // file the conversation there after all (by id -- a same-named topic
    // elsewhere in the tree is a different topic).
    const undoneFiledTopicIds = new Set(
      undone
        .filter((r) => r.type === 'topic_filed' && r.linked_topic_id && !liveTopicIds.has(r.linked_topic_id))
        .map((r) => r.linked_topic_id as string)
    );
    // Topics the user filed this conversation under by voice, and that still exist.
    const liveFiledTopics: TopicRow[] = [];
    for (const r of live) {
      if (r.type !== 'topic_filed') continue;
      const id = r.linked_topic_id ?? r.topic_ids[r.topic_ids.length - 1] ?? findTopicByDisplay(topics, r.subject)?.id ?? null;
      const topic = id ? topics.find((t) => t.id === id) : undefined;
      if (topic && !liveFiledTopics.includes(topic)) liveFiledTopics.push(topic);
    }

    const { data: profileRow } = await db.from('profiles').select('timezone').eq('id', user.id).maybeSingle();
    const userTimeZone = resolveUserTimeZone(db, user.id, deviceTimezone, profileRow?.timezone);
    if (userTimeZone.save) await userTimeZone.save;
    // The day the recording was made, not the day it's processed (a Retry
    // can come days later) -- only when the timezone is actually known;
    // otherwise relative dates like "내일" can't be resolved reliably.
    const recordedOn = userTimeZone.known
      ? localDay(new Date(session.started_at ?? session.created_at ?? Date.now()), userTimeZone.timezone)
      : null;

    const {
      extraction,
      inputTokens: analysisInputTokens,
      outputTokens: analysisOutputTokens,
    } = await analyzeTranscript(analysisInput ?? transcript, topics, lists, existingTaskTitles, detectedLanguage, {
      isConversation: analysisInput !== null,
      recordedOn,
      liveChanges: live.map((r) => r.label),
      undoneChanges: undone.map((r) => r.label),
      liveFiledTopics: liveFiledTopics.map((t) => topicDisplayName(t, topics)),
    });
    if (analysisInputTokens > 0 || analysisOutputTokens > 0) {
      await recordUsage(db, {
        userId: user.id,
        eventType: 'gpt_completion',
        source: 'process_session',
        sessionId,
        dedupeKey: `process_session:analyze:${sessionId}`,
        inputTokens: analysisInputTokens,
        outputTokens: analysisOutputTokens,
      });
    }

    // Would filing under this name bring back a topic the user created by
    // voice and then undid? Only if it would actually be created again -- a
    // topic that still exists (undo keeps one that's in use) is fine to use.
    const recreatesUndoneTopic = (name: string, parentName: string | null): boolean => {
      if (undoneCreatedTopics.size === 0) return false;
      const nameKey = normalizeTopicKey(name);
      if (parentName) {
        const parentKey = normalizeTopicKey(parentName);
        const fullKey = `${parentKey} · ${nameKey}`;
        const parent = topics.find((t) => !t.parent_topic_id && sameTopicName(t.name, parentName));
        if (!parent) return undoneCreatedTopics.has(parentKey) || undoneCreatedTopics.has(fullKey);
        const exists = topics.some((t) => t.parent_topic_id === parent.id && sameTopicName(t.name, name));
        return !exists && undoneCreatedTopics.has(fullKey);
      }
      if (topLevelExactMatch(topics, name)) return false;
      // GPT may name an undone sub-topic without its parent.
      return [...undoneCreatedTopics].some((key) => key === nameKey || key.split(' · ').pop() === nameKey);
    };
    const withoutUndoneTopic = <T extends { topic_name?: string | null; topic_parent_name?: string | null }>(item: T): T =>
      item.topic_name && recreatesUndoneTopic(item.topic_name, item.topic_parent_name?.trim() || null)
        ? { ...item, topic_name: null, topic_parent_name: null }
        : item;

    // "Make a topic called X" is an instruction, not content -- honour it
    // even when nothing in the recording gets filed under X yet. Before
    // this, such a request only produced a topic if some task/idea happened
    // to be assigned to it, so a bare "create this topic" was silently lost.
    for (const requested of extraction.requested_topics) {
      const name = requested.name?.trim();
      if (!name) continue;
      const parentName = requested.parent_name?.trim() || null;
      if (recreatesUndoneTopic(name, parentName)) continue;
      if (!parentName && !topLevelExactMatch(topics, name) && findSimilarTopic(topics, name)) {
        // A bare "make a topic called X" instruction has no task/idea
        // attached to it to hang a confirmation card off of (see
        // resolveTopic below for the case that does), so when X looks like
        // a near-duplicate of an existing topic the safest thing is to
        // just not create a second one -- silently creating a near-dupe,
        // or silently reusing a topic the user didn't actually name,
        // would both be worse than doing nothing.
        continue;
      }
      await findOrCreateTopic(db, user.id, topics, name, parentName);
    }

    // Resolve each item's topic (find-or-create) before inserting, so the
    // insert already carries the right topic_id -- or, below the
    // confidence threshold, no topic_id and a topic_suggestion instead.
    // Tasks also resolve a list the same way -- a separate, flat concept
    // from topics (see ListRow/resolveList).
    const alreadyExisting = new Set(existingTaskTitles.map(normalizeTaskTitle));
    const newTasks = extraction.tasks.filter((t) => {
      const key = normalizeTaskTitle(t.title);
      return !alreadyExisting.has(key) && !undoneTaskTitles.has(key);
    });
    const resolvedTasks = [];
    for (const t of newTasks) {
      const resolvedTopic = await resolveTopic(db, user.id, topics, withoutUndoneTopic(t));
      const resolvedList = await resolveList(db, user.id, lists, t);
      resolvedTasks.push({
        user_id: user.id,
        source_session_id: sessionId,
        title: t.title,
        priority: t.priority ?? 'normal',
        due_date: t.due_date ?? null,
        topic_id: resolvedTopic.topicId,
        topic_suggestion: resolvedTopic.suggestion,
        list_id: resolvedList.listId,
        list_suggestion: resolvedList.suggestion,
      });
    }

    const resolvedMemories = [];
    for (const m of extraction.memories) {
      const resolved = await resolveTopic(db, user.id, topics, withoutUndoneTopic(m));
      resolvedMemories.push({
        user_id: user.id,
        source_session_id: sessionId,
        content: m.content,
        category: m.category ?? null,
        topic_id: resolved.topicId,
        topic_suggestion: resolved.suggestion,
      });
    }

    // Every write below used to ignore its `error`, so one bad row (e.g. a
    // priority the check constraint rejects) silently dropped the entire
    // batch and the session was still marked done -- with no tasks/ideas
    // and no way to reprocess. Now a failure surfaces as processing_status
    // 'error' via the catch below.
    if (resolvedTasks.length > 0) {
      const { error } = await db.from('tasks').insert(resolvedTasks);
      if (error) throw error;
    }
    if (resolvedMemories.length > 0) {
      const { error } = await db.from('memories').insert(resolvedMemories);
      if (error) throw error;
    }

    // Resolve each outline section's own topic the same way a task/idea's
    // is resolved -- a recording can cover more than one topic, so this
    // replaces the old single "session_topic" (see the OutlineSection type
    // above). `topic_id`/`topic_suggestion` land directly on the section
    // object written to `sessions.outline` below; the app (Summary) renders
    // and lets the user change/confirm one section at a time from there.
    const resolvedOutline: { heading: string; bullets: string[]; topic_id: string | null; topic_suggestion: string | null }[] = [];
    for (const section of extraction.outline) {
      const resolved = await resolveTopic(db, user.id, topics, withoutUndoneTopic(section));
      const undoneFiling = !!resolved.topicId && undoneFiledTopicIds.has(resolved.topicId);
      const topicId = undoneFiling ? null : resolved.topicId;
      resolvedOutline.push({
        heading: section.heading,
        bullets: section.bullets,
        topic_id: topicId,
        topic_suggestion: topicId || undoneFiling ? null : resolved.suggestion,
      });
    }

    // A topic the user filed this conversation under by voice must end up
    // on a section -- Summary treats the sections (with the tasks/ideas) as
    // the source of truth for which topics a recording is under, and would
    // otherwise drop the link the first time the user changes any topic
    // there. The analysis was told to put it on the right section; if it
    // didn't, it goes on the first unfiled section, else the first section
    // not already carrying a voice filing (usually the Overview) -- the
    // user's explicit instruction outranks the AI's own guess.
    const liveFiledIds = new Set(liveFiledTopics.map((t) => t.id));
    for (const topic of liveFiledTopics) {
      if (resolvedOutline.some((s) => s.topic_id === topic.id)) continue;
      const target =
        resolvedOutline.find((s) => !s.topic_id) ?? resolvedOutline.find((s) => !s.topic_id || !liveFiledIds.has(s.topic_id));
      if (target) {
        target.topic_id = topic.id;
        target.topic_suggestion = null;
      }
    }

    // session_topics: a rollup of every topic actually resolved above,
    // across outline sections and tasks/ideas alike -- how a session shows
    // up when browsing by topic.
    const confidenceByTopic = new Map<string, number>();
    resolvedOutline.forEach((section, i) => {
      if (!section.topic_id) return;
      const confidence = extraction.outline[i]?.topic_confidence ?? 1;
      const prev = confidenceByTopic.get(section.topic_id) ?? 0;
      if (confidence > prev) confidenceByTopic.set(section.topic_id, confidence);
    });
    const allResolved = [...resolvedTasks, ...resolvedMemories];
    const allExtracted = [...newTasks, ...extraction.memories];
    allResolved.forEach((row, i) => {
      if (!row.topic_id) return;
      const confidence = allExtracted[i]?.topic_confidence ?? null;
      const prev = confidenceByTopic.get(row.topic_id) ?? 0;
      if (confidence !== null && confidence > prev) confidenceByTopic.set(row.topic_id, confidence);
    });
    if (confidenceByTopic.size > 0) {
      const { error } = await db.from('session_topics').upsert(
        Array.from(confidenceByTopic.entries()).map(([topic_id, confidence]) => ({
          session_id: sessionId,
          topic_id,
          confidence,
        })),
        { onConflict: 'session_id,topic_id' }
      );
      if (error) throw error;
    }

    const { error: doneError } = await db
      .from('sessions')
      .update({
        summary: extraction.summary,
        outline: resolvedOutline,
        notable_quotes: extraction.notable_quotes,
        title: session.title ?? extraction.summary.slice(0, 80),
        // Superseded by each outline section's own topic_suggestion above.
        topic_suggestion: null,
        processing_status: 'done',
      })
      .eq('id', sessionId);
    if (doneError) throw doneError;

    // Everything useful is now text (transcript, summary, outline, tasks,
    // ideas) and nothing in the app plays audio back, so the recordings
    // are pure storage cost from here. They are kept on any failure above
    // so Retry can reprocess; only a fully successful run discards them.
    await discardSessionAudio(db, sessionId);

    return json({
      status: 'done',
      summary: extraction.summary,
      taskCount: resolvedTasks.length,
      memoryCount: resolvedMemories.length,
    });
  } catch (e) {
    console.error('process-session failed:', e);
    const message = errorMessage(e, 'Something went wrong while processing this recording. Tap Retry.');
    await db
      .from('sessions')
      .update({ processing_status: 'error', processing_error: message })
      .eq('id', sessionId);
    return json({ error: message }, 500);
  }
});

/**
 * Finds or creates the topic (and, if named, its parent) an extracted item
 * should be filed under. Topics are nested at most one level deep -- a
 * `topic_parent_name` is only ever looked up/created as a TOP-LEVEL topic,
 * matching the "major category -> sub-topic" model this app uses.
 *
 * `topics` is mutated in place with anything newly created, so later items
 * in the same request reuse it instead of creating duplicates.
 */
async function resolveTopic(
  db: SupabaseClient,
  userId: string,
  topics: TopicRow[],
  item: { topic_name?: string | null; topic_parent_name?: string | null; topic_confidence?: number }
): Promise<{ topicId: string | null; suggestion: string | null }> {
  const name = item.topic_name?.trim();
  if (!name || (item.topic_confidence ?? 0) < TOPIC_CONFIDENCE_THRESHOLD) {
    return { topicId: null, suggestion: name ?? null };
  }
  const parentName = item.topic_parent_name?.trim() || null;
  // Confident (including an explicit "put this under X" instruction, which
  // the prompt tells GPT to mark near-1.0) but not an exact match against
  // an existing TOP-LEVEL topic -- e.g. GPT said "Family" and "Familys"
  // already exists -- falls back to a suggestion instead of silently
  // creating a near-duplicate topic; Summary's existing "AI thinks this
  // belongs under X" card already lets the user either confirm X as a new
  // topic or pick the existing similar one instead. Since the user is asked,
  // even a 2-character near-match ("가족" vs "가족여행") counts here.
  if (!parentName && !topLevelExactMatch(topics, name) && findSimilarTopic(topics, name, { shortNames: true })) {
    return { topicId: null, suggestion: name };
  }
  const topic = await findOrCreateTopic(db, userId, topics, name, parentName);
  return { topicId: topic.id, suggestion: null };
}

/**
 * Same idea as resolveTopic, for a task's list -- but flat (no parent/child,
 * no near-duplicate fuzzing): lists are a handful of simple buckets like
 * Google Tasks' own lists ("My Tasks", "Shopping"), not a taxonomy, so an
 * exact case-insensitive match is enough before creating a new one.
 */
async function resolveList(
  db: SupabaseClient,
  userId: string,
  lists: ListRow[],
  item: { list_name?: string | null; list_confidence?: number }
): Promise<{ listId: string | null; suggestion: string | null }> {
  const name = item.list_name?.trim();
  if (!name || (item.list_confidence ?? 0) < LIST_CONFIDENCE_THRESHOLD) {
    return { listId: null, suggestion: name ?? null };
  }
  let list = lists.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (!list) {
    const { data, error } = await db
      .from('task_lists')
      .insert({ user_id: userId, name })
      .select('id, name')
      .single();
    if (error) throw error;
    list = data;
    lists.push(list);
  }
  return { listId: list.id, suggestion: null };
}

function topLevelExactMatch(topics: TopicRow[], name: string): boolean {
  const target = name.toLowerCase();
  return topics.some((t) => t.parent_topic_id === null && t.name.toLowerCase() === target);
}

function normalizeTopicKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** "Business · Liflux" for a sub-topic -- the same form converse's action log uses. */
function topicDisplayName(topic: TopicRow, topics: TopicRow[]): string {
  const parent = topic.parent_topic_id ? topics.find((t) => t.id === topic.parent_topic_id) : undefined;
  return parent ? `${parent.name} · ${topic.name}` : topic.name;
}

function findTopicByDisplay(topics: TopicRow[], display: string): TopicRow | undefined {
  const parts = display.split('·').map((p) => p.trim());
  if (parts.length > 1) {
    const parent = topics.find((t) => !t.parent_topic_id && sameTopicName(t.name, parts[0]));
    return parent ? topics.find((t) => t.parent_topic_id === parent.id && sameTopicName(t.name, parts[1])) : undefined;
  }
  return topics.find((t) => !t.parent_topic_id && sameTopicName(t.name, display));
}

function sameTopicName(a: string, b: string): boolean {
  return normalizeTopicKey(a) === normalizeTopicKey(b);
}

/** Case/spacing/punctuation-insensitive form of a task title, for spotting a re-extracted duplicate. */
function normalizeTaskTitle(title: string): string {
  return title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** A TOP-LEVEL topic close enough to `name` that creating a brand new one
 *  alongside it would likely be an unwanted near-duplicate ("Family" next
 *  to "Familys", "Health" next to "Health stuff") -- close, but not the
 *  same name (an exact match is handled separately, by reusing it outright).
 *  Same rule converse's live tools use (see _shared/nameMatch.ts);
 *  `shortNames` only where a match leads to asking the user, not to
 *  silently skipping the item. */
function findSimilarTopic(topics: TopicRow[], name: string, opts: { shortNames?: boolean } = {}): TopicRow | null {
  return findSimilarName(
    topics.filter((t) => t.parent_topic_id === null),
    name,
    opts
  );
}

/** Case-insensitive find-or-create of `name` (under `parentName`, itself
 *  found-or-created as a TOP-LEVEL topic, when given). Mutates `topics`. */
async function findOrCreateTopic(
  db: SupabaseClient,
  userId: string,
  topics: TopicRow[],
  name: string,
  parentName: string | null
): Promise<TopicRow> {
  let parentId: string | null = null;
  if (parentName) {
    let parent = topics.find(
      (t) => t.parent_topic_id === null && t.name.toLowerCase() === parentName.toLowerCase()
    );
    if (!parent) {
      const { data, error } = await db
        .from('topics')
        .insert({ user_id: userId, name: parentName })
        .select('id, name, parent_topic_id')
        .single();
      if (error) throw error;
      parent = data;
      topics.push(parent);
    }
    parentId = parent.id;
  }

  let topic = topics.find(
    (t) => t.parent_topic_id === parentId && t.name.toLowerCase() === name.toLowerCase()
  );
  if (!topic) {
    const { data, error } = await db
      .from('topics')
      .insert({ user_id: userId, name, parent_topic_id: parentId })
      .select('id, name, parent_topic_id')
      .single();
    if (error) throw error;
    topic = data;
    topics.push(topic);
  }
  return topic;
}

// Deliberately no `language` hint: recordings may be in any language (or a
// mix), whatever the app's settings say, so Whisper auto-detects.
const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

type TranscribeResult = { text: string; durationSeconds: number; bytes: number; language: string | null };

async function transcribeAudio(file: Blob, fileName: string): Promise<TranscribeResult> {
  if (file.size > WHISPER_MAX_BYTES) {
    throw new Error(
      `One recording segment is too large to transcribe (${Math.round(file.size / 1024 / 1024)} MB; the limit is 25 MB). Pause and resume every ~40 minutes to split long recordings.`
    );
  }
  const form = new FormData();
  form.append('file', file, fileName);
  form.append('model', 'whisper-1');
  // verbose_json is the only response_format that gives back the audio's
  // actual duration -- the real driver of what this segment cost to
  // transcribe -- instead of this having to estimate it from file size and
  // an assumed bitrate.
  form.append('response_format', 'verbose_json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Whisper transcription failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return {
    text: data.text ?? '',
    durationSeconds: typeof data.duration === 'number' ? data.duration : 0,
    bytes: file.size,
    // verbose_json also returns Whisper's own detected spoken language (e.g.
    // "english") -- a much more reliable signal for what language the
    // analysis step should write in than asking GPT to re-detect it from
    // the transcript text alone, which a short transcript makes unreliable.
    language: typeof data.language === 'string' && data.language ? data.language : null,
  };
}

function formatTopicTree(topics: TopicRow[]): string {
  if (topics.length === 0) return '(none yet)';
  const roots = topics.filter((t) => !t.parent_topic_id);
  const lines: string[] = [];
  for (const root of roots) {
    lines.push(`- ${root.name}`);
    for (const child of topics.filter((t) => t.parent_topic_id === root.id)) {
      lines.push(`  - ${child.name}`);
    }
  }
  return lines.join('\n');
}

async function analyzeTranscript(
  transcript: string,
  topics: TopicRow[],
  lists: ListRow[],
  existingTaskTitles: string[],
  detectedLanguage: string | null,
  context: {
    isConversation: boolean;
    /** The day the recording was made, in the speaker's timezone -- null when that timezone isn't known. */
    recordedOn: { date: string; weekday: string } | null;
    liveChanges: string[];
    undoneChanges: string[];
    /** Topics the user filed the conversation under by voice ("Business · Liflux"). */
    liveFiledTopics: string[];
  }
): Promise<{ extraction: Extraction; inputTokens: number; outputTokens: number }> {
  if (!transcript.trim()) {
    return {
      extraction: {
        summary: 'No speech was detected in this recording.',
        outline: [],
        notable_quotes: [],
        tasks: [],
        memories: [],
        requested_topics: [],
      },
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  const languageInstruction = detectedLanguage
    ? `CRITICAL: The transcript's spoken language was detected as "${detectedLanguage}" by the transcription system. Write EVERY string you output -- "summary" included, not just "outline" -- in that language. Never translate or switch to a different language, no matter what language any example text elsewhere in these instructions happens to be written in -- those examples illustrate FORMAT only, not the language to use.`
    : `CRITICAL: Detect the transcript's own language and write EVERY string you output -- "summary" included, not just "outline" -- in that same language. A Korean transcript gets a Korean "summary", Korean "outline" headings/bullets, Korean "title"/"content" for tasks and memories. Never default to English or translate; match the transcript exactly. Example text elsewhere in these instructions illustrates FORMAT only, not the language to use.`;

  const conversationNote = context.isConversation
    ? `

This transcript is a spoken CONVERSATION between the user and the app's voice assistant, one line per turn. "User:" lines are the user -- they are the journal content. "AI:" lines are the assistant's replies: context for understanding the user, never content to summarize, quote, or extract tasks/ideas from. "[App did: ...]" lines are changes the assistant made in the app right then, at the user's request.
User lines that were only questions or instructions to the app -- asking what topics/tasks exist, searching their past, asking to save/end, or asking to add a task, file under a topic or make a topic -- are not journal content: leave them out of "summary", "outline" and "notable_quotes".
A request to add a task, file under a topic or make a topic was CARRIED OUT only if a matching "[App did: ...]" line follows it (right after it, or a turn or two later once the user answered a question about it) -- never output a carried-out request again as a task, idea or requested_topic. A request with no matching "[App did: ...]" line was NOT carried out (the assistant couldn't do it, or asked something back that was never settled): handle it exactly as you would in an ordinary recording -- extract the task, give the section it's about that topic_name, or add it to requested_topics.`
    : '';
  const undoneNote =
    context.undoneChanges.length > 0
      ? `

The user UNDID these changes during the conversation. Do NOT create, file under, or extract any of them again in any form:
${context.undoneChanges.map((c) => `- ${c}`).join('\n')}`
      : '';
  const liveNote =
    context.liveChanges.length > 0
      ? `

Already done live during the conversation (don't request them again):
${context.liveChanges.map((c) => `- ${c}`).join('\n')}`
      : '';
  const filedNote =
    context.liveFiledTopics.length > 0
      ? `

The user explicitly filed this conversation under these topics by voice ("A · B" = sub-topic B under A). Each one MUST be the topic_name (with topic_parent_name for a sub-topic, and topic_confidence 1.0) of the outline section(s) it was about -- the Overview section if it was about the conversation as a whole:
${context.liveFiledTopics.map((t) => `- ${t}`).join('\n')}`
      : '';
  const dateNote = context.recordedOn
    ? `This was recorded on ${context.recordedOn.date} (${context.recordedOn.weekday}) in the speaker's timezone -- resolve relative dates ("내일", "금요일까지", "next week") against that day.`
    : `The speaker's timezone isn't known, so relative dates ("내일", "금요일까지", "next week") can't be resolved reliably: set a task's due_date ONLY when they said an explicit calendar date ("9월 30일", "October 3rd"; assume the year ${new Date().getUTCFullYear()} unless they said otherwise), and leave it null otherwise.`;

  const system = `You read a raw voice-memo transcript from a personal journaling app and extract structure from it. This is a running journal of the speaker's day-to-day thoughts, said out loud like a diary -- most of it is casual and won't contain any task or idea worth filing anywhere, and that is completely normal and expected, not a failure of the recording.${conversationNote}${undoneNote}${liveNote}${filedNote}

${dateNote}

${languageInstruction}

There are TWO different summaries to produce, for two different places in the app:

"summary" is a short (1-2 sentence) recap, used in compact list views (a row on a calendar, a line on a home screen) where space is tight.

"outline" is the FULL breakdown, organized into sections with headings and bullet points -- this is the one people actually read to see what they talked about, so it must not throw content away. Cover everything substantive in the transcript, not just the headline point: named people/places/things mentioned, specific reasons or arguments given, numbers or dates, examples, open questions, decisions made or not yet made, plans, feelings expressed. Structure:
- Start with an "Overview" section: a handful of bullets giving the high-level gist.
- Follow with additional sections for each distinct topic, theme, or line of thought in the transcript, each with its own heading (2-6 words) and bullet points. Split into more sections rather than fewer when the transcript covers genuinely distinct things -- don't cram unrelated points under one heading just to keep the section count low.
- Choose section headings that fit what this recording actually IS, not a one-size-fits-all template. A sermon or talk naturally wants sections like "Key Points", "Application", or "Reflection Questions" (only include ones the content actually supports -- don't invent an "Application" section with nothing real in it). A meeting wants "Decisions" / "Action Items" / "Open Questions". A casual personal journal entry just wants free-form sections named after whatever the speaker actually talked about. Let the content decide -- never force a fixed set of headings onto content that doesn't call for them.
- Bullets are concise phrases or short sentences, not full paragraphs. Wrap the 2-4 most important words or the key claim of a bullet in **double asterisks** (e.g. "**Prayer** described as essential for spiritual growth.") the way the emphasis reads in a well-formatted outline -- don't bold entire bullets or bold nothing.
- If the recording is short, mundane, or has barely anything in it, this can be as small as one "Overview" section with one or two honest bullets (e.g. "Brief note testing the recording, no real content.") -- do not pad a thin transcript with invented sections, and do not comment on the recording itself (its length, repetition, audio quality) as if it were content.

"notable_quotes" pulls out 0-5 short lines worth quoting on their own, word-for-word from the transcript (never paraphrased or reconstructed) -- the kind of standout, memorable, or pull-quote-worthy sentence a sermon, talk, lecture, or meaningful conversation tends to have. Most casual day-to-day journal entries genuinely have none of these -- an empty array is the normal, expected result for most recordings, not a failure to find something.

Both "summary" and "outline" describe the CONTENT only -- never the speech act itself. Do not comment on repetition, filler, hesitation, pacing, tone, or recording quality, and never describe the speaker's behavior or mental state as an outside observer (e.g. never write "the speaker seems rushed" or "is repeating themselves").

The speaker may explicitly say things like "이건 [이름] 토픽에 넣어줘" or "put this under the X folder" while talking about something specific -- treat "topic", "폴더" (folder), and "카테고리" (category) as the same concept, and treat an explicit instruction like that as a highly confident assignment (topic_confidence near 1.0), not a guess, for the section covering whatever the speaker was talking about right around when they said it. If they also say something like "새 토픽 만들어서 X 아래에 넣어줘" (make a new topic and put it under X), that names a PARENT for a brand new sub-topic -- use topic_parent_name for X. An instruction like this applies only to the section(s) it's actually about; don't let one explicit instruction bleed into unrelated sections elsewhere in the same recording.

Topics are nested at most one level deep: a major category (e.g. "Business") can have sub-topics under it (e.g. "Business" -> "Liflux"). The user's current topics:
${formatTopicTree(topics)}

Separately, a TASK can also belong to a task list -- a flat, simple bucket like Google Tasks' own lists (e.g. "Shopping", "Work", "Errands"), NOT the same thing as its topic (a task's topic is what it's ABOUT; its list is which practical to-do bucket it belongs in -- the same task can have both, and they're often different, e.g. topic "Family" + list "Shopping" for "buy a birthday present"). The user's current task lists:
${lists.length > 0 ? lists.map((l) => `- ${l.name}`).join('\n') : '(none yet)'}
${
  existingTaskTitles.length > 0
    ? `\nTasks that ALREADY EXIST for this recording -- the user added them out loud while talking, so their spoken requests to add them are in the transcript. Do NOT output any of these in "tasks" again, even reworded:\n${existingTaskTitles.map((t) => `- ${t}`).join('\n')}\n`
    : ''
}
Respond with strict JSON matching this shape:
{
  "summary": string (1-2 sentences, short recap as described above, in the transcript's own language),
  "outline": [{
    "heading": string,
    "bullets": string[],
    "topic_name": string or null,
    "topic_parent_name": string or null (only if topic_name is/should be a sub-topic; must name a TOP-LEVEL topic),
    "topic_confidence": number between 0 and 1
  }] (full breakdown as described above, at least one section -- see below for topic_name),
  "notable_quotes": string[] (0-5 verbatim standout lines as described above; empty array is the normal case),
  "tasks": [{
    "title": string,
    "priority": "low" | "normal" | "high",
    "topic_name": string or null,
    "topic_parent_name": string or null (only if topic_name is/should be a sub-topic; must name a TOP-LEVEL topic),
    "topic_confidence": number between 0 and 1,
    "list_name": string or null (which task list, as described above -- separate from topic_name),
    "list_confidence": number between 0 and 1,
    "due_date": "YYYY-MM-DD" or null (ONLY if the speaker stated a deadline or day for it, e.g. "내일까지", "by Friday" -- resolved as described above; null otherwise)
  }],
  "memories": [{
    "content": string,
    "category": string or null,
    "topic_name": string or null,
    "topic_parent_name": string or null,
    "topic_confidence": number between 0 and 1
  }],
  "requested_topics": [{ "name": string, "parent_name": string or null }]
}

Each outline section files under its OWN topic -- a recording can genuinely be about more than one thing (e.g. a work errand, then separately a personal note about a friend), so there is no single topic for the whole recording anymore, only one per section. For each section, ALWAYS fill in topic_name (unless the transcript is genuinely empty or pure test noise). Strongly prefer an existing topic from the list above when one fits that section's content. Otherwise propose a short, general, reusable name in the transcript's language (e.g. "신앙", "가족", "Business", "Health"), not a description of this one section. Match the user's existing naming style. Use topic_parent_name only when the section clearly belongs under an existing sub-topic's parent.

For a task's list_name, only fill it in when a list is actually a good fit ("리스트" specifically -- distinct from "토픽"/"폴더"/"카테고리" above, which mean topic). Unlike topic_name, it's fine to leave list_name null for an ordinary task with no obvious list -- not every task needs one. The same explicit-instruction rule applies: if the speaker says something like "이건 쇼핑 리스트에 넣어줘" or "put this on my Work list", treat that as a highly confident list_confidence near 1.0 for that specific task.

"requested_topics" is ONLY for explicit instructions to create a topic/folder/category -- e.g. "교단이라는 토픽을 만들어줘", "make a new topic called Family", "add a Health folder" -- including ones with nothing to file under them yet. Use the exact name the speaker gave. Do not put topics here just because they are mentioned or would be a sensible place to file things; that is what topic_name on outline sections/tasks/memories is for. Empty array when there is no such instruction. There is no equivalent for lists -- a bare "make a list called X" with nothing to put in it isn't worth creating; a list is only created once a real task actually needs it.

If nothing qualifies for tasks/memories, return an empty array for it. If you can't confidently tell which topic a section, task, or memory belongs to, still give your best guess in topic_name but with topic_confidence below 0.6 -- the app asks the user to confirm anything under that threshold rather than filing it automatically. If a topic doesn't exist yet but clearly should (including one the speaker explicitly asked to create), propose it as topic_name anyway -- new topics get created automatically once confidence is high enough. Same threshold for list_confidence.

${detectedLanguage ? `Reminder: write "title"/"content"/"summary"/"heading"/bullet text in ${detectedLanguage}, matching the transcript's own detected language, not any other language.` : 'The transcript may be in Korean, English, or a mix -- write "title"/"content"/"summary"/"heading"/bullet text in the same language as the transcript.'} Never invent tasks, ideas, or outline content that aren't actually in the transcript.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: transcript },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`AI analysis failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI analysis returned no content.');

  const parsed = JSON.parse(content);
  const outline: OutlineSection[] = Array.isArray(parsed.outline)
    ? parsed.outline
        .map(sanitizeOutlineSection)
        .filter((s: OutlineSection | null): s is OutlineSection => !!s && !!s.heading && s.bullets.length > 0)
    : [];
  const notableQuotes: string[] = Array.isArray(parsed.notable_quotes)
    ? parsed.notable_quotes.filter((q: unknown): q is string => typeof q === 'string' && q.trim().length > 0).slice(0, 5)
    : [];

  return {
    extraction: {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      outline,
      notable_quotes: notableQuotes,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(sanitizeTask).filter(Boolean) : [],
      memories: Array.isArray(parsed.memories) ? parsed.memories.map(sanitizeMemory).filter(Boolean) : [],
      requested_topics: Array.isArray(parsed.requested_topics)
        ? parsed.requested_topics.filter(
            (t: unknown): t is RequestedTopic =>
              !!t && typeof t === 'object' && typeof (t as RequestedTopic).name === 'string'
          )
        : [],
    },
    inputTokens: typeof data.usage?.prompt_tokens === 'number' ? data.usage.prompt_tokens : 0,
    outputTokens: typeof data.usage?.completion_tokens === 'number' ? data.usage.completion_tokens : 0,
  };
}

async function discardSessionAudio(db: SupabaseClient, sessionId: string): Promise<void> {
  try {
    const { data: attachments } = await db
      .from('attachments')
      .select('id, storage_path')
      .eq('session_id', sessionId)
      .eq('type', 'audio');
    if (!attachments || attachments.length === 0) return;
    const { error: removeError } = await db.storage
      .from('recordings')
      .remove(attachments.map((a) => a.storage_path));
    if (removeError) throw removeError;
    await db
      .from('attachments')
      .delete()
      .in(
        'id',
        attachments.map((a) => a.id)
      );
  } catch (e) {
    // Best-effort: the session is already done; leftover files just cost storage.
    console.warn('could not discard session audio', sessionId, e);
  }
}

// GPT output is untrusted: a `priority: "medium"` or a missing title used
// to violate a check/not-null constraint and take the whole insert down.
const PRIORITIES = new Set(['low', 'normal', 'high']);
function clampConfidence(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined;
}
function optionalString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function sanitizeTask(raw: unknown): ExtractedTask | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const title = optionalString(t.title);
  if (!title) return null;
  return {
    title,
    priority: PRIORITIES.has(t.priority as string) ? (t.priority as ExtractedTask['priority']) : 'normal',
    topic_name: optionalString(t.topic_name),
    topic_parent_name: optionalString(t.topic_parent_name),
    topic_confidence: clampConfidence(t.topic_confidence),
    list_name: optionalString(t.list_name),
    list_confidence: clampConfidence(t.list_confidence),
    due_date: validYmd(t.due_date),
  };
}
function validYmd(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? v : null;
}
function sanitizeOutlineSection(raw: unknown): OutlineSection | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  return {
    heading: typeof s.heading === 'string' ? s.heading : '',
    bullets: Array.isArray(s.bullets) ? s.bullets.filter((b: unknown): b is string => typeof b === 'string') : [],
    topic_name: optionalString(s.topic_name),
    topic_parent_name: optionalString(s.topic_parent_name),
    topic_confidence: clampConfidence(s.topic_confidence),
  };
}
function sanitizeMemory(raw: unknown): ExtractedMemory | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const content = optionalString(m.content);
  if (!content) return null;
  return {
    content,
    category: optionalString(m.category),
    topic_name: optionalString(m.topic_name),
    topic_parent_name: optionalString(m.topic_parent_name),
    topic_confidence: clampConfidence(m.topic_confidence),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
