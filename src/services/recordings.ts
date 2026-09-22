import { File } from 'expo-file-system';

import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

export type Attachment = Database['public']['Tables']['attachments']['Row'];

/**
 * A just-recorded local audio file's size, to decide whether it's small
 * enough to send directly in an Edge Function request instead of uploading
 * to Storage first (see src/services/conversation.ts / searchAnswer.ts and
 * src/lib/featureFlags.ts's DIRECT_AUDIO_UPLOAD_ENABLED / size guard). A
 * plain stat -- unlike reading the file's contents, this doesn't need to
 * load anything into JS memory.
 */
export function localRecordingSize(fileUri: string): number {
  return new File(fileUri).size;
}

/**
 * Appends a local file to a `FormData` as a real `Blob` part -- reading it
 * through `fetch(fileUri)` first, the same mechanism uploadRecording()
 * below already uses reliably in this app, rather than RN's `{ uri, name,
 * type }` FormData shortcut (its own type declaration,
 * react-native/Libraries/Network/FormData.js, does support it, but it's a
 * separate native code path from a real Blob upload, and it's what turned
 * out to fail outright on a real device with a generic "Network request
 * failed" -- no HTTP request even reaching Supabase -- when this was first
 * tried; see git history). A real Blob goes through FormData's ordinary,
 * far more battle-tested multipart path instead.
 */
export async function appendFilePart(
  form: FormData,
  field: string,
  fileUri: string,
  name: string,
  mimeType: string
): Promise<void> {
  const response = await fetch(fileUri);
  const arrayBuffer = await response.arrayBuffer();
  const blob = new Blob([arrayBuffer], { type: mimeType });
  form.append(field, blob, name);
}

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
