import { describeFunctionError } from '@/lib/functionsError';
import { supabase } from '@/lib/supabase';
import type { AiVoice } from '@/types/database';

/** Base64-encoded mp3 of a fixed sample line spoken in the given voice -- for Account's voice picker. */
export async function previewVoice(voice: AiVoice, locale: 'ko' | 'en' = 'ko'): Promise<string> {
  const { data, error } = await supabase.functions.invoke('preview-voice', { body: { voice, locale } });
  if (error) throw await describeFunctionError(error, 'Could not play a preview.');
  return (data as { audioBase64: string }).audioBase64;
}
