import { describeFunctionError } from '@/lib/functionsError';
import { supabase } from '@/lib/supabase';

/**
 * Permanently deletes the signed-in user's account and everything under it
 * (see supabase/functions/delete-account) -- recordings, transcripts,
 * tasks, ideas, topics, the profile row, and the auth account itself.
 * Throws (never silently "succeeds") if any of it couldn't be confirmed
 * deleted, so the caller can tell the user to retry rather than assume it
 * worked.
 */
export async function deleteAccount(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('delete-account');
  if (error) throw await describeFunctionError(error, 'Could not delete your account.');
  if ((data as { status?: string } | null)?.status !== 'deleted') {
    throw new Error('Could not confirm your account was fully deleted. Please try again.');
  }
}
