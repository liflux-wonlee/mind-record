/**
 * Local (build-time) feature flags -- not remote-configurable, just a
 * single switch to flip and rebuild if a new code path needs to be backed
 * out quickly. Not for anything a user should ever see or toggle.
 */

/**
 * Send a conversation turn's / voice-search question's audio directly in
 * the Edge Function request (as multipart form data -- see
 * useConversationSession.ts / useVoiceSearch.ts and converse/search-ask's
 * multipart branch) instead of uploading it to Storage first and passing a
 * storagePath. Set false to revert to the original upload-then-invoke flow
 * for every turn, e.g. if this path turns out to misbehave on some device/
 * network combination in real testing.
 *
 * Two earlier versions of this failed outright on a real device before
 * landing here -- see src/services/recordings.ts's appendFilePart for what
 * actually worked and why (base64-in-JSON, then RN's FormData `{uri,name,
 * type}` shortcut, both never even reached Supabase's Invocations log).
 *
 * Either path is chosen per-turn regardless of this flag once a recording
 * is larger than DIRECT_AUDIO_MAX_BYTES -- this only controls whether the
 * direct path is ever attempted at all.
 */
export const DIRECT_AUDIO_UPLOAD_ENABLED = true;

/**
 * Above this size, a turn always falls back to the Storage-upload path
 * instead of sending the audio directly in the function-invoke request.
 * Conservative on purpose: Supabase's Edge Function request size limit
 * hasn't been confirmed against current docs from this environment. In
 * normal use this should only ever bind on an unusually long single
 * conversation turn -- Capture mode's long-form recordings never go
 * through this path at all.
 */
export const DIRECT_AUDIO_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Android: capture Conversation turns as raw PCM (expo-audio's
 * useAudioStream) and end them with the PCM turn-end detector in
 * src/lib/voiceActivity.ts, instead of MediaRecorder + its peak-level
 * metering -- which could not tell a small voice from car rumble, so turns
 * never ended while driving. The turn is uploaded as WAV (src/lib/wav.ts).
 * Set false to go back to the MediaRecorder path everywhere; it also stays
 * the automatic fallback when the stream can't start, and is always used on
 * iOS/web. Trade-off: the stream records the plain mic, without the
 * voice-call noise suppression the MediaRecorder path asks for, so Whisper
 * gets unprocessed audio; WAV is also ~4x the bytes of the old m4a.
 */
export const PCM_TURN_CAPTURE_ENABLED = true;
