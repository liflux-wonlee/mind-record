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
  /** When the segment was recorded -- a retried upload keeps its place among the others. */
  recordedAt?: string
): Promise<Attachment> {
  // Read through expo-file-system rather than fetch('file://...').
  const arrayBuffer = await new File(fileUri).arrayBuffer();

  const at = recordedAt ? Date.parse(recordedAt) : Date.now();
  const fileName = `${Number.isFinite(at) ? at : Date.now()}.m4a`;
  const storagePath = `${userId}/${sessionId}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('recordings')
    // upsert: a retry after an upload that actually landed (but whose answer
    // was lost) replaces the same file instead of failing as a duplicate.
    .upload(storagePath, arrayBuffer, { contentType: 'audio/m4a', upsert: true });
  if (uploadError) throw uploadError;

  // A retry of an upload whose answer was lost: the row may already exist.
  const { data: existing } = await supabase
    .from('attachments')
    .select('*')
    .eq('storage_path', storagePath)
    .maybeSingle();
  if (existing) return existing;

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
      // Segments are transcribed in created_at order.
      ...(recordedAt ? { created_at: recordedAt } : {}),
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** A record's original audio segments, in recording order. */
export async function listSessionAudio(sessionId: string): Promise<Attachment[]> {
  const { data, error } = await supabase
    .from('attachments')
    .select('*')
    .eq('session_id', sessionId)
    .eq('type', 'audio')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Short-lived links the player can stream the (private) originals from. */
export async function audioPlaybackUrls(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data, error } = await supabase.storage.from('recordings').createSignedUrls(paths, 60 * 60);
  if (error) throw error;
  return (data ?? []).map((d) => {
    if (!d.signedUrl) throw new Error('Could not open the original recording.');
    return d.signedUrl;
  });
}

/** Deletes a record's original audio (the transcript, summary and items stay). */
export async function deleteSessionAudio(sessionId: string): Promise<void> {
  const audio = await listSessionAudio(sessionId);
  if (audio.length === 0) return;
  const { error: removeError } = await supabase.storage
    .from('recordings')
    .remove(audio.map((a) => a.storage_path));
  if (removeError) throw removeError;
  const { error } = await supabase
    .from('attachments')
    .delete()
    .in(
      'id',
      audio.map((a) => a.id)
    );
  if (error) throw error;
}
