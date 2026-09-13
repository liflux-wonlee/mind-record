import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

export type Profile = Database['public']['Tables']['profiles']['Row'];

/**
 * The `on_auth_user_created` trigger (see the profiles migration) creates
 * this row the instant a user signs up, so under normal operation it always
 * exists by the time anything calls this. Returns null only if that trigger
 * hasn't run yet (a brief race right after sign-up) or the row was deleted.
 */
export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateProfile(
  userId: string,
  patch: Database['public']['Tables']['profiles']['Update']
): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
