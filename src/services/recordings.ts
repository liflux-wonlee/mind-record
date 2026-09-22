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
 * through `fetch(fileUri).blob()`, the RN-idiomatic way to turn a local
 * file into an upload-ready Blob (rather than RN's `{ uri, name, type }`
 * FormData shortcut, a separate native code path that turned out to fail
 * outright on a real device with a generic "Network request failed" --
 * see git history). `response.arrayBuffer()` then `new Blob([arrayBuffer])`
 * was tried first and ALSO failed on-device: React Native's Blob polyfill
 * (unlike a browser/Node/Deno's) doesn't support constructing a Blob from
 * an ArrayBuffer/ArrayBufferView at all ("Creating blobs from 'ArrayBuffer'
 * and 'ArrayBufferView' are not supported"). `response.blob()` sidesteps
 * this entirely -- RN's fetch already hands back a natively-backed Blob
 * for a local file read, with no ArrayBuffer round trip needed.
 *
 * A local file:// read has no server to send a Content-Type header, so the
 * resulting Blob's own `.type` often comes back empty -- and FormData's
 * multipart part uses exactly that (`blob.type`), not anything passed to
 * `.append()`, as the part's Content-Type. `.slice()` re-tags it without
 * copying the underlying data, so the server actually sees `audio/m4a`
 * instead of Whisper trying to guess the format from nothing.
 */
export async function appendFilePart(
  form: FormData,
  field: string,
  fileUri: string,
  name: string,
  mimeType: string
): Promise<void> {
  const response = await fetch(fileUri);
  const blob = await response.blob();
  const typedBlob = blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType);
  form.append(field, typedBlob, name);
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
