// One turn of the live, continuous conversation in Talk's "Conversation"
// mode: transcribes the audio segment the client just uploaded, replies
// using the session's full message history for context, and synthesizes
// the reply as speech. Also decides whether the user just told it, in
// plain speech, to end and save the conversation right now (`shouldEnd`)
// -- the client auto-relistens after every reply unless that's set.
//
// Invoked by the app via
//   supabase.functions.invoke('converse', { body: { sessionId, storagePath } })
// once per turn (see src/hooks/useConversationSession.ts). The transcript
// left behind in `messages` is reused as the session's raw_transcript when
// `process-session` runs at the end of the conversation, instead of
// re-transcribing the same audio a second time (see process-session/index.ts).
//
// OPENAI_API_KEY / SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
// are the same Edge Function secrets process-session already relies on.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Spoken when Whisper heard nothing usable -- no point spending a GPT call
// (or polluting the conversation history) on an empty turn.
const NOTHING_HEARD_REPLY = '잘 안 들렸어요. 다시 한 번 말씀해 주시겠어요?';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (!OPENAI_API_KEY) {
    return json({ error: 'OPENAI_API_KEY is not configured on this project.' }, 500);
  }

  let sessionId: string | undefined;
  let storagePath: string | undefined;
  try {
    ({ sessionId, storagePath } = await req.json());
  } catch {
    // handled by the checks below
  }
  if (!sessionId || !storagePath) {
    return json({ error: 'sessionId and storagePath are required.' }, 400);
  }

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

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: session, error: sessionError } = await db
    .from('sessions')
    .select('id, user_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionError) return json({ error: sessionError.message }, 500);
  if (!session || session.user_id !== user.id) {
    return json({ error: 'Session not found.' }, 404);
  }

  try {
    const { data: file, error: downloadError } = await db.storage.from('recordings').download(storagePath);
    if (downloadError) throw downloadError;
    const userText = (await transcribeAudio(file, storagePath)).trim();

    let assistantText: string;
    let shouldEnd = false;
    if (!userText) {
      assistantText = NOTHING_HEARD_REPLY;
    } else {
      // The user's own words are saved before asking GPT for anything --
      // if the reply generation below fails or times out, this turn's
      // speech is still on record rather than lost with the request.
      await insertMessage(db, sessionId, user.id, 'user', userText);

      const { data: history, error: historyError } = await db
        .from('messages')
        .select('role, content')
        .eq('session_id', sessionId)
        .order('position', { ascending: true });
      if (historyError) throw historyError;

      const reply = await generateReply(history ?? []);
      assistantText = reply.reply;
      shouldEnd = reply.end;
      await insertMessage(db, sessionId, user.id, 'assistant', assistantText);
    }

    const audioBase64 = await synthesizeSpeech(assistantText);

    return json({ userText, assistantText, shouldEnd, audioBase64 });
  } catch (e) {
    console.error('converse failed:', e);
    return json({ error: errorMessage(e) }, 500);
  }
});

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return 'Unknown error while talking to the AI.';
}

async function insertMessage(
  db: SupabaseClient,
  sessionId: string,
  userId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  const { error } = await db.from('messages').insert({ session_id: sessionId, user_id: userId, role, content });
  if (error) throw error;
}

async function transcribeAudio(file: Blob, storagePath: string): Promise<string> {
  const fileName = storagePath.split('/').pop() ?? 'segment.m4a';
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

const SYSTEM_PROMPT = `You are the voice on the other end of a live, continuous conversation inside Mind Record, a voice-journaling app. The conversation auto-listens again after every reply you give -- the user never has to tap anything between turns, it just flows. The user is thinking out loud, like talking to a supportive friend while journaling -- your job is to listen and respond BRIEFLY (1-2 short, natural spoken sentences) so the conversation keeps flowing without you taking over it. This is read aloud by text-to-speech, so never use markdown, bullet points, or a written-essay register -- write the way a person actually talks.

Reply in the SAME language the user is speaking (Korean if they're speaking Korean, English if English).

Most turns: just react naturally and briefly -- a short acknowledgment, a light follow-up question, or simply encouraging them to keep going. Don't summarize or repeat back everything they just said.

If they ask you to recap what they've said so far (e.g. "요약해줘", "summarize", "지금까지 뭐라고 했지"), give a short spoken recap (2-4 sentences) of the conversation so far, based on the message history you can see.

If they mention wanting something filed under a specific topic/folder (e.g. "이건 Business 토픽에 넣어줘"), just acknowledge it naturally -- that instruction is picked up automatically when the conversation is organized afterwards, you don't need to do anything else about it.

Ending the conversation: set "end" to true ONLY when the user is clearly telling you, right now, to stop and save -- e.g. "저장하고 끝내", "그만할게", "끝낼게", "여기까지 할게", "save and end", "that's all for now". Give a brief, warm closing line as "reply" when you do (e.g. "네, 여기까지 저장할게요."). Do NOT set "end" to true just because ending was mentioned as a topic of what they're thinking about (e.g. "오늘 하루를 어떻게 마무리할지 고민했다" is content, not a command) -- only an actual instruction to you, right now, counts. When in doubt, treat it as content and keep "end" false; the user can always tap Cancel/End on screen themselves.

Never invent facts about the user. Never break character to explain that you're an AI language model.

Respond with strict JSON: { "reply": string, "end": boolean }`;

async function generateReply(
  history: { role: string; content: string }[]
): Promise<{ reply: string; end: boolean }> {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content })),
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'gpt-4o-mini', response_format: { type: 'json_object' }, messages }),
  });
  if (!res.ok) {
    throw new Error(`AI reply failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('AI reply returned no content.');
  }
  const parsed = JSON.parse(content);
  const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
  if (!reply) throw new Error('AI reply returned no content.');
  return { reply, end: parsed.end === true };
}

async function synthesizeSpeech(text: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'tts-1', voice: 'alloy', input: text, response_format: 'mp3' }),
  });
  if (!res.ok) {
    throw new Error(`Speech synthesis failed (${res.status}): ${await res.text()}`);
  }
  const buffer = await res.arrayBuffer();
  return arrayBufferToBase64(buffer);
}

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
