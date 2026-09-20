// One turn of the live, continuous conversation in Talk's "Conversation"
// mode: transcribes the audio segment the client just uploaded, replies
// using the session's full message history for context, and synthesizes
// the reply as speech -- in the user's chosen ai_name/user_honorific/
// ai_voice from `profiles` (see supabase/migrations/
// 20260918000001_ai_personalization.sql and Account's voice picker).
// Also decides whether the user just told it, in plain speech, to end and
// save the conversation right now (`shouldEnd`) -- the client
// auto-relistens after every reply unless that's set.
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

import { errorMessage } from '../_shared/errorMessage.ts';
import { recordUsage } from '../_shared/usage.ts';

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
const NOTHING_HEARD_REPLY: Record<string, string> = {
  ko: '잘 안 들렸어요. 다시 한 번 말씀해 주시겠어요?',
  en: "I didn't quite catch that. Could you say it again?",
};

// Kept in sync with the `profiles_ai_voice_check` constraint
// (supabase/migrations/20260918000001_ai_personalization.sql) and
// preview-voice/index.ts's own ALLOWED_VOICES.
const ALLOWED_VOICES = new Set(['alloy', 'echo', 'onyx', 'nova', 'shimmer']);
const DEFAULT_VOICE = 'alloy';

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
  if (sessionError) return json({ error: errorMessage(sessionError, 'Could not load this session.') }, 500);
  if (!session || session.user_id !== user.id) {
    return json({ error: 'Session not found.' }, 404);
  }
  // The audio is downloaded with the service role below (bypassing Storage
  // RLS), so the path itself must be pinned to this user's own session.
  if (!storagePath.startsWith(`${user.id}/${sessionId}/`)) {
    return json({ error: 'Recording not found.' }, 404);
  }

  try {
    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('ai_name, user_honorific, ai_voice, locale')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    const aiName = profile?.ai_name?.trim() || null;
    const userHonorific = profile?.user_honorific?.trim() || null;
    const voice = profile?.ai_voice && ALLOWED_VOICES.has(profile.ai_voice) ? profile.ai_voice : DEFAULT_VOICE;

    const { data: file, error: downloadError } = await db.storage.from('recordings').download(storagePath);
    if (downloadError) throw downloadError;
    const transcribed = await transcribeAudio(file, storagePath);
    const userText = transcribed.text.trim();
    if (transcribed.durationSeconds > 0 || transcribed.bytes > 0) {
      // No dedupe key -- a genuine retry of this turn only ever happens
      // after a network failure that never reached this function at all
      // (see the client's withOneRetry), so there's no risk of the SAME
      // completed turn being recorded twice here.
      await recordUsage(db, {
        userId: user.id,
        eventType: 'transcribe',
        source: 'converse',
        sessionId,
        audioSeconds: transcribed.durationSeconds,
        audioBytes: transcribed.bytes,
      });
    }

    let assistantText: string;
    let shouldEnd = false;
    if (!userText) {
      // Nothing was actually said -- there's no transcript to lose, so the
      // audio is safe to discard right away.
      await discardAudio(db, storagePath);
      assistantText = NOTHING_HEARD_REPLY[profile?.locale === 'ko' ? 'ko' : 'en'];
    } else {
      // The user's own words are saved BEFORE the audio is discarded, not
      // after: discarding used to run immediately post-transcription, so a
      // failure in insertMessage right below (or anything after it) left
      // this turn's speech nowhere -- not in `messages`, and the only copy
      // of it already deleted. Only once the transcript is durably on
      // record is the audio actually redundant.
      await insertMessage(db, sessionId, user.id, 'user', userText);
      await discardAudio(db, storagePath);

      const { data: history, error: historyError } = await db
        .from('messages')
        .select('role, content')
        .eq('session_id', sessionId)
        .order('position', { ascending: true });
      if (historyError) throw historyError;

      const reply = await generateReply(history ?? [], aiName, userHonorific, profile?.locale);
      assistantText = reply.reply;
      shouldEnd = reply.end;
      await insertMessage(db, sessionId, user.id, 'assistant', assistantText);
      if (reply.inputTokens > 0 || reply.outputTokens > 0) {
        await recordUsage(db, {
          userId: user.id,
          eventType: 'gpt_completion',
          source: 'converse',
          sessionId,
          inputTokens: reply.inputTokens,
          outputTokens: reply.outputTokens,
        });
      }
    }

    const audioBase64 = await synthesizeSpeech(assistantText, voice);
    await recordUsage(db, {
      userId: user.id,
      eventType: 'tts_synthesize',
      source: 'converse',
      sessionId,
      ttsCharacters: assistantText.length,
    });

    return json({ userText, assistantText, shouldEnd, audioBase64 });
  } catch (e) {
    console.error('converse failed:', e);
    return json({ error: errorMessage(e, 'Something went wrong while talking to the AI.') }, 500);
  }
});

async function discardAudio(db: SupabaseClient, storagePath: string): Promise<void> {
  try {
    await db.storage.from('recordings').remove([storagePath]);
    await db.from('attachments').delete().eq('storage_path', storagePath);
  } catch (e) {
    console.warn('could not discard turn audio', storagePath, e);
  }
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

type TranscribeResult = { text: string; durationSeconds: number; bytes: number };

// Deliberately no `language` hint: the user may speak any language (or mix
// them) regardless of the app's settings, so Whisper auto-detects per turn.
async function transcribeAudio(file: Blob, storagePath: string): Promise<TranscribeResult> {
  const fileName = storagePath.split('/').pop() ?? 'segment.m4a';
  const form = new FormData();
  form.append('file', file, fileName);
  form.append('model', 'whisper-1');
  // verbose_json is the only response_format that gives back the audio's
  // actual duration, for usage measurement (see _shared/usage.ts).
  form.append('response_format', 'verbose_json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const bodyText = await res.text();
    // A turn that got cut essentially right as it started reads to Whisper
    // as an empty/invalid-format file rather than a real 400 -- the client
    // pads every stop to a safe minimum length now, but treat this as
    // "nothing heard" rather than a hard failure either way, since a raw
    // Whisper error dumped into an alert isn't actionable for the user.
    if (res.status === 400 && /invalid file format|could not be decoded/i.test(bodyText)) {
      return { text: '', durationSeconds: 0, bytes: file.size };
    }
    throw new Error(`Whisper transcription failed (${res.status}): ${bodyText}`);
  }
  const data = await res.json();
  return {
    text: data.text ?? '',
    durationSeconds: typeof data.duration === 'number' ? data.duration : 0,
    bytes: file.size,
  };
}

// profiles.locale: 'auto' (default -- answer in whatever language the user
// just spoke), or 'ko' / 'en' to always answer in that language.
function replyLanguageRule(locale: string | null | undefined): string {
  if (locale === 'ko') return 'Always reply in Korean, whatever language the user speaks.';
  if (locale === 'en') return 'Always reply in English, whatever language the user speaks.';
  return 'Reply in the SAME language the user is speaking in this turn (Korean if they spoke Korean, English if English, and so on).';
}

function buildSystemPrompt(aiName: string | null, userHonorific: string | null, locale: string | null | undefined): string {
  let prompt = `You are the voice on the other end of a live, continuous conversation inside Mind Record, a voice-journaling app. The conversation auto-listens again after every reply you give -- the user never has to tap anything between turns, it just flows. The user is thinking out loud, like talking to a supportive friend while journaling -- your job is to listen and respond BRIEFLY (1-2 short, natural spoken sentences) so the conversation keeps flowing without you taking over it. This is read aloud by text-to-speech, so never use markdown, bullet points, or a written-essay register -- write the way a person actually talks.

${replyLanguageRule(locale)}

Most turns: just react naturally and briefly -- a short acknowledgment, a light follow-up question, or simply encouraging them to keep going. Don't summarize or repeat back everything they just said.

If they ask you to recap what they've said so far (e.g. "요약해줘", "summarize", "지금까지 뭐라고 했지"), give a short spoken recap (2-4 sentences) of the conversation so far, based on the message history you can see.

If they mention wanting something filed under a specific topic/folder (e.g. "이건 Business 토픽에 넣어줘", "put this under Business"), or ask you to create a new topic (e.g. "교단이라는 토픽을 만들어줘", "make a topic called Family"), just acknowledge it naturally -- both are picked up automatically when the conversation is saved and organized afterwards, you don't need to do anything else about it. Don't claim it's done already; say it will be set up when this is saved.

Ending the conversation: set "end" to true ONLY when the user is clearly telling you, right now, to stop and save -- e.g. "저장하고 끝내", "그만할게", "끝낼게", "여기까지 할게", "save and end", "that's all for now". Give a brief, warm closing line as "reply" when you do (e.g. "네, 여기까지 저장할게요."). Do NOT set "end" to true just because ending was mentioned as a topic of what they're thinking about (e.g. "오늘 하루를 어떻게 마무리할지 고민했다" is content, not a command) -- only an actual instruction to you, right now, counts. When in doubt, treat it as content and keep "end" false; the user can always tap Cancel/End on screen themselves.

Never invent facts about the user. Never break character to explain that you're an AI language model.`;

  if (aiName) {
    prompt += `\n\nThe user calls you "${aiName}" -- that's your name in this conversation. If they address you by it (e.g. "${aiName}, ...") or ask who you are, respond as ${aiName} naturally; don't explain that this is a configured name.`;
  }
  if (userHonorific) {
    prompt += `\n\nAddress the user as "${userHonorific}" when it feels natural -- not in every single reply, just where a person would actually say it.`;
  }

  prompt += `\n\nRespond with strict JSON: { "reply": string, "end": boolean }`;
  return prompt;
}

async function generateReply(
  history: { role: string; content: string }[],
  aiName: string | null,
  userHonorific: string | null,
  locale: string | null | undefined
): Promise<{ reply: string; end: boolean; inputTokens: number; outputTokens: number }> {
  const messages = [
    { role: 'system', content: buildSystemPrompt(aiName, userHonorific, locale) },
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
  return {
    reply,
    end: parsed.end === true,
    inputTokens: typeof data.usage?.prompt_tokens === 'number' ? data.usage.prompt_tokens : 0,
    outputTokens: typeof data.usage?.completion_tokens === 'number' ? data.usage.completion_tokens : 0,
  };
}

async function synthesizeSpeech(text: string, voice: string): Promise<string> {
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
