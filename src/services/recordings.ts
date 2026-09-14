import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

export type Attachment = Database['public']['Tables']['attachments']['Row'];

/**
 * Uploads a just-recorded audio segment to the `recordings` Storage bucket
 * and records it in `attachments`. The storage path follows the convention
 * the bucket's RLS policies key off: recordings/{user_id}/{session_id}/...
 * (see supabase/migrations/20260913000005_attachments_storage.sql).
 */
export async function uploadRecording(
  userId: string,
  sessionId: string,
  fileUri: string
): Promise<Attachment> {
  const response = await fetch(fileUri);
  const arrayBuffer = await response.arrayBuffer();

  const fileName = `${Date.now()}.m4a`;
  const storagePath = `${userId}/${sessionId}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('recordings')
    .upload(storagePath, arrayBuffer, { contentType: 'audio/m4a' });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('attachments')
    .insert({
      user_id: userId,
      session_id: sessionId,
      type: 'audio',
      file_name: fileName,
      storage_path: storagePath,
      mime_type: 'audio/m4a',
      file_size: arrayBuffer.byteLength,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}
