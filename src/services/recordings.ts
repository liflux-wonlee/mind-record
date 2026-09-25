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
 * Appends a local file to a `FormData` as a real `Blob` part. This was
 * reverted to RN's `{ uri, name, type }` shortcut moments ago based on
 * reading React Native's own native networking source (FormData.js,
 * NetworkingModule.kt) -- that analysis, while accurate for those files,
 * was of the WRONG layer: it turns out to be irrelevant here, and the very
 * error text that RN analysis predicted correctly explains as *wrong* is
 * exactly what came back on-device: "Unsupported FormDataPart
 * implementation." That string doesn't even exist anywhere in
 * react-native's source -- it's thrown by Expo's OWN fetch polyfill, which
 * is what this app's global `fetch`/`FormData` actually are
 * (`expo/src/winter/fetch`), never touching RN's native FormData/networking
 * code at all. Traced this time, not assumed:
 *
 * - `expo/src/winter/FormData.ts` monkey-patches RN's `FormData` class with
 *   its own spec-compliant methods. Its `append()` -> `normalizeArgs()`
 *   passes an object value through completely unchanged unless it's
 *   `instanceof Blob` -- `{ uri, name, type }` is not recognized at all,
 *   which is exactly why that shape threw immediately on-device.
 * - `expo/src/winter/fetch/RequestUtils.ts` sends a `FormData` request body
 *   through `convertFormDataAsync()` (`expo/src/winter/fetch/convertFormData.ts`),
 *   which only knows how to serialize a `string` part or one that is
 *   `instanceof Blob` (or has `.bytes()`) -- anything else hits its
 *   `else { throw new Error('Unsupported FormDataPart implementation') }`,
 *   which is the literal error seen on-device.
 * - So a real `Blob` is required, and `fetch(fileUri).blob()`
 *   (`expo/src/winter/fetch/FetchResponse.ts`) is how to get a working one:
 *   it detects that this app's global `Blob` is still React Native's
 *   (`expo-blob` isn't installed) and calls `createReactNativeBlobAsync()`,
 *   which builds the Blob via `BlobManager.createFromOptions()` directly --
 *   NOT via `new Blob([arrayBuffer])`, so it does not hit RN's "Creating
 *   blobs from 'ArrayBuffer'..." limitation the attempt before this one
 *   ran into by constructing a Blob that way directly.
 *
 * A local file:// read has no server to send a Content-Type header, so the
 * resulting Blob's own `.type` often comes back empty -- and
 * `convertFormData.ts`'s `getFormDataPartHeaders()` reads the part's
 * `.type` to set the multipart part's Content-Type header. `.slice()`
 * re-tags it without copying the underlying data, so the server actually
 * sees `audio/m4a` instead of Whisper trying to guess the format from
 * nothing.
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
  fileUri: string,
  // Conversation turns on Android are WAV (see src/lib/wav.ts); everything
  // else is MediaRecorder's m4a. The extension is also how converse tells
  // Whisper the format when it reads the file back from Storage.
  format: { extension: 'm4a' | 'wav'; mimeType: string } = { extension: 'm4a', mimeType: 'audio/m4a' }
): Promise<Attachment> {
  const response = await fetch(fileUri);
  const arrayBuffer = await response.arrayBuffer();

  const fileName = `${Date.now()}.${format.extension}`;
  const storagePath = `${userId}/${sessionId}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('recordings')
    .upload(storagePath, arrayBuffer, { contentType: format.mimeType });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('attachments')
    .insert({
      user_id: userId,
      session_id: sessionId,
      type: 'audio',
      file_name: fileName,
      storage_path: storagePath,
      mime_type: format.mimeType,
      file_size: arrayBuffer.byteLength,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}
