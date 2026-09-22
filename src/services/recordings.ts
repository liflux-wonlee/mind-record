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
 * Appends a local file to a `FormData` using RN's own `{ uri, name, type }`
 * shortcut -- confirmed correct (not assumed) by reading React Native's own
 * source rather than guessing again after two wrong fixes in a row:
 *
 * - `Libraries/Network/FormData.js`'s own value type is
 *   `string | { uri: string, name?, type? }` -- a real `Blob` was never a
 *   supported part value in the first place.
 * - `ReactAndroid/.../NetworkingModule.kt#constructMultipartBody` (the code
 *   that actually runs on the test device, per its adb-logcat platform)
 *   only recognizes a part with a `"string"` key or a `"uri"` key; anything
 *   else falls into its `else` branch and is rejected as "Unrecognized
 *   FormData part." A real `Blob` instance spread into a part by
 *   `FormData.getParts()`'s `{...value, headers, fieldName}` only copies
 *   `Blob`'s own enumerable property (`_data` -- `data`/`size`/`type` are
 *   prototype getters, not own properties, so the spread drops them), so
 *   the resulting part has neither `string` nor `uri` -- it hits exactly
 *   that "Unrecognized FormData part" branch. That's the previous fix
 *   (`response.blob()` + `.slice()`), and it's why it needed to be reverted
 *   here, not because of an on-device retest yet, but because reading the
 *   native source shows it cannot have worked.
 * - The `uri`-keyed branch reads the file via
 *   `RequestBodyUtil.getFileInputStream()` -> `ContentResolver.openInputStream()`,
 *   a real, separate native path from the Storage-upload fallback's
 *   `fetch(fileUri)` (that one fetches the `file://` URL as the request
 *   target, not as a body part) -- so, unlike the last two attempts, this
 *   one is not just "should be fine by analogy," it's read directly from
 *   the code that runs. What's still NOT verified: why this exact shape
 *   failed with "No connection..." on-device earlier this session. The
 *   content-type header (needed by the same Kotlin branch) was already
 *   being set correctly from `type`, so that wasn't it. Flagging this
 *   openly rather than re-asserting confidence -- if this fails again, the
 *   underlying error (surfaced via functionsError.ts) is the next real lead.
 */
export function appendFilePart(form: FormData, field: string, fileUri: string, name: string, mimeType: string): void {
  form.append(field, { uri: fileUri, name, type: mimeType } as unknown as Blob);
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
