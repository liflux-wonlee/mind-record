import { describeFunctionError } from '@/lib/functionsError';
import { supabase } from '@/lib/supabase';

export type ReadAloudPart = {
  part: number;
  partCount: number;
  text: string;
  audioBase64: string;
};

/**
 * One spoken part of a record's summary (supabase/functions/read-aloud). The
 * server builds the text from the record itself; long records come in
 * several parts, fetched one at a time.
 */
export async function getReadAloudPart(sessionId: string, part: number): Promise<ReadAloudPart> {
  const { data, error } = await supabase.functions.invoke('read-aloud', { body: { sessionId, part } });
  if (error) throw await describeFunctionError(error, 'Could not read this record aloud.');
  return data as ReadAloudPart;
}
