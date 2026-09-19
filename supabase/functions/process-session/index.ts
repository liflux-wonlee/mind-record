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

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Below this, an item's topic_name is kept only as `topic_suggestion` (not
// auto-assigned) -- the app asks the user to confirm it on Summary instead
// of silently filing something AI wasn't sure about.
const TOPIC_CONFIDENCE_THRESHOLD = 0.6;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type TopicRow = { id: string; name: string; parent_topic_id: string | null };

type ExtractedTask = {
  title: string;
  priority?: 'low' | 'normal' | 'high';
  topic_name?: string | null;
  topic_parent_name?: string | null;
  topic_confidence?: number;
};
type ExtractedMemory = {
  content: string;
  category?: string | null;
  topic_name?: string | null;
  topic_parent_name?: string | null;
  topic_confidence?: number;
};
type OutlineSection = { heading: string; bullets: string[] };
type Extraction = {
  summary: string;
  outline: OutlineSection[];
  tasks: ExtractedTask[];
  memories: ExtractedMemory[];
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (!OPENAI_API_KEY) {
    return json({ error: 'OPENAI_API_KEY is not configured on this project.' }, 500);
  }

  let sessionId: string | undefined;
  try {
    ({ sessionId } = await req.json());
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
  if (sessionError) return json({ error: sessionError.message }, 500);
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

  try {
    await db.from('sessions').update({ processing_status: 'transcribing' }).eq('id', sessionId);

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

    let transcript: string;
    if (existingMessages && existingMessages.length > 0) {
      transcript = existingMessages
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .join('\n\n');
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

      const { data: profile } = await db.from('profiles').select('locale').eq('id', user.id).maybeSingle();
      const language = whisperLanguage(profile?.locale);

      const transcriptParts: string[] = [];
      for (const attachment of attachments) {
        const { data: file, error: downloadError } = await db.storage
          .from('recordings')
          .download(attachment.storage_path);
        if (downloadError) throw downloadError;
        const text = await transcribeAudio(file, attachment.file_name, language);
        if (text.trim()) transcriptParts.push(text.trim());
      }
      transcript = transcriptParts.join('\n\n');
    }

    await db
      .from('sessions')
      .update({ raw_transcript: transcript, processing_status: 'analyzing' })
      .eq('id', sessionId);

    const { data: existingTopics, error: topicsError } = await db
      .from('topics')
      .select('id, name, parent_topic_id')
      .eq('user_id', user.id);
    if (topicsError) throw topicsError;
    const topics: TopicRow[] = existingTopics ?? [];

    const extraction = await analyzeTranscript(transcript, topics);

    // Resolve each item's topic (find-or-create) before inserting, so the
    // insert already carries the right topic_id -- or, below the
    // confidence threshold, no topic_id and a topic_suggestion instead.
    const resolvedTasks = [];
    for (const t of extraction.tasks) {
      const resolved = await resolveTopic(db, user.id, topics, t);
      resolvedTasks.push({
        user_id: user.id,
        source_session_id: sessionId,
        title: t.title,
        priority: t.priority ?? 'normal',
        topic_id: resolved.topicId,
        topic_suggestion: resolved.suggestion,
      });
    }

    const resolvedMemories = [];
    for (const m of extraction.memories) {
      const resolved = await resolveTopic(db, user.id, topics, m);
      resolvedMemories.push({
        user_id: user.id,
        source_session_id: sessionId,
        content: m.content,
        category: m.category ?? null,
        topic_id: resolved.topicId,
        topic_suggestion: resolved.suggestion,
      });
    }

    if (resolvedTasks.length > 0) {
      await db.from('tasks').insert(resolvedTasks);
    }
    if (resolvedMemories.length > 0) {
      await db.from('memories').insert(resolvedMemories);
    }

    // session_topics is a rollup of every topic actually assigned above --
    // not a separate thing the model produces, so it can never disagree
    // with what the tasks/memories themselves say.
    const confidenceByTopic = new Map<string, number>();
    const allResolved = [...resolvedTasks, ...resolvedMemories];
    const allExtracted = [...extraction.tasks, ...extraction.memories];
    allResolved.forEach((row, i) => {
      if (!row.topic_id) return;
      const confidence = allExtracted[i]?.topic_confidence ?? null;
      const prev = confidenceByTopic.get(row.topic_id) ?? 0;
      if (confidence !== null && confidence > prev) confidenceByTopic.set(row.topic_id, confidence);
    });
    if (confidenceByTopic.size > 0) {
      await db.from('session_topics').upsert(
        Array.from(confidenceByTopic.entries()).map(([topic_id, confidence]) => ({
          session_id: sessionId,
          topic_id,
          confidence,
        })),
        { onConflict: 'session_id,topic_id' }
      );
    }

    await db
      .from('sessions')
      .update({
        summary: extraction.summary,
        outline: extraction.outline,
        title: session.title ?? extraction.summary.slice(0, 80),
        processing_status: 'done',
      })
      .eq('id', sessionId);

    return json({
      status: 'done',
      summary: extraction.summary,
      taskCount: resolvedTasks.length,
      memoryCount: resolvedMemories.length,
    });
  } catch (e) {
    console.error('process-session failed:', e);
    const message = errorMessage(e);
    await db
      .from('sessions')
      .update({ processing_status: 'error', processing_error: message })
      .eq('id', sessionId);
    return json({ error: message }, 500);
  }
});

/**
 * `e instanceof Error` alone misses most Supabase client errors --
 * PostgrestError (from .from(...).insert/update/select) is a plain object
 * implementing an interface, not an actual Error subclass, so it was
 * silently falling through to the generic "Unknown error" message here
 * and every real failure reason was being discarded before it ever
 * reached `sessions.processing_error` or the client.
 */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return 'Unknown error while processing this session.';
}

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

  let parentId: string | null = null;
  const parentName = item.topic_parent_name?.trim();
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
  return { topicId: topic.id, suggestion: null };
}

// profiles.locale -> Whisper's ISO-639-1 `language` hint (skips
// auto-detection, which mis-fires most on short clips).
function whisperLanguage(locale: string | null | undefined): string | undefined {
  if (locale === 'ko' || locale === 'en') return locale;
  return undefined;
}

async function transcribeAudio(file: Blob, fileName: string, language?: string): Promise<string> {
  const form = new FormData();
  form.append('file', file, fileName);
  form.append('model', 'whisper-1');
  if (language) form.append('language', language);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Whisper transcription failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.text ?? '';
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

async function analyzeTranscript(transcript: string, topics: TopicRow[]): Promise<Extraction> {
  if (!transcript.trim()) {
    return { summary: 'No speech was detected in this recording.', outline: [], tasks: [], memories: [] };
  }

  const system = `You read a raw voice-memo transcript from a personal journaling app and extract structure from it. This is a running journal of the speaker's day-to-day thoughts, said out loud like a diary -- most of it is casual and won't contain any task or idea worth filing anywhere, and that is completely normal and expected, not a failure of the recording.

CRITICAL: Detect the transcript's own language and write EVERY string you output -- "summary" included, not just "outline" -- in that same language. A Korean transcript gets a Korean "summary", Korean "outline" headings/bullets, Korean "title"/"content" for tasks and memories. Never default to English or translate; match the transcript exactly.

There are TWO different summaries to produce, for two different places in the app:

"summary" is a short (1-2 sentence) recap, used in compact list views (a row on a calendar, a line on a home screen) where space is tight.

"outline" is the FULL breakdown, organized into sections with headings and bullet points -- this is the one people actually read to see what they talked about, so it must not throw content away. Cover everything substantive in the transcript, not just the headline point: named people/places/things mentioned, specific reasons or arguments given, numbers or dates, examples, open questions, decisions made or not yet made, plans, feelings expressed. Structure:
- Start with an "Overview" section: a handful of bullets giving the high-level gist.
- Follow with additional sections for each distinct topic, theme, or line of thought in the transcript, each with its own heading (2-6 words) and bullet points. Split into more sections rather than fewer when the transcript covers genuinely distinct things -- don't cram unrelated points under one heading just to keep the section count low.
- Bullets are concise phrases or short sentences, not full paragraphs. Wrap the 2-4 most important words or the key claim of a bullet in **double asterisks** (e.g. "**Prayer** described as essential for spiritual growth.") the way the emphasis reads in a well-formatted outline -- don't bold entire bullets or bold nothing.
- If the recording is short, mundane, or has barely anything in it, this can be as small as one "Overview" section with one or two honest bullets (e.g. "Brief note testing the recording, no real content.") -- do not pad a thin transcript with invented sections, and do not comment on the recording itself (its length, repetition, audio quality) as if it were content.

Both "summary" and "outline" describe the CONTENT only -- never the speech act itself. Do not comment on repetition, filler, hesitation, pacing, tone, or recording quality, and never describe the speaker's behavior or mental state as an outside observer (e.g. never write "the speaker seems rushed" or "is repeating themselves").

The speaker may explicitly say things like "이건 [이름] 토픽에 넣어줘" or "put this under the X folder" -- treat "topic", "폴더" (folder), and "카테고리" (category) as the same concept, and treat an explicit instruction like that as a highly confident assignment (topic_confidence near 1.0), not a guess.

Topics are nested at most one level deep: a major category (e.g. "Business") can have sub-topics under it (e.g. "Business" -> "Liflux"). The user's current topics:
${formatTopicTree(topics)}

Respond with strict JSON matching this shape:
{
  "summary": string (1-2 sentences, short recap as described above, in the transcript's own language),
  "outline": [{ "heading": string, "bullets": string[] }] (full breakdown as described above, at least one section),
  "tasks": [{
    "title": string,
    "priority": "low" | "normal" | "high",
    "topic_name": string or null,
    "topic_parent_name": string or null (only if topic_name is/should be a sub-topic; must name a TOP-LEVEL topic),
    "topic_confidence": number between 0 and 1
  }],
  "memories": [{
    "content": string,
    "category": string or null,
    "topic_name": string or null,
    "topic_parent_name": string or null,
    "topic_confidence": number between 0 and 1
  }]
}

If nothing qualifies for tasks/memories, return an empty array for it. If you can't confidently tell which topic something belongs to, still give your best guess in topic_name but with topic_confidence below 0.6 -- the app asks the user to confirm anything under that threshold rather than filing it automatically. If a topic doesn't exist yet but clearly should (including one the speaker explicitly asked to create), propose it as topic_name anyway -- new topics get created automatically once confidence is high enough.

The transcript may be in Korean, English, or a mix -- write "title"/"content"/"summary"/"heading"/bullet text in the same language as the transcript. Never invent tasks, ideas, or outline content that aren't actually in the transcript.`;

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
        .filter((s: unknown): s is { heading: unknown; bullets: unknown } => !!s && typeof s === 'object')
        .map((s: { heading: unknown; bullets: unknown }) => ({
          heading: typeof s.heading === 'string' ? s.heading : '',
          bullets: Array.isArray(s.bullets) ? s.bullets.filter((b: unknown) => typeof b === 'string') : [],
        }))
        .filter((s: OutlineSection) => s.heading && s.bullets.length > 0)
    : [];

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    outline,
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    memories: Array.isArray(parsed.memories) ? parsed.memories : [],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
