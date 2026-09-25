// The AI voices a user can pick (Settings -> AI), shared by every Edge
// Function that synthesizes speech (converse, search-ask, preview-voice).
// Kept in sync with the `profiles_ai_voice_check` constraint (latest:
// supabase/migrations/20260927000001_ai_voice_marin.sql) and src/types/
// database.ts's AiVoice.

export const ALLOWED_VOICES = new Set(['alloy', 'echo', 'onyx', 'nova', 'shimmer', 'marin']);

// OpenAI's newer voices (marin) only exist on gpt-4o-mini-tts; tts-1 rejects
// them. The original voices stay on tts-1 so their sound, latency and cost
// don't change.
const GPT_4O_MINI_TTS_VOICES = new Set(['marin']);

export type TtsModel = 'tts-1' | 'gpt-4o-mini-tts';

export function ttsModelFor(voice: string): TtsModel {
  return GPT_4O_MINI_TTS_VOICES.has(voice) ? 'gpt-4o-mini-tts' : 'tts-1';
}
