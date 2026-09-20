// Synthesizes a fixed sample line in the requested voice, for Account's
// voice picker to preview before the user commits to it (see
// supabase/functions/converse for where the chosen voice is actually
// used in the live conversation).
//
// Invoked via
//   supabase.functions.invoke('preview-voice', { body: { voice, locale } })
//
// OPENAI_API_KEY is the same secret every other Edge Function here uses.

import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

import { recordUsage } from '../_shared/usage.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Kept in sync with the `profiles_ai_voice_check` constraint
// (supabase/migrations/20260918000001_ai_personalization.sql) and
// converse/index.ts's own ALLOWED_VOICES.
const ALLOWED_VOICES = new Set(['alloy', 'echo', 'onyx', 'nova', 'shimmer']);

const SAMPLES: Record<string, string> = {
  ko: '안녕하세요. 편하게 말씀해 주세요. 제가 기록하고 정리해 드릴게요.',
  en: "Hi there. Just talk naturally -- I'll take care of recording and organizing it.",
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (!OPENAI_API_KEY) {
    return json({ error: 'OPENAI_API_KEY is not configured on this project.' }, 500);
  }

  // Same check as converse/process-session: every TTS call costs money, so
  // don't lean on gateway JWT verification alone.
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

  let voice: string | undefined;
  let locale: string | undefined;
  try {
    ({ voice, locale } = await req.json());
  } catch {
    // handled below
  }
  if (!voice || !ALLOWED_VOICES.has(voice)) {
    return json({ error: `voice must be one of: ${[...ALLOWED_VOICES].join(', ')}` }, 400);
  }

  const text = SAMPLES[locale ?? 'ko'] ?? SAMPLES.ko;

  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'tts-1', voice, input: text, response_format: 'mp3' }),
    });
    if (!res.ok) {
      throw new Error(`Speech synthesis failed (${res.status}): ${await res.text()}`);
    }
    const buffer = await res.arrayBuffer();
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await recordUsage(db, {
      userId: user.id,
      eventType: 'tts_synthesize',
      source: 'preview_voice',
      ttsCharacters: text.length,
    });
    return json({ audioBase64: arrayBufferToBase64(buffer) });
  } catch (e) {
    console.error('preview-voice failed:', e);
    return json({ error: e instanceof Error ? e.message : 'Could not synthesize a preview.' }, 500);
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
