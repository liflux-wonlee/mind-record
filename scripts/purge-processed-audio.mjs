// One-off: delete the audio of sessions that already finished processing.
// process-session/converse now do this automatically on success; this
// catches everything recorded before that change.
//
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/purge-processed-audio.mjs
//
// Needs the SERVICE ROLE key (never the anon key): it deletes across users.
// Sessions in 'error'/'pending' are left alone so they can still be retried.

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const db = createClient(url, key);

const { data: sessions, error: sessionsError } = await db
  .from('sessions')
  .select('id')
  .eq('processing_status', 'done');
if (sessionsError) throw sessionsError;
const doneIds = new Set((sessions ?? []).map((s) => s.id));

const { data: attachments, error: attachmentsError } = await db
  .from('attachments')
  .select('id, session_id, storage_path, file_size')
  .eq('type', 'audio');
if (attachmentsError) throw attachmentsError;

const targets = (attachments ?? []).filter((a) => doneIds.has(a.session_id));
if (targets.length === 0) {
  console.log('Nothing to purge.');
  process.exit(0);
}
const totalMb = targets.reduce((n, a) => n + (a.file_size ?? 0), 0) / 1024 / 1024;
console.log(`Purging ${targets.length} audio files (${totalMb.toFixed(1)} MB) from ${doneIds.size} processed sessions…`);

// Storage remove() takes at most ~1000 paths per call.
for (let i = 0; i < targets.length; i += 500) {
  const batch = targets.slice(i, i + 500);
  const { error: removeError } = await db.storage.from('recordings').remove(batch.map((a) => a.storage_path));
  if (removeError) throw removeError;
  const { error: deleteError } = await db
    .from('attachments')
    .delete()
    .in(
      'id',
      batch.map((a) => a.id)
    );
  if (deleteError) throw deleteError;
  console.log(`  ${Math.min(i + 500, targets.length)}/${targets.length}`);
}
console.log('Done.');
