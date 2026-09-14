// Runs after a recording ends: downloads the session's audio segments,
// transcribes them with OpenAI Whisper, then asks GPT to extract tasks,
// ideas, a summary, and topic tags from the transcript. Writes everything
// back to `sessions` / `tasks` / `memories` / `session_topics`.
//
// Invoked by the app via
//   supabase.functions.invoke('process-session', { body: { sessionId } })
// right after src/hooks/useCaptureSession.ts ends a capture session (see
// src/services/processing.ts). The OpenAI API key never touches the mobile
// app — it only lives here, as an Edge Function secret:
//   supabase secrets set OPENAI_API_KEY=sk-...
//
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are provided
// automatically by the Edge Functions runtime; only OPENAI_API_KEY needs to
// be set by hand.

import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ExtractedTask = { title: string; priority?: 'low' | 'normal' | 'high' };
type ExtractedMemory = { content: string; category?: string };
type ExtractedTopic = { name: string; confidence?: number };
type Extraction = {
  summary: string;
  tasks: ExtractedTask[];
  memories: ExtractedMemory[];
  topics: ExtractedTopic[];
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

  try {
    await db.from('sessions').update({ processing_status: 'transcribing' }).eq('id', sessionId);

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
      const text = await transcribeAudio(file, attachment.file_name);
      if (text.trim()) transcriptParts.push(text.trim());
    }
    const transcript = transcriptParts.join('\n\n');

    await db
      .from('sessions')
      .update({ raw_transcript: transcript, processing_status: 'analyzing' })
      .eq('id', sessionId);

    const { data: topics, error: topicsError } = await db
      .from('topics')
      .select('id, name')
      .eq('user_id', user.id);
    if (topicsError) throw topicsError;

    const extraction = await analyzeTranscript(
      transcript,
      (topics ?? []).map((t) => t.name)
    );

    if (extraction.tasks.length > 0) {
      await db.from('tasks').insert(
        extraction.tasks.map((t) => ({
          user_id: user.id,
          source_session_id: sessionId,
          title: t.title,
          priority: t.priority ?? 'normal',
        }))
      );
    }

    if (extraction.memories.length > 0) {
      await db.from('memories').insert(
        extraction.memories.map((m) => ({
          user_id: user.id,
          source_session_id: sessionId,
          content: m.content,
          category: m.category ?? null,
        }))
      );
    }

    const topicByName = new Map((topics ?? []).map((t) => [t.name, t.id]));
    const topicLinks = extraction.topics
      .map((t) => {
        const topicId = topicByName.get(t.name);
        return topicId
          ? { session_id: sessionId, topic_id: topicId, confidence: t.confidence ?? null }
          : null;
      })
      .filter((row): row is { session_id: string; topic_id: string; confidence: number | null } => row !== null);
    if (topicLinks.length > 0) {
      await db.from('session_topics').insert(topicLinks);
    }

    await db
      .from('sessions')
      .update({
        summary: extraction.summary,
        title: session.title ?? extraction.summary.slice(0, 80),
        processing_status: 'done',
      })
      .eq('id', sessionId);

    return json({
      status: 'done',
      summary: extraction.summary,
      taskCount: extraction.tasks.length,
      memoryCount: extraction.memories.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error while processing this session.';
    await db
      .from('sessions')
      .update({ processing_status: 'error', processing_error: message })
      .eq('id', sessionId);
    return json({ error: message }, 500);
  }
});

async function transcribeAudio(file: Blob, fileName: string): Promise<string> {
  const form = new FormData();
  form.append('file', file, fileName);
  form.append('model', 'whisper-1');

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

async function analyzeTranscript(transcript: string, topicNames: string[]): Promise<Extraction> {
  if (!transcript.trim()) {
    return { summary: 'No speech was detected in this recording.', tasks: [], memories: [], topics: [] };
  }

  const system = `You read a raw voice-memo transcript from a personal journaling app and extract structure from it. Respond with strict JSON matching this shape:
{
  "summary": string (1-2 sentences),
  "tasks": [{ "title": string, "priority": "low" | "normal" | "high" }],
  "memories": [{ "content": string, "category": string }] (ideas, decisions, or things worth remembering that are not actionable tasks),
  "topics": [{ "name": string, "confidence": number between 0 and 1 }]
}
Only use topic names from this exact list (choose "Other" if nothing fits): ${topicNames.join(', ')}.
The transcript may be in Korean, English, or a mix -- write "title"/"content"/"summary" in the same language as the transcript. If nothing qualifies for a field, return an empty array for it. Never invent tasks or ideas that aren't actually in the transcript.`;

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
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    memories: Array.isArray(parsed.memories) ? parsed.memories : [],
    topics: Array.isArray(parsed.topics) ? parsed.topics : [],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
