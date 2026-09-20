import { describeFunctionError } from '@/lib/functionsError';
import { supabase } from '@/lib/supabase';

export type SearchTurn = { question: string; answer: string };

export type SearchCitation = {
  kind: 'session' | 'task' | 'memory';
  id: string;
  title: string;
  happened_at: string;
  session_id: string | null;
  topic_id: string | null;
};

export type SearchAnswerResult = {
  question: string;
  answer: string;
  citations: SearchCitation[];
  /** Base64-encoded mp3, only synthesized for a voice-originated question. */
  audioBase64: string | null;
};

/**
 * Grounded Q&A over the user's own records (see supabase/functions/
 * search-ask). Pass either `question` (typed) or `storagePath` (a voice
 * question already uploaded via uploadSearchQuestionAudio) -- never both.
 * `history` is the last few turns of this search conversation, for
 * follow-ups like "그중 이번 주에 할 것은?".
 */
export async function askSearchQuestion(
  input: { question: string; history?: SearchTurn[] } | { storagePath: string; history?: SearchTurn[] }
): Promise<SearchAnswerResult> {
  const { data, error } = await supabase.functions.invoke('search-ask', { body: input });
  if (error) throw await describeFunctionError(error, 'Could not answer that.');
  return data as SearchAnswerResult;
}

/**
 * Uploads a spoken search question directly to Storage -- NOT through
 * src/services/recordings.ts's uploadRecording(), since a search question
 * is never a `sessions` row and must never leave an `attachments` row
 * behind (search-ask deletes the object itself right after transcribing
 * it). The bucket's RLS only checks the leading {user_id}/ path segment
 * (see supabase/migrations/20260913000005_attachments_storage.sql), so a
 * distinct "search-queries" sub-folder is a valid, RLS-safe path without
 * needing any session to exist.
 */
export async function uploadSearchQuestionAudio(userId: string, fileUri: string): Promise<string> {
  const response = await fetch(fileUri);
  const arrayBuffer = await response.arrayBuffer();
  const storagePath = `${userId}/search-queries/${Date.now()}.m4a`;
  const { error } = await supabase.storage
    .from('recordings')
    .upload(storagePath, arrayBuffer, { contentType: 'audio/m4a' });
  if (error) throw error;
  return storagePath;
}
