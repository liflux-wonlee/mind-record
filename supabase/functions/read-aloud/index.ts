// "Read aloud" on a record's Summary (app/summary.tsx): speaks the title,
// summary, outline sections, tasks and ideas in the user's AI voice, so it
// can be heard without looking at the screen (e.g. while driving).
//
//   supabase.functions.invoke('read-aloud', { body: { sessionId, part } })
//
// The text is built here from the database (never taken from the client, so
// this can't be used as a general text-to-speech endpoint) and read word for
// word -- see _shared/readAloudText.ts. Long records are split into parts;
// the app asks for part 0, plays it, and fetches the next part while it
// plays. Each call returns { part, partCount, text, audioBase64 }.
//
// Reads go through the caller's own client, so row-level security limits
// them to the caller's own records.

import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

import { errorMessage } from '../_shared/errorMessage.ts';
import { readAloudParts } from '../_shared/readAloudText.ts';
import { scheduleBackground } from '../_shared/perf.ts';
import { recordUsage } from '../_shared/usage.ts';
import { ALLOWED_VOICES, ttsModelFor } from '../_shared/voices.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_VOICE = 'alloy';
const TTS_TIMEOUT_MS = 30_000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY is not configured on this project.' }, 500);

  let sessionId: unknown;
  let part: unknown;
  try {
    ({ sessionId, part } = await req.json());
  } catch {
    // validated below
  }
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return json({ error: 'sessionId is required.' }, 400);
  }
  const partIndex = part === undefined ? 0 : part;
  if (typeof partIndex !== 'number' || !Number.isInteger(partIndex) || partIndex < 0) {
    return json({ error: 'part must be a non-negative integer.' }, 400);
  }

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const {
    data: { user },
    error: authError,
  } = await callerClient.auth.getUser();
  if (authError || !user) return json({ error: 'Not authenticated.' }, 401);

  const background: Promise<unknown>[] = [];
  try {
    const [sessionRes, tasksRes, memoriesRes, profileRes] = await Promise.all([
      callerClient
        .from('sessions')
        .select('id, title, mode, summary, outline, processing_status')
        .eq('id', sessionId)
        .maybeSingle(),
      callerClient
        .from('tasks')
        .select('title')
        .eq('source_session_id', sessionId)
        .order('created_at', { ascending: true }),
      callerClient
        .from('memories')
        .select('content')
        .eq('source_session_id', sessionId)
        .order('created_at', { ascending: true }),
      callerClient.from('profiles').select('ai_voice').eq('id', user.id).maybeSingle(),
    ]);
    if (sessionRes.error) throw sessionRes.error;
    if (tasksRes.error) throw tasksRes.error;
    if (memoriesRes.error) throw memoriesRes.error;
    if (profileRes.error) throw profileRes.error;
    const session = sessionRes.data;
    if (!session) return json({ error: 'This record no longer exists.' }, 404);
    if (session.processing_status !== 'done') {
      return json({ error: 'This record is still being processed.' }, 409);
    }

    const parts = readAloudParts({
      title: session.title,
      mode: session.mode,
      summary: session.summary,
      outline: Array.isArray(session.outline) ? session.outline : null,
      tasks: (tasksRes.data ?? []).map((t) => t.title as string),
      ideas: (memoriesRes.data ?? []).map((m) => m.content as string),
    });
    if (partIndex >= parts.length) {
      return json({ error: 'That part does not exist.', partCount: parts.length }, 400);
    }
    const text = parts[partIndex];
    const voice =
      profileRes.data?.ai_voice && ALLOWED_VOICES.has(profileRes.data.ai_voice)
        ? profileRes.data.ai_voice
        : DEFAULT_VOICE;

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ttsModelFor(voice), voice, input: text, response_format: 'mp3' }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('read-aloud TTS failed:', res.status);
      throw new Error('Speech synthesis failed. Please try again.');
    }
    const audioBase64 = arrayBufferToBase64(await res.arrayBuffer());

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    background.push(
      recordUsage(db, {
        userId: user.id,
        eventType: 'tts_synthesize',
        source: 'read_aloud',
        sessionId,
        ttsCharacters: text.length,
        model: ttsModelFor(voice),
      })
    );
    scheduleBackground(background);
    return json({ part: partIndex, partCount: parts.length, text, audioBase64, audioMime: 'audio/mpeg' });
  } catch (e) {
    // Code and message only -- never the record's content.
    const err = e as { code?: unknown; message?: unknown } | null;
    console.error('read-aloud failed:', err?.code ?? '', typeof err?.message === 'string' ? err.message.slice(0, 300) : '');
    scheduleBackground(background);
    return json({ error: errorMessage(e, "Couldn't read this record aloud. Please try again.") }, 500);
  }
});

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
