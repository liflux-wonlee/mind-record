/**
 * Builds a WAV file (16-bit PCM, mono) from the raw microphone buffers
 * Conversation mode captures on Android (see useConversationSession.ts):
 * the turn is recorded through a PCM stream, not MediaRecorder, so the
 * pause detector hears exactly what Whisper gets, and this is what gets
 * uploaded. Kept import-free so the VAD harness can use it under plain node.
 */

/** Whisper resamples to 16 kHz anyway -- anything above only makes the upload bigger. */
export const WAV_TARGET_SAMPLE_RATE = 16000;

/**
 * Concatenates `chunks` (mono int16 at `sampleRate`) into a complete WAV
 * file. When the device couldn't deliver 16 kHz and fell back to an exact
 * multiple of it (48 kHz, 32 kHz), the audio is decimated back down to
 * 16 kHz -- three times smaller to upload at 48 kHz. Other rates (44.1 kHz,
 * 22.05 kHz) are written as they are: rare, and Whisper takes any rate.
 */
export function encodeWav(chunks: Int16Array[], sampleRate: number): { bytes: Uint8Array; sampleRate: number } {
  let total = 0;
  for (const c of chunks) total += c.length;

  const factor =
    sampleRate > WAV_TARGET_SAMPLE_RATE && sampleRate % WAV_TARGET_SAMPLE_RATE === 0
      ? sampleRate / WAV_TARGET_SAMPLE_RATE
      : 1;
  const outRate = sampleRate / factor;
  const outSamples = Math.floor(total / factor);

  const dataBytes = outSamples * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, outRate, true);
  view.setUint32(28, outRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  // Every device this runs on (ARM/x86 Android, iOS) is little-endian, like
  // WAV itself, so the samples can be block-copied instead of written one
  // DataView call at a time (which is slow in Hermes for a minute of audio).
  const pcm = new Int16Array(bytes.buffer, 44, outSamples);
  if (factor === 1) {
    let pos = 0;
    for (const c of chunks) {
      pcm.set(c, pos);
      pos += c.length;
    }
  } else {
    // Averaging each group of `factor` samples: a crude low-pass, but speech
    // has little energy above the new 8 kHz Nyquist, so the aliasing it lets
    // through is negligible for transcription.
    let acc = 0;
    let n = 0;
    let written = 0;
    for (const c of chunks) {
      for (let i = 0; i < c.length && written < outSamples; i++) {
        acc += c[i];
        if (++n === factor) {
          pcm[written++] = Math.round(acc / factor);
          acc = 0;
          n = 0;
        }
      }
    }
  }
  return { bytes, sampleRate: outRate };
}
