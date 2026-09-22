/**
 * Local (build-time) feature flags -- not remote-configurable, just a
 * single switch to flip and rebuild if a new code path needs to be backed
 * out quickly. Not for anything a user should ever see or toggle.
 */

/**
 * Send a conversation turn's / voice-search question's audio directly in
 * the Edge Function request (as multipart form data, streamed from the
 * local file -- see useConversationSession.ts / useVoiceSearch.ts and
 * converse/search-ask's multipart branch) instead of uploading it to
 * Storage first and passing a storagePath. Set false to revert to the
 * original upload-then-invoke flow for every turn, e.g. if this path turns
 * out to misbehave on some device/network combination in real testing.
 *
 * A first version of this sent the audio as a base64 string inside the
 * JSON body instead -- that failed outright on a real device (the request
 * never reached Supabase's Invocations log at all, i.e. never left the
 * client successfully), which is why this is multipart now instead.
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
