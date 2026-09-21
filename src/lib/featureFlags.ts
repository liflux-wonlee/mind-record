/**
 * Local (build-time) feature flags -- not remote-configurable, just a
 * single switch to flip and rebuild if a new code path needs to be backed
 * out quickly. Not for anything a user should ever see or toggle.
 */

/**
 * Send a conversation turn's / voice-search question's audio directly in
 * the Edge Function request instead of uploading it to Storage first and
 * passing a storagePath -- see useConversationSession.ts / useVoiceSearch.ts
 * and converse/search-ask's `audioBase64` input. Set false to revert to the
 * original upload-then-invoke flow for every turn, e.g. if the direct path
 * turns out to misbehave on some device/network combination in real
 * testing that wasn't reproducible here.
 *
 * Either path is chosen per-turn regardless of this flag once a recording
 * is larger than DIRECT_AUDIO_MAX_BYTES -- this only controls whether the
 * direct path is ever attempted at all.
 */
export const DIRECT_AUDIO_UPLOAD_ENABLED = true;

/**
 * Above this size, a turn always falls back to the Storage-upload path
 * instead of inlining the audio into the function-invoke request body.
 * Conservative on purpose: Supabase's Edge Function request size limit
 * hasn't been confirmed against current docs from this environment (see
 * the accompanying report), and base64 inflates the payload by ~33% on
 * top of this raw-byte figure. In normal use this should only ever bind
 * on an unusually long single conversation turn -- Capture mode's
 * long-form recordings never go through this path at all.
 */
export const DIRECT_AUDIO_MAX_BYTES = 4 * 1024 * 1024;
