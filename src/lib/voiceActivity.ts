/**
 * End-of-turn detection for Conversation mode, from raw microphone PCM.
 *
 * Replaces the old metering-based silence timer (useConversationSession.ts,
 * commit 1a7282f), which judged "the user stopped talking" from Android's
 * MediaRecorder.getMaxAmplitude(): the PEAK |sample| of the whole band every
 * 200 ms. In a car that peak belongs to the road/engine rumble (almost all of
 * a car's noise energy is below ~300 Hz) and a small, far-away voice barely
 * moves it -- so a turn in a moving car never ended. With the PCM stream
 * (expo-audio useAudioStream) this module instead:
 *
 *  1. band-limits the audio to the telephone speech band (300-3400 Hz), which
 *     throws away the rumble and most engine orders before anything is
 *     measured -- the voice's formants live in this band, the car mostly
 *     doesn't;
 *  2. measures each 20 ms frame's band level against the noise level: the
 *     average of frames with no voice nearby, held within 5 dB above the
 *     quietest frame of the last ~1.5 s ("minimum statistics"). Speech always
 *     dips to the noise between words, so this follows the car speeding up
 *     or slowing down without ever mistaking a long sentence for noise;
 *  3. measures VOICING -- periodicity at a pitch of 70-400 Hz from vocal-fold
 *     vibration, required to line up across two consecutive frames -- on a
 *     ~4 kHz 500-1800 Hz copy, with the noise's own periodicity (engine orders
 *     are periodic too) subtracted out and a threshold that sits above
 *     whatever periodicity the noise alone shows. Tire, wind and bump noise
 *     are not periodic at a voice pitch; a voice, even one at 0 dB SNR in the
 *     speech band (-12 dB full-band, rumble included), mostly is.
 *
 * On those measurements (each rule is explained at its constants below):
 *  - A turn STARTS only on a voice: ~80 ms of voiced frames clearly above the
 *    noise within half a second, most of it in one sound (a road bump isn't
 *    voiced, a turn-signal tick is too short) -- and not in the first 200 ms,
 *    nor from a voice already there when the stream starts (the AI's reply
 *    still coming out of the car's speakers) until that voice has stopped
 *    or, from 700 ms on, a new sound follows it after a pause (a quick "네").
 *  - The pause timer is reset by voiced frames a little above the noise (the
 *    louder a frame, the more periodic it must be: a bump that happens to ring
 *    isn't a voice), by loud frames right next to voiced ones (consonants),
 *    and -- for a small voice under loud aperiodic road noise, within 1.5 s of
 *    such a reset -- by weaker but sustained voicing the noise alone doesn't
 *    produce. Under a strong tone (a motor whine) a voice is heard by its
 *    level instead. Once the pause has run 300 ms it takes a syllable (60 ms
 *    of voicing) to reset it: a ringing bump or wiper thump is voiced for
 *    20-40 ms.
 *  - The same voiced sound recurring on a beat (turn-signal ticks and tocks,
 *    a door chime) is a machine: it counts as unvoiced, the pause resets (and
 *    the start) it caused are taken back, and its frames don't count toward
 *    the pause.
 *  - The turn ends after `pauseMs` without a reset, plus an allowance for the
 *    soft phrase edges the detector can't hear under the noise (60 ms with a
 *    clear voice, up to 450 ms with a small voice in a loud car), so the user
 *    gets the full pauseMs they chose.
 *  - The noise estimates carry over to the next turn (memory()) as a head
 *    start only: dropped when the car has become much louder since, and the
 *    carried noise periodicity is held to what this turn's noise shows.
 *
 * Validated offline (harnesses not in the repo) on a real speech recording
 * mixed with synthetic noise:
 *  - side by side with the old detector, in car noise (road rumble, engine
 *    orders, tire, wind, bumps, turn-signal ticks, speed-ups and slow-downs)
 *    at 12/6/0 dB speech-band SNR (+1 to -13 dB full-band), 936 turns: the
 *    old detector never ended ~94% of them (as on the road); this one ends
 *    all but 2, never starts on noise alone (168 noise-only runs) and cuts 1
 *    (at 0 dB SNR under an idling engine whose orders swamp the voice's
 *    periodicity). With the edge allowance it ends pauseMs + 0.3-0.45 s
 *    after the last word (median; +0.6 s at the 90th percentile at 0 dB
 *    SNR); in a quiet or fan-noise room pauseMs + ~0.2 s.
 *  - against two independent stress sets: a 44 s answer with 0.6-0.8 s
 *    phrase pauses in five kinds of car noise at 0-6 dB is no longer cut at
 *    pauseMs = 1000 (14/15 whole; the other ends where 1.3 s of speech is
 *    under the noise); inserted 0.5-1.2 s pauses, rough-road cabin rings and
 *    wiper thumps, the AI's reply still playing for 0.5-1 s at the stream
 *    start (false turns 1-2 in 12 per tail length up to 0.7 s, 4-8 at
 *    0.8-1 s; was up to 9), one-word answers 0.15-0.3 s into the stream
 *    (78/90 heard, was 41/90) or 0.15-0.3 s after a 0.2-0.45 s tail of the
 *    reply, turn-signal ticks/tocks, whines, engine revs, stale memory, noise
 *    steps, 8-48 kHz input, odd buffer sizes. Still weak: a drone or blower
 *    switching on in the pause, a door chime, a noise suppressor's musical
 *    residue, wiper squeaks whose pitch varies from stroke to stroke (turns
 *    end late or not at all), a voice that is only audible for 20-40 ms of a
 *    syllable after a pause (a pause around it may end the turn), the reply's
 *    last word after a pause in its tail (a false turn), an answer over within
 *    0.7 s of the stream start after a tail (missed).
 *
 * Never throws -- it runs in the audio callback: an unusable sample rate or
 * pauseMs falls back to a default (diagnostics() then shows rateFallback),
 * and an unusable memory field is ignored (without a usable floor, all of
 * it: diagnostics().memory is then 'none').
 *
 * Pure and self-contained (no imports) so the exact shipped code runs under
 * node in the offline test harness as well as in Hermes. Everything is
 * preallocated; at 16 kHz the work is ~0.7 M multiply-adds per audio second
 * (filters ~0.35 M, autocorrelation ~0.33 M, everything else a few %) --
 * ~9 ms of CPU per audio second at 16 kHz (~12 ms at 44.1/48 kHz) in Hermes
 * (bytecode interpreter, no JIT) on a desktop core.
 *
 * Usage: one detector per turn --
 *   const det = new TurnEndDetector({ sampleRate, pauseMs, memory: lastMemory });
 *   onBuffer: if (det.push(int16Mono)) endTurn();   // any buffer size
 *   at turn end: lastMemory = det.memory(); log det.diagnostics() / det.trace()
 * A turn in which hasSpoken never became true had no voice in it.
 */

// ---------------------------------------------------------------------------
// Signal path
// ---------------------------------------------------------------------------

// The band the level is measured in. 300 Hz: below it is where a car's noise
// lives (road rumble, cabin boom ~40 Hz, engine firing orders 50-300 Hz) and
// where a voice has only its fundamental, which the harmonics above carry
// anyway. 3400 Hz: the classic telephone band -- enough for a voice to be
// heard in, and low enough to decimate to ~8 kHz.
const BAND_LOW_HZ = 300;
const BAND_HIGH_HZ = 3400;
// Work is done at ~8 kHz (the input rate divided by an integer), which
// halves the per-sample cost at 16 kHz and keeps the fallback rates cheap.
// At 44.1/48 kHz the input is first averaged over PRE_AVERAGE_RATE_HZ-sized
// groups (2 or 3 samples: additions only, with nulls right on the
// frequencies that would fold onto the speech band) so the anti-alias
// filter runs at ~16-22 kHz instead of 48 kHz.
const WORK_RATE_HZ = 8000;
const PRE_AVERAGE_RATE_HZ = 16000;
const PRE_AVERAGE_FROM_HZ = 32000;
// Voicing is measured on a further copy decimated to ~4 kHz (VOICING_RATE_HZ)
// and low-passed at 1800 Hz: the first formants and the harmonics that carry
// the pitch period are all below that, and halving the rate quarters the
// autocorrelation cost.
const VOICING_RATE_HZ = 4000;
const VOICING_LOWPASS_HZ = 1800;
// ...and high-passed again at 500 Hz: what's left of a road bump or engine
// rumble just above the 300 Hz band edge is a narrow band of noise, and a
// narrow band looks periodic to an autocorrelation. A voice's harmonics
// above 500 Hz still repeat at its pitch period, so its voicing survives.
const VOICING_HIGHPASS_HZ = 500;
// 4th-order Butterworth as two biquads with these Qs: steep enough that the
// rumble (tens of dB louder than the voice below 150 Hz) is really gone.
const BUTTERWORTH4_Q = [0.5411961, 1.306563];
// One analysis frame. 20 ms is short enough to see the gaps between words
// and long enough to hold two pitch periods of a 100 Hz voice.
const FRAME_MS = 20;
// Pitch search range: 70 Hz (a low male voice) to 400 Hz (a child / high
// female voice). The autocorrelation window is 30 ms -- two periods of the
// lowest pitch.
const PITCH_MIN_HZ = 70;
const PITCH_MAX_HZ = 400;
const VOICING_WINDOW_MS = 30;
// The noise's own periodicity profile (per lag) is averaged over roughly
// this long of frames at the noise level, and subtracted in proportion to
// how much of a frame's energy the noise accounts for.
const NOISE_PROFILE_TC_MS = 1000;

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

// A frame is voiced when its (two-frame, noise-compensated) periodicity is at
// least VOICED_MIN_CORRELATION and at least VOICED_ABOVE_NOISE above what the
// noise alone reaches 90% of the time (NOISE_VOICING_QUANTILE, tracked on
// frames at the noise level). Random broadband noise reaches ~0.2-0.3 by
// chance (0.35 in ~1% of road-noise frames); a voice at 0 dB local SNR
// reaches ~0.6. An idling engine's orders can read as 0.5 on their own --
// the tracked quantile lifts the threshold above that instead of hearing the
// engine as a voice.
const VOICED_MIN_CORRELATION = 0.35;
const VOICED_ABOVE_NOISE = 0.06;
const NOISE_VOICING_QUANTILE = 0.9;
const NOISE_VOICING_INITIAL = 0.3;
// It is tracked as a running quantile (NOISE_VOICING_STEP correlation units
// per noise frame: settles within a few seconds, and a second of weak speech
// misread as noise barely moves it). The last turn's value is where it
// starts, but held to at most the 90th percentile of this turn's own noise
// frames until it has NOISE_VOICING_WINDOW of them (~2-4 s of audio) -- so a
// periodic noise that has stopped since (an engine whine, an idling engine)
// no longer holds the threshold up for the ~20 s the running quantile needs
// to come down. (Only the carried value: this turn's own tracking can't be
// held to a plain percentile, which misses the noise frames that already read
// as voiced.) Until this turn has NOISE_VOICING_MIN_COUNT noise frames, the
// last turn's value (or NOISE_VOICING_INITIAL) stands in -- in practice only
// during ECHO_GUARD_MS.
const NOISE_VOICING_STEP = 0.004;
const NOISE_VOICING_WINDOW = 48;
const NOISE_VOICING_MIN_COUNT = 8;
const NOISE_VOICING_BINS = 100;
// ...fed only frames at or below this height above the noise level: the
// noise's periodicity doesn't depend on its momentary level, while a weak
// voice buried in it always adds a little energy.
const NOISE_VOICING_MAX_ABOVE_DB = 0.5;
// A voiced frame this far above the noise level keeps the turn open.
// Small on purpose: a small voice under a loud car is only a few dB over the
// noise, and the voicing check is what keeps noise from passing it (noise
// frames are voiced AND this loud well under 1% of the time).
const VOICED_MARGIN_DB = 1.5;
// ...and to START a turn a voiced frame must be START_MARGIN_DB above the
// noise level AND START_RISE_DB above the quietest frame of the last
// START_WINDOW frames: starting on noise is the costlier mistake (the turn
// would then end on the car alone before the user said anything). The rise
// is what a voice has and steady noise doesn't -- syllables come and go --
// and it holds even when the noise level is stale, e.g. carried over from
// the last turn while the engine has since got louder and its orders read
// as voiced.
const START_MARGIN_DB = 2;
const START_RISE_DB = 3;
// A frame far above the noise is mostly the sound itself, so if that sound is
// a voice its periodicity shows almost undiluted: a voiced frame at A dB above
// the noise needs at least VOICED_AT_HIGH_SNR x (the sound's share of the
// frame's energy, 1 - 10^(-A/10)) -- 0.43 at +8 dB, 0.48 at +14 dB. A road
// bump or a door thump is loud but only weakly, accidentally periodic
// (0.35-0.4), and no longer counts as voiced; a real vowel that loud reads
// 0.6-0.9 (99% of voiced speech frames pass).
const VOICED_AT_HIGH_SNR = 0.5;
// Where the noise is itself strongly periodic in the voicing band -- a motor
// or gear whine, a tone at or above the road noise there: its 90th-percentile
// voicing at least TONAL_NOISE_VOICING -- voicing no longer tells a voice from
// the noise (a vowel at +8 dB reads no more periodic than the whine), and the
// threshold above the noise's voicing would shut the voice out entirely. There
// a frame TONAL_MARGIN_DB above the noise also counts as voiced: a steady tone
// barely moves the level, a voice lifts it.
const TONAL_NOISE_VOICING = 0.55;
const TONAL_MARGIN_DB = 4;
// A frame this far above the noise counts even unvoiced (consonants, breathy
// syllable ends) -- but only within ENERGY_NEAR_VOICE_MS of a voiced frame:
// consonants sit right next to vowels, while a pothole thump or a door
// closing a second after the user stopped is loud but nowhere near a voice,
// and must not restart the pause. 8 dB: the 60 ms level of steady noise
// stays within ~2-3 dB of its average, and the car speeding up right after
// the user stops raises the noise ~5 dB/s before its level catches up.
const ENERGY_MARGIN_DB = 8;
const ENERGY_NEAR_VOICE_MS = 300;
// The turn starts once START_VOICED_FRAMES voiced frames START_MARGIN_DB above
// the noise have been seen within the last START_WINDOW_FRAMES (~80 ms of
// voice in half a second, enough for a one-word "네"), START_SOUND_FRAMES of
// them in one sound (no more than START_GAP_FRAMES without one in between):
// a syllable's vowel, even a small voice's at 0 dB SNR, holds 60 ms; a
// turn-signal tick or tock rings voiced for 20-40 ms, so a train of them never
// starts a turn.
const START_VOICED_FRAMES = 4;
const START_SOUND_FRAMES = 3;
const START_GAP_FRAMES = 3;
const START_WINDOW_FRAMES = 25;
// The AI's reply may still be coming out of the car's speakers when the hook
// starts listening (it starts the moment the reply's player reports it
// finished; over Bluetooth / a car head unit the last syllables lag by up to
// a second). So:
//  - nothing heard in the first ECHO_GUARD_MS can start a turn, and
//  - a voice that is already there in those first ECHO_GUARD_MS is the
//    reply's tail: it can't start a turn until it has stopped -- the first
//    ECHO_TAIL_GAP_MS without a voiced frame (nor, when the noise level is
//    known from the last turn, one ECHO_TAIL_LEVEL_DB above it and above
//    this turn's quietest frame) -- or
//    ECHO_TAIL_MAX_MS have gone by (a voice still going then is taken for
//    the user's). The reply's words run into each other (gaps between words
//    are shorter); its tail ends in silence.
// A user who answers right after the reply (a quick "네" 0.2 s after the
// stream starts) is heard at once, since no voice was there before it. A user
// who talks straight over the tail starts the turn at the next gap in their
// own speech (the turn is recorded from the stream start either way).
// A user who answers right after the tail ends -- the usual case over
// Bluetooth, where the tail is the reply's last 0.2-0.45 s -- speaks within
// ECHO_TAIL_GAP_MS of it, so their answer would read as more of the tail
// (and a one-word "네" is over before the tail clears). So a sound that
// follows the tail after ECHO_TAIL_NEW_SOUND_MS without voice is a candidate
// answer: it starts the turn on its own frames as usual (the tail's are
// forgotten), but not before ECHO_ANSWER_FROM_MS -- the reply's last word
// after a short pause (a comma) is the same kind of sound, and it is mostly
// over by then when the playback lag is that short (an answer that is over
// by then too is still missed). With one microphone and no echo canceller
// there is no telling the two apart: over a longer lag (0.8-1 s) the reply's
// last word after a pause still starts a turn.
const ECHO_GUARD_MS = 200;
const ECHO_TAIL_GAP_MS = 300;
const ECHO_TAIL_MAX_MS = 1000;
const ECHO_TAIL_LEVEL_DB = 4;
const ECHO_TAIL_NEW_SOUND_MS = 100;
const ECHO_ANSWER_FROM_MS = 700;
// If the quietest frame of the first MEMORY_CHECK_MS is still MEMORY_STALE_DB
// above the floor carried over from the last turn, the car has become a lot
// louder since (engine started, window down) -- the old floor would make
// everything look like speech for the ~1.5 s it survives -- so the carried
// noise estimates are dropped and this turn starts from its own. Speech alone
// doesn't hold 12 dB over the noise for 600 ms without a single dip.
const MEMORY_CHECK_MS = 600;
const MEMORY_STALE_DB = 12;
// The pause timer is reset only by at least ACTIVE_MIN_FRAMES talking frames
// within the last ACTIVE_WINDOW_FRAMES (100 ms), so a single odd frame after
// the user stopped doesn't restart it -- while a small voice whose voicing
// only shows every other frame still does.
const ACTIVE_MIN_FRAMES = 2;
const ACTIVE_WINDOW_FRAMES = 5;
// Once the pause has run RESUME_AFTER_MS, it is reset only by a syllable:
// RESUME_VOICED_FRAMES voiced frames above the noise within the last
// RESUME_WINDOW_FRAMES (60 ms of voicing in 120 ms). A bump that rings a cabin
// panel, a wiper thump or a burst of noise-suppressor "musical" residue is
// voiced for 20-40 ms; a syllable's vowel, even a small voice's, for 60 ms and
// more. Within speech (the pause shorter than that) the rules above stand, so
// a weak syllable between louder ones still counts.
const RESUME_AFTER_MS = 300;
// The pause the detector measures runs from the last frame it heard as speech
// to the first one of the next phrase -- and the soft ends of phrases (a
// syllable fading out, a reverberant tail, the breathy onset of the next word)
// sit below what it can hear, the more so the smaller the voice is over the
// noise. So the turn ends only after pauseMs plus an allowance for those
// edges: EDGE_BASE_MS (the detector's own onset delay, a frame or two) plus
// EDGE_PER_DB_MS for every dB the voice's syllables average under
// EDGE_REF_DB above the noise, up to EDGE_MAX_MS. Measured on phrase gaps in
// real speech: the detector's gap exceeds the gap in which the voice is
// audible over the noise (>= 0 dB SNR, 10 ms steps) by up to ~50-100 ms with
// the voice 10+ dB over the noise, up to ~350 ms at 4-7 dB (a 0-6 dB
// speech-band SNR in a car). Without it a user who pauses 0.6-0.8 s mid-answer
// in a car is cut off at pauseMs = 1000.
const EDGE_BASE_MS = 60;
const EDGE_PER_DB_MS = 60;
const EDGE_REF_DB = 12;
const EDGE_MAX_MS = 450;
// ...and frames right after speech that stay HANG_DB above the noise, in one
// run from the last frame heard as speech (a reverberant or breathy ending),
// extend it by up to HANG_MAX_MS.
const HANG_DB = 3;
const HANG_MAX_MS = 200;
const RESUME_VOICED_FRAMES = 3;
const RESUME_WINDOW_FRAMES = 6;
const RESUME_ACTIVE_FRAMES = 5;
// A small voice in a loud car (0-3 dB speech-band SNR): whole phrases sit only
// 0-2 dB above the noise, frame by frame too close to it for the rules above,
// yet their voicing stays above what the noise shows, frame after frame --
// which chance periodicity in broadband noise never does for long. So the
// pause timer is also reset by
//  - WEAK_RUN_FRAMES consecutive voiced frames averaging above the noise
//    level (60 ms of a vowel), or
//  - WEAK_AVG_FRAMES frames (160 ms, a syllable) whose voicing averages
//    WEAK_AVG_MIN_EXCESS above the noise's 90th percentile, with at least
//    WEAK_AVG_MIN_OVER of them over it (spread over the syllable, not one
//    loud click and its ring) and one of them voiced outright, and whose
//    level averages WEAK_AVG_MIN_ABOVE_DB above the noise.
// Only while the noise itself is aperiodic (its 90th-percentile voicing,
// now and at any point this turn, below WEAK_VOICE_MAX_NOISE_VOICING;
// broadband road/wind/tire noise reads 0.26-0.33): an idling engine's orders
// stay periodic from frame to frame, and there these weaker cues would keep
// the turn open on the engine alone -- and an engine drifts in and out of
// periodicity, so one that was periodic a few seconds ago will be again.
const WEAK_RUN_FRAMES = 3;
const WEAK_RUN_MIN_ABOVE_DB = 0;
const WEAK_AVG_FRAMES = 8;
const WEAK_AVG_MIN_EXCESS = 0.02;
const WEAK_AVG_MIN_ABOVE_DB = 0.5;
const WEAK_AVG_MIN_OVER = 5;
const WEAK_VOICE_MAX_NOISE_VOICING = 0.36;
// ...and only within WEAK_BRIDGE_MS of a pause reset by the rules above: they
// bridge the weak stretches between a small voice's louder syllables (at 0-3
// dB SNR some syllable always passes within that), but never keep a turn open
// on their own -- a noise's chance periodic moments get no louder syllable to
// lean on.
const WEAK_BRIDGE_MS = 1500;
// Repeated mechanical sounds: a voiced sound whose lag profile (its
// autocorrelation over the pitch lags, over its first two voiced frames)
// matches, at REPEAT_SIMILARITY or better and within REPEAT_LEVEL_DB in level,
// two earlier sounds within REPEAT_WINDOW_MS that keep one beat (the intervals
// equal, or one twice the other -- a tick lost in the noise --, within
// +-REPEAT_TOLERANCE_FRAMES, the beat >= REPEAT_MIN_PERIOD_MS), or matches one
// already found repeated and falls on its beat, is a turn signal's tick or
// tock, a seat-belt or door chime: the same sound on a timer. It counts as
// unvoiced, and so do the earlier ones on its beat, in hindsight: the pause
// resets they caused are taken back (and a turn only they started is
// un-started). Speech doesn't repeat one sound at one level on a metronome;
// successive ticks' profiles match at 0.85-1.0 (a tick-tock is two trains,
// each on its own beat). The window holds two earlier beats of a slow train:
// a wiper's squeak on its up stroke (and, a little lower, on its down stroke)
// comes every 1.3-1.5 s.
const REPEAT_SLOTS = 8;
const REPEAT_WINDOW_MS = 3300;
const REPEAT_SIMILARITY = 0.8;
// ...and, once a beat is known, sounds on it need only match this well (a
// weak tick's profile in noise sometimes reads 0.6-0.8).
const REPEAT_SIMILARITY_ON_BEAT = 0.6;
const REPEAT_LEVEL_DB = 3;
const REPEAT_TOLERANCE_FRAMES = 3;
const REPEAT_MIN_PERIOD_MS = 200;
// A repeated sound is discounted for at most this many times the voiced
// length of the longest earlier one on its beat (+ BURST_GAP_FRAMES) -- and a
// sound that turns into a different one (a voice starting right on a tick) is
// split there, see voicing().
const REPEAT_LENGTH_FACTOR = 2;
// The frames of a repeated sound (whose voicing is discounted, so a small
// voice under it couldn't be heard) don't count toward the pause, and neither
// does its onset frame when it is this far above the noise.
const REPEAT_MASK_DB = 3;
// A voiced sound ends after this many unvoiced frames (a chime's decaying
// ring flickers in and out of "voiced" near the noise; it stays one sound).
const BURST_GAP_FRAMES = 4;
// The noise level is the average level of "quiet" frames -- no voice within
// NOISE_QUIET_MS, nothing loud -- over about NOISE_MEAN_TC_MS, held between
// the lowest frame level of the last NOISE_BLOCKS blocks of NOISE_BLOCK_MS
// (~1.5 s; "minimum statistics") and NOISE_MAX_ABOVE_FLOOR_DB above it.
// Speech always dips to the noise within 1.5 s -- between words, stop
// consonants -- so that minimum is the noise even mid-sentence, and a long
// sentence at 0 dB SNR never becomes "the noise". The car slowing down pulls
// the minimum (and so the level) down at once; speeding up raises the
// average right away if the rise is gradual, or the minimum within 1.5 s if
// it's so sudden the louder noise first reads as "loud".
const NOISE_BLOCK_MS = 250;
const NOISE_BLOCKS = 6;
const NOISE_MEAN_TC_MS = 800;
const NOISE_MAX_ABOVE_FLOOR_DB = 5;
// With no average yet, the level starts this far above the minimum -- about
// where steady noise's average sits above its own 1.5 s minimum.
const NOISE_INITIAL_ABOVE_FLOOR_DB = 1.5;
const NOISE_QUIET_MS = 500;
// Frame levels are the median of the last 3 frames' levels: a turn-signal
// click or a single-frame spike is dropped, a 60 ms+ sound isn't.
const MEDIAN_FRAMES = 3;
// dBFS below which a frame is "no signal" (an AudioRecord that hasn't
// delivered real samples yet reads as digital zero): quiet, but never used
// as the noise level -- or every real frame after it would look like speech.
const NO_SIGNAL_DB = -100;
// ~60 s of per-100 ms trace entries (see trace()).
const TRACE_BLOCKS = 600;
const TRACE_FRAMES_PER_BLOCK = 5;
const TRACE_LEVEL_OFFSET_DB = 130;
// Frame levels in the trace are stored in half-dB steps above the block's
// lowest level (0-31.5 dB; anything louder is far past every margin anyway).
const TRACE_LEVEL_STEP_DB = 0.5;
const FULL_SCALE_SQ = 32768 * 32768;
// Sample rates outside this range are not a real microphone stream; the
// detector then assumes the rate the hook asked for rather than throwing
// inside the audio callback.
const MIN_SAMPLE_RATE_HZ = 4000;
const MAX_SAMPLE_RATE_HZ = 192000;
const FALLBACK_SAMPLE_RATE_HZ = 16000;
// pauseMs when the caller passes something that isn't a number.
const DEFAULT_PAUSE_MS = 1500;
// URL-safe base-64 alphabet for the trace's per-frame characters.
const TRACE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Carried from one turn to the next so a new turn starts knowing the car. */
export type TurnEndMemory = {
  sampleRate: number;
  /** The noise's recent minimum frame level, dBFS (null: never measured). */
  floorDb: number | null;
  /** The noise's average level, dBFS. */
  noiseDb: number | null;
  /** How periodic the noise alone looks (its 90th-percentile voicing, at its highest last turn). */
  noiseVoicing: number;
  /** The noise's own periodicity per pitch lag. */
  noiseProfile: number[];
};

export type TurnEndOptions = {
  /** Actual PCM rate (16000 normally; 48000/44100/22050/8000 as fallbacks). */
  sampleRate: number;
  /** How long a pause ends the turn (the user's "pause before replying"). */
  pauseMs: number;
  /** From the previous turn's detector's memory(), if any. */
  memory?: TurnEndMemory | null;
};

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

function butterworthSection(kind: 'lp' | 'hp', rate: number, cutoffHz: number, q: number): Biquad {
  const w = (2 * Math.PI * Math.min(cutoffHz, rate * 0.45)) / rate;
  const c = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b1 = kind === 'lp' ? 1 - c : -(1 + c);
  const b0 = kind === 'lp' ? (1 - c) / 2 : (1 + c) / 2;
  return { b0: b0 / a0, b1: b1 / a0, b2: b0 / a0, a1: (-2 * c) / a0, a2: (1 - alpha) / a0 };
}

/**
 * Detects the end of one user turn. Create one per turn (passing the previous
 * turn's memory()), feed every PCM buffer to push(), and end the turn when it
 * returns true.
 */
export class TurnEndDetector {
  private readonly rate: number;
  private readonly pauseFrames: number;
  private readonly frameMsExact: number;
  // Averaging `preAvg` input samples, decimation by `decim1` to the work
  // rate, then by `decim2` for voicing.
  private readonly preAvg: number;
  private preCount = 0;
  private preSum = 0;
  private readonly decim1: number;
  private readonly decim2: number;
  private decimPhase1 = 0;
  private decimPhase2 = 0;
  // Filter coefficients, 5 per section: [anti-alias LP x2 at the input
  // rate][band HP x2][voicing LP x2 at the work rate][voicing HP at ~4 kHz].
  private readonly coef: Float64Array;
  // Filter states: 4 per section (x1, x2, y1, y2), kept here between push() calls.
  private readonly st: Float64Array;
  private readonly frameLen: number;
  private frameCount = 0;
  private frameEnergy = 0;

  // Voicing: a circular buffer of the ~4 kHz copy plus scratch arrays.
  private readonly vWin: number;
  private readonly minLag: number;
  private readonly maxLag: number;
  private readonly vRing: Float64Array;
  private vPos = 0;
  private vFilled = 0;
  private readonly vLin: Float64Array;
  private readonly corr: Float64Array;
  private comp: Float64Array;
  private prevComp: Float64Array;
  private readonly noiseProfile: Float64Array;
  private readonly profileAlpha: number;

  // Decision state.
  private readonly lastLevels = new Float64Array(MEDIAN_FRAMES);
  private levelCount = 0;
  private readonly blockFrames: number;
  private readonly blockMins: Float64Array;
  private blockIndex = 0;
  private blockFill = 0;
  private blockMin = Infinity;
  private noiseMean: number | null = null;
  private readonly noiseAlpha: number;
  private readonly quietFrames: number;
  private readonly nearVoiceFrames: number;
  private noiseDb: number | null = null;
  // The noise's running 90th-percentile voicing; whether it still rests on the
  // last turn's value (see NOISE_VOICING_WINDOW) and this turn's noise frames'
  // voicing so far, as a histogram, to check it against; the highest value it
  // has had this turn (see WEAK_VOICE_MAX_NOISE_VOICING); noise frames seen.
  private noiseVoicing = NOISE_VOICING_INITIAL;
  private noiseVoicingCarried = false;
  private readonly nvHist = new Int16Array(NOISE_VOICING_BINS);
  private noiseVoicingPeak = 0;
  private nvCount = 0;
  private readonly recentLevels: Float64Array;
  // Voiced frames START_MARGIN_DB up in the current sound, and frames since the last one.
  private startRun = 0;
  private startGap = 1_000_000;
  // Voiced frames START_MARGIN_DB up in the last START_WINDOW_FRAMES, and the
  // last frame that completed START_SOUND_FRAMES of them in one sound.
  private readonly startHistory = new Uint8Array(START_WINDOW_FRAMES);
  private startCount = 0;
  private soundStartFrame = -1_000_000;
  private readonly guardFrames: number;
  private readonly tailGapFrames: number;
  private readonly tailMaxFrames: number;
  private readonly memoryCheckFrames: number;
  // The reply's tail (see ECHO_TAIL_GAP_MS): still possible, seen, unvoiced frames since its last voiced one.
  private echoTail = true;
  private tailSeen = false;
  private tailGap = 0;
  // A new sound after a pause in the tail (see ECHO_TAIL_NEW_SOUND_MS) is going on.
  private tailCandidate = false;
  private readonly tailNewSoundFrames: number;
  private readonly answerFromFrames: number;
  // The floor carried over from the last turn (null: none, or dropped as stale).
  private memoryFloor: number | null = null;
  private memoryState: 'none' | 'used' | 'dropped' = 'none';
  private turnMinLevel = Infinity;
  // Last WEAK_AVG_FRAMES frames: voicing, level above the noise, voiced flag.
  private readonly weakVoicing = new Float64Array(WEAK_AVG_FRAMES);
  private readonly weakAbove = new Float64Array(WEAK_AVG_FRAMES);
  private readonly weakVoiced = new Uint8Array(WEAK_AVG_FRAMES);
  // Repeated-sound check: the current voiced sound (burst), and the lag
  // profiles (mean-removed, unit-norm) and onsets of the last REPEAT_SLOTS.
  private inBurst = false;
  private burstGap = 0;
  private burstRepeat = false;
  private burstSlot = -1;
  // The last sound that ended, and when: pause resets in the WEAK_AVG_FRAMES
  // after it still come from its frames.
  private lastBurstSlot = -1;
  private lastBurstEnd = -1_000_000;
  private burstVoiced = 0;
  // How many of the current sound's frames are discounted, if it is repeated.
  private burstRepeatFrames = 0;
  // Voiced frames in a row unlike the current sound's onset.
  private burstUnlike = 0;
  // Frames masked by a repeated sound, in total and as of the pause timer's last reset.
  private maskedTotal = 0;
  private maskedAtReset = 0;
  private burstOnset = 0;
  private burstLevel = 0;
  private burstOnsetAbove = 0;
  private prevAboveDb = 0;
  private readonly burstCorr: Float64Array;
  private readonly lastVoicedCorr: Float64Array;
  private revokePending = false;
  private readonly repProfiles: Float64Array;
  private readonly repOnsets: Float64Array;
  // Per remembered sound: its level above the noise at onset; the pause
  // timer's last reset before it began (and the masked-frame count then) and
  // the last reset it caused (-1: none); whether it started the turn; whether
  // it was found repeated, on what beat; its voiced length.
  private readonly repLevels: Float64Array;
  private readonly repPrevReset: Float64Array;
  private readonly repPrevMasked: Float64Array;
  private readonly repLastReset: Float64Array;
  private readonly repStarted: Uint8Array;
  private readonly repRevoked: Uint8Array;
  private readonly repBeat: Float64Array;
  private readonly repLength: Float64Array;
  private readonly repSims: Float64Array;
  private repNext = 0;
  private readonly repWindowFrames: number;
  private readonly repMinPeriodFrames: number;
  private readonly activeHistory: Uint8Array;
  private activeCount = 0;
  // Voiced frames above the noise among the last RESUME_WINDOW_FRAMES.
  private readonly resumeHistory = new Uint8Array(RESUME_WINDOW_FRAMES);
  private resumeCount = 0;
  private readonly resumeAfterFrames: number;
  private lastVoicedActiveFrame = -1_000_000;
  private speechAboveDb: number | null = null;
  private frames = 0;
  private spoken = false;
  private ended = false;
  private endReason: string | null = null;
  private lastActiveFrame = -1;
  // The last frame of the energy tail after it (see HANG_DB).
  private lastHangFrame = -1;
  private readonly hangFrames: number;
  // The last pause reset by the standard rules (not the weak-voice ones).
  private lastStrongFrame = -1_000_000;
  private readonly weakBridgeFrames: number;
  private startFrame = -1;
  // Diagnostics.
  private activeFrames = 0;
  private voicedFrames = 0;
  private speechDbSum = 0;
  private speechDbCount = 0;
  private maxPauseFrames = 0;
  private weakResets = 0;
  private repeatFrames = 0;
  private unstarts = 0;
  private readonly rateFallback: boolean;
  // Trace ring: per block a base level, per frame (level above base, voicing).
  private readonly traceBase: Int16Array;
  private readonly traceLevels: Uint8Array;
  private readonly traceVoicing: Uint8Array;
  private traceBlocks = 0;
  private blockFrame = 0;
  private readonly blockLevels = new Float64Array(TRACE_FRAMES_PER_BLOCK);
  private readonly blockVoicing = new Float64Array(TRACE_FRAMES_PER_BLOCK);

  constructor(opts: TurnEndOptions) {
    // Never throws: this runs inside the audio callback.
    let rate = Math.round(Number(opts.sampleRate));
    this.rateFallback = !(rate >= MIN_SAMPLE_RATE_HZ && rate <= MAX_SAMPLE_RATE_HZ);
    if (this.rateFallback) rate = FALLBACK_SAMPLE_RATE_HZ;
    this.rate = rate;
    this.preAvg = rate >= PRE_AVERAGE_FROM_HZ ? Math.floor(rate / PRE_AVERAGE_RATE_HZ) : 1;
    const rate0 = rate / this.preAvg;
    this.decim1 = Math.max(1, Math.floor(rate0 / WORK_RATE_HZ));
    const rate1 = rate0 / this.decim1;
    this.decim2 = Math.max(1, Math.round(rate1 / VOICING_RATE_HZ));
    const rate2 = rate1 / this.decim2;
    this.frameLen = Math.max(1, Math.round((rate1 * FRAME_MS) / 1000));
    this.frameMsExact = (this.frameLen / rate1) * 1000;
    const pauseMs = Number(opts.pauseMs);
    this.pauseFrames = Math.max(1, Math.round((Number.isFinite(pauseMs) ? pauseMs : DEFAULT_PAUSE_MS) / this.frameMsExact));

    const sections: Biquad[] = [
      butterworthSection('lp', rate0, BAND_HIGH_HZ, BUTTERWORTH4_Q[0]),
      butterworthSection('lp', rate0, BAND_HIGH_HZ, BUTTERWORTH4_Q[1]),
      butterworthSection('hp', rate1, BAND_LOW_HZ, BUTTERWORTH4_Q[0]),
      butterworthSection('hp', rate1, BAND_LOW_HZ, BUTTERWORTH4_Q[1]),
      // (kept below the voicing copy's Nyquist when that is ~3.7 kHz, at 22.05/44.1 kHz input)
      butterworthSection('lp', rate1, Math.min(VOICING_LOWPASS_HZ, rate2 * 0.45), BUTTERWORTH4_Q[0]),
      butterworthSection('lp', rate1, Math.min(VOICING_LOWPASS_HZ, rate2 * 0.45), BUTTERWORTH4_Q[1]),
      butterworthSection('hp', rate2, VOICING_HIGHPASS_HZ, Math.SQRT1_2),
    ];
    this.coef = new Float64Array(sections.length * 5);
    sections.forEach((s, i) => this.coef.set([s.b0, s.b1, s.b2, s.a1, s.a2], i * 5));
    this.st = new Float64Array(sections.length * 4);

    this.minLag = Math.max(2, Math.floor(rate2 / PITCH_MAX_HZ));
    this.maxLag = Math.ceil(rate2 / PITCH_MIN_HZ);
    this.vWin = Math.round((rate2 * VOICING_WINDOW_MS) / 1000);
    this.vRing = new Float64Array(this.vWin + this.maxLag);
    this.vLin = new Float64Array(this.vWin + this.maxLag);
    this.corr = new Float64Array(this.maxLag + 1);
    this.comp = new Float64Array(this.maxLag + 1);
    this.prevComp = new Float64Array(this.maxLag + 1);
    this.noiseProfile = new Float64Array(this.maxLag + 1);
    this.profileAlpha = Math.min(1, this.frameMsExact / NOISE_PROFILE_TC_MS);

    this.blockFrames = Math.max(1, Math.round(NOISE_BLOCK_MS / this.frameMsExact));
    this.blockMins = new Float64Array(NOISE_BLOCKS).fill(Infinity);
    this.noiseAlpha = Math.min(1, this.frameMsExact / NOISE_MEAN_TC_MS);
    this.quietFrames = Math.round(NOISE_QUIET_MS / this.frameMsExact);
    this.nearVoiceFrames = Math.round(ENERGY_NEAR_VOICE_MS / this.frameMsExact);
    this.guardFrames = Math.round(ECHO_GUARD_MS / this.frameMsExact);
    this.tailGapFrames = Math.round(ECHO_TAIL_GAP_MS / this.frameMsExact);
    this.tailMaxFrames = Math.round(ECHO_TAIL_MAX_MS / this.frameMsExact);
    this.tailNewSoundFrames = Math.round(ECHO_TAIL_NEW_SOUND_MS / this.frameMsExact);
    this.answerFromFrames = Math.round(ECHO_ANSWER_FROM_MS / this.frameMsExact);
    this.memoryCheckFrames = Math.round(MEMORY_CHECK_MS / this.frameMsExact);
    this.weakBridgeFrames = Math.round(WEAK_BRIDGE_MS / this.frameMsExact);
    const lags = this.maxLag - this.minLag + 1;
    this.repProfiles = new Float64Array(REPEAT_SLOTS * lags);
    this.repOnsets = new Float64Array(REPEAT_SLOTS).fill(-Infinity);
    this.repLevels = new Float64Array(REPEAT_SLOTS);
    this.repPrevReset = new Float64Array(REPEAT_SLOTS);
    this.repPrevMasked = new Float64Array(REPEAT_SLOTS);
    this.repLastReset = new Float64Array(REPEAT_SLOTS).fill(-1);
    this.repStarted = new Uint8Array(REPEAT_SLOTS);
    this.repRevoked = new Uint8Array(REPEAT_SLOTS);
    this.repBeat = new Float64Array(REPEAT_SLOTS);
    this.repLength = new Float64Array(REPEAT_SLOTS);
    this.repSims = new Float64Array(REPEAT_SLOTS);
    this.burstCorr = new Float64Array(this.maxLag + 1);
    this.lastVoicedCorr = new Float64Array(this.maxLag + 1);
    this.repWindowFrames = Math.round(REPEAT_WINDOW_MS / this.frameMsExact);
    this.repMinPeriodFrames = Math.round(REPEAT_MIN_PERIOD_MS / this.frameMsExact);
    this.recentLevels = new Float64Array(START_WINDOW_FRAMES).fill(Infinity);
    this.activeHistory = new Uint8Array(ACTIVE_WINDOW_FRAMES);
    this.resumeAfterFrames = Math.round(RESUME_AFTER_MS / this.frameMsExact);
    this.hangFrames = Math.round(HANG_MAX_MS / this.frameMsExact);
    this.traceBase = new Int16Array(TRACE_BLOCKS);
    this.traceLevels = new Uint8Array(TRACE_BLOCKS * TRACE_FRAMES_PER_BLOCK);
    this.traceVoicing = new Uint8Array(TRACE_BLOCKS * TRACE_FRAMES_PER_BLOCK);

    // Every field is checked: memory is plain data kept between turns, and a
    // bad value must cost only the head start, never an exception.
    const mem = opts.memory;
    const floor = mem && typeof mem === 'object' ? mem.floorDb : null;
    if (mem && mem.sampleRate === rate && typeof floor === 'number' && Number.isFinite(floor) && floor > NO_SIGNAL_DB && floor < 0) {
      // The last turn's floor stands in for one block: it ages out of the
      // window like any other block (so a car that got louder while the AI
      // was talking is re-learned within ~1.5 s -- or at MEMORY_CHECK_MS if it
      // got a lot louder, see MEMORY_STALE_DB), and any quieter frame of
      // this turn replaces it at once.
      this.blockMins[0] = floor;
      this.blockIndex = 1;
      this.memoryFloor = floor;
      this.memoryState = 'used';
      const mean = typeof mem.noiseDb === 'number' && Number.isFinite(mem.noiseDb) ? mem.noiseDb : floor;
      this.noiseMean = Math.min(floor + NOISE_MAX_ABOVE_FLOOR_DB, Math.max(floor, mean));
      this.noiseDb = this.noiseMean;
      // Stands in until this turn has NOISE_VOICING_MIN_COUNT noise frames.
      if (typeof mem.noiseVoicing === 'number' && Number.isFinite(mem.noiseVoicing)) {
        this.noiseVoicing = Math.min(1, Math.max(0, mem.noiseVoicing));
        this.noiseVoicingPeak = this.noiseVoicing;
        this.noiseVoicingCarried = true;
      }
      const prof = mem.noiseProfile;
      if (Array.isArray(prof) && prof.length === this.noiseProfile.length && prof.every((v) => typeof v === 'number' && Number.isFinite(v))) {
        this.noiseProfile.set(prof);
      }
    }
  }

  /**
   * The user has started talking this turn (a voiced syllable was heard).
   * Goes back to false if what started it turns out to be a repeated sound (a
   * turn signal, a chime -- see REPEAT_SIMILARITY).
   */
  get hasSpoken(): boolean {
    return this.spoken;
  }

  /** The turn should end (sticky once true). */
  get hasEnded(): boolean {
    return this.ended;
  }

  /**
   * Feeds mono int16 PCM of any length (buffers need not line up with
   * frames). Returns true once the turn should end -- after the user has
   * spoken and then paused for `pauseMs` -- and keeps returning true.
   */
  push(samples: Int16Array): boolean {
    // Everything the per-sample loop touches lives in locals while it runs
    // (Hermes interprets bytecode: a local is a register, a field or typed-
    // array element is a lookup) and is written back when a frame completes.
    const c = this.coef;
    const st = this.st;
    const c0 = c[0], c1 = c[1], c2 = c[2], c3 = c[3], c4 = c[4];
    const c5 = c[5], c6 = c[6], c7 = c[7], c8 = c[8], c9 = c[9];
    const c10 = c[10], c11 = c[11], c12 = c[12], c13 = c[13], c14 = c[14];
    const c15 = c[15], c16 = c[16], c17 = c[17], c18 = c[18], c19 = c[19];
    const c20 = c[20], c21 = c[21], c22 = c[22], c23 = c[23], c24 = c[24];
    const c25 = c[25], c26 = c[26], c27 = c[27], c28 = c[28], c29 = c[29];
    const c30 = c[30], c31 = c[31], c32 = c[32], c33 = c[33], c34 = c[34];
    let a1 = st[0], a2 = st[1], a3 = st[2], a4 = st[3];
    let b1 = st[4], b2 = st[5], b3 = st[6], b4 = st[7];
    let h1 = st[8], h2 = st[9], h3 = st[10], h4 = st[11];
    let g1 = st[12], g2 = st[13], g3 = st[14], g4 = st[15];
    let l1 = st[16], l2 = st[17], l3 = st[18], l4 = st[19];
    let m1 = st[20], m2 = st[21], m3 = st[22], m4 = st[23];
    let p1 = st[24], p2 = st[25], p3 = st[26], p4 = st[27];
    const preAvg = this.preAvg;
    const decim1 = this.decim1;
    const decim2 = this.decim2;
    const frameLen = this.frameLen;
    const ring = this.vRing;
    const ringLen = ring.length;
    let preSum = this.preSum;
    let preCount = this.preCount;
    let phase1 = this.decimPhase1;
    let phase2 = this.decimPhase2;
    let frameCount = this.frameCount;
    let frameEnergy = this.frameEnergy;
    let vPos = this.vPos;
    let vFilled = this.vFilled;
    const n = samples.length;
    for (let i = 0; i < n; i++) {
      let x = samples[i];
      if (preAvg > 1) {
        preSum += x;
        if (++preCount < preAvg) continue;
        x = preSum / preAvg;
        preSum = 0;
        preCount = 0;
      }
      // Anti-alias low-pass (two sections).
      let y = c0 * x + c1 * a1 + c2 * a2 - c3 * a3 - c4 * a4;
      a2 = a1; a1 = x; a4 = a3; a3 = y;
      x = y;
      y = c5 * x + c6 * b1 + c7 * b2 - c8 * b3 - c9 * b4;
      b2 = b1; b1 = x; b4 = b3; b3 = y;
      if (++phase1 < decim1) continue;
      phase1 = 0;
      // Speech-band high-pass at the work rate (two sections).
      x = y;
      y = c10 * x + c11 * h1 + c12 * h2 - c13 * h3 - c14 * h4;
      h2 = h1; h1 = x; h4 = h3; h3 = y;
      x = y;
      y = c15 * x + c16 * g1 + c17 * g2 - c18 * g3 - c19 * g4;
      g2 = g1; g1 = x; g4 = g3; g3 = y;
      const band = y;
      frameEnergy += band * band;
      // Voicing copy: low-pass, keep every decim2-th sample, high-pass.
      x = band;
      y = c20 * x + c21 * l1 + c22 * l2 - c23 * l3 - c24 * l4;
      l2 = l1; l1 = x; l4 = l3; l3 = y;
      x = y;
      y = c25 * x + c26 * m1 + c27 * m2 - c28 * m3 - c29 * m4;
      m2 = m1; m1 = x; m4 = m3; m3 = y;
      if (++phase2 >= decim2) {
        phase2 = 0;
        x = y;
        y = c30 * x + c31 * p1 + c32 * p2 - c33 * p3 - c34 * p4;
        p2 = p1; p1 = x; p4 = p3; p3 = y;
        ring[vPos] = y;
        vPos = vPos + 1 === ringLen ? 0 : vPos + 1;
        if (vFilled < ringLen) vFilled++;
      }
      if (++frameCount >= frameLen) {
        const energy = frameEnergy / frameLen;
        frameCount = 0;
        frameEnergy = 0;
        this.vPos = vPos;
        this.vFilled = vFilled;
        const levelDb = energy > 0 ? 10 * Math.log10(energy / FULL_SCALE_SQ) : -200;
        const voicing = this.voicing(levelDb);
        this.decide(levelDb, voicing);
        this.recordTrace(levelDb, voicing);
      }
    }
    st[0] = a1; st[1] = a2; st[2] = a3; st[3] = a4;
    st[4] = b1; st[5] = b2; st[6] = b3; st[7] = b4;
    st[8] = h1; st[9] = h2; st[10] = h3; st[11] = h4;
    st[12] = g1; st[13] = g2; st[14] = g3; st[15] = g4;
    st[16] = l1; st[17] = l2; st[18] = l3; st[19] = l4;
    st[20] = m1; st[21] = m2; st[22] = m3; st[23] = m4;
    st[24] = p1; st[25] = p2; st[26] = p3; st[27] = p4;
    this.preSum = preSum;
    this.preCount = preCount;
    this.decimPhase1 = phase1;
    this.decimPhase2 = phase2;
    this.frameCount = frameCount;
    this.frameEnergy = frameEnergy;
    this.vPos = vPos;
    this.vFilled = vFilled;
    return this.ended;
  }

  /** Noise estimates to hand to the next turn's detector. */
  memory(): TurnEndMemory {
    return {
      sampleRate: this.rate,
      floorDb: Number.isFinite(this.currentFloor()) ? Math.round(this.currentFloor() * 10) / 10 : null,
      noiseDb: this.noiseDb === null ? null : Math.round(this.noiseDb * 10) / 10,
      // (At its most periodic this turn: an engine drifts in and out of it.)
      noiseVoicing: Math.round(Math.max(this.noiseVoicing, this.noiseVoicingPeak) * 1000) / 1000,
      noiseProfile: Array.from(this.noiseProfile, (v) => Math.round(v * 1000) / 1000),
    };
  }

  /** A few numbers for one perf-log line: why this turn ended (or didn't). */
  diagnostics(): Record<string, number | string | null> {
    const ms = (frames: number) => Math.round(frames * this.frameMsExact);
    const noise = this.noiseDb;
    const speech = this.speechDbCount > 0 ? this.speechDbSum / this.speechDbCount : null;
    return {
      rate: this.rate,
      audioMs: ms(this.frames),
      startMs: this.startFrame >= 0 ? ms(this.startFrame) : null,
      speechMs: ms(this.activeFrames),
      voicedMs: ms(this.voicedFrames),
      longestPauseMs: ms(this.maxPauseFrames),
      edgeMs: this.spoken ? ms(this.edgeFrames()) : null,
      noiseDb: noise === null ? null : Math.round(noise),
      speechDb: speech === null ? null : Math.round(speech),
      snrDb: speech === null || noise === null ? null : Math.round(speech - noise),
      noiseVoicing: Math.round(this.noiseVoicing * 100) / 100,
      // Pause resets from the weak-voice rules; voiced frames discounted as a repeated sound.
      weakResets: this.weakResets,
      repeatMs: ms(this.repeatFrames),
      unstarts: this.unstarts,
      memory: this.memoryState,
      ...(this.rateFallback ? { rateFallback: 1 } : {}),
      ended: this.endReason,
    };
  }

  /**
   * Compact trace of the last ~60 s for logcat, one 12-char entry per 100 ms:
   * 2 base-36 chars = the lowest frame level in the block (dBFS + 130), then
   * per 20 ms frame 2 base-64 chars = half-dB steps above that level (0-63)
   * and voicing (0-63 = 0.0-1.0); the last entry may hold fewer frames.
   * Prefixed with "v2:<frameMs>:<first block index>:".
   * About 7.2k chars at 60 s -- split it across log lines. replay() runs the
   * decision logic on it again, so a real drive can be re-analyzed offline.
   */
  trace(): string {
    const n = Math.min(this.traceBlocks, TRACE_BLOCKS);
    const first = this.traceBlocks - n;
    let out = `v2:${this.frameMsExact.toFixed(3)}:${first}:`;
    for (let b = first; b < this.traceBlocks; b++) {
      const slot = b % TRACE_BLOCKS;
      out += this.traceBase[slot].toString(36).padStart(2, '0');
      for (let f = 0; f < TRACE_FRAMES_PER_BLOCK; f++) {
        const k = slot * TRACE_FRAMES_PER_BLOCK + f;
        out += TRACE_ALPHABET[this.traceLevels[k]] + TRACE_ALPHABET[this.traceVoicing[k]];
      }
    }
    // The block still being filled.
    if (this.blockFrame > 0) {
      let lo = Infinity;
      for (let f = 0; f < this.blockFrame; f++) lo = Math.min(lo, this.blockLevels[f]);
      const base = this.traceBaseOf(lo);
      out += base.toString(36).padStart(2, '0');
      for (let f = 0; f < this.blockFrame; f++) {
        out += TRACE_ALPHABET[this.traceLevelCode(this.blockLevels[f], base)];
        out += TRACE_ALPHABET[this.traceVoicingCode(this.blockVoicing[f])];
      }
    }
    return out;
  }

  /**
   * Re-runs the decision logic on a trace() string (frame levels and
   * voicing as recorded), for offline analysis of a real drive. Returns the
   * replaying detector, whose hasSpoken / hasEnded / diagnostics() tell what
   * it would have decided with `pauseMs`. The trace holds a repeated sound's
   * frames as unvoiced (as the live decision saw them), but not the pause
   * resets taken back in hindsight nor its frames' hold on the pause timer --
   * with a turn signal on, the replay may end later than the live turn did.
   */
  static replay(trace: string, opts: TurnEndOptions): TurnEndDetector {
    const parts = trace.split(':');
    const det = new TurnEndDetector(opts);
    const body = parts[3] ?? '';
    const per = 2 + TRACE_FRAMES_PER_BLOCK * 2;
    for (let b = 0; b + 4 <= body.length; b += per) {
      const base = parseInt(body.slice(b, b + 2), 36) - TRACE_LEVEL_OFFSET_DB;
      for (let f = 0; f < TRACE_FRAMES_PER_BLOCK && b + 3 + f * 2 < body.length; f++) {
        const level = base + TRACE_ALPHABET.indexOf(body[b + 2 + f * 2]) * TRACE_LEVEL_STEP_DB;
        const voicing = TRACE_ALPHABET.indexOf(body[b + 3 + f * 2]) / 63;
        det.decide(level, voicing);
      }
    }
    return det;
  }

  // ---- per frame ----

  /**
   * Noise-compensated normalized autocorrelation over the pitch lags on the
   * last VOICING_WINDOW_MS of the ~4 kHz copy, combined with the previous
   * frame's (see below). Also learns the noise's own periodicity profile on
   * frames at the noise level.
   */
  private voicing(levelDb: number): number {
    if (this.vFilled < this.vRing.length) return 0;
    const len = this.vRing.length;
    const lin = this.vLin;
    // Unroll the ring into a linear buffer, oldest first.
    for (let i = 0, p = this.vPos; i < len; i++) {
      lin[i] = this.vRing[p];
      p = p + 1 === len ? 0 : p + 1;
    }
    const n = this.vWin;
    const minLag = this.minLag;
    const maxLag = this.maxLag;
    // Window = the newest n samples; lagged copies reach back maxLag.
    const base = maxLag;
    let e0 = 0;
    for (let i = 0; i < n; i++) e0 += lin[base + i] * lin[base + i];
    // Energy of the lagged segment lin[base - lag .. base - lag + n).
    let eLag = 0;
    for (let i = base - minLag; i < base - minLag + n; i++) eLag += lin[i] * lin[i];
    const corr = this.corr;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (lag > minLag) {
        // Slide the lagged segment one sample back.
        const add = lin[base - lag];
        const drop = lin[base - lag + n];
        eLag += add * add - drop * drop;
      }
      // Unrolled by 4 (fewer loop-control instructions for the interpreter).
      let acc = 0;
      let j = base;
      let k = base - lag;
      const end4 = base + (n & ~3);
      while (j < end4) {
        acc += lin[j] * lin[k] + lin[j + 1] * lin[k + 1] + lin[j + 2] * lin[k + 2] + lin[j + 3] * lin[k + 3];
        j += 4;
        k += 4;
      }
      while (j < base + n) acc += lin[j++] * lin[k++];
      const denom = Math.sqrt(e0 * Math.max(eLag, 0));
      corr[lag] = denom > 0 ? acc / denom : 0;
    }
    // Share of this frame's energy the noise alone accounts for.
    const noiseDb = this.noiseDb;
    const noiseShare = noiseDb === null ? 0 : Math.min(1, Math.pow(10, (noiseDb - levelDb) / 10));
    const profile = this.noiseProfile;
    // Two-frame voicing: this frame's periodicity at a lag, averaged with the
    // previous frame's at the same lag +-1 sample. A voice's pitch moves only
    // a few percent in 20 ms, so its peak lines up across frames; the chance
    // peaks of noise don't. Averaging two frames that agree on the pitch
    // halves the noise's chance correlation while keeping the voice's.
    const comp = this.comp;
    const prev = this.prevComp;
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) comp[lag] = corr[lag] - noiseShare * profile[lag];
    for (let lag = minLag; lag <= maxLag; lag++) {
      let p = prev[lag];
      if (lag > minLag && prev[lag - 1] > p) p = prev[lag - 1];
      if (lag < maxLag && prev[lag + 1] > p) p = prev[lag + 1];
      const v = (comp[lag] + p) / 2;
      if (v > best) best = v;
    }
    this.comp = prev;
    this.prevComp = comp;
    // Learn the noise's periodicity only from frames at the noise level.
    if (noiseDb !== null && levelDb < noiseDb + VOICED_MARGIN_DB) {
      const a = this.profileAlpha;
      for (let lag = minLag; lag <= maxLag; lag++) profile[lag] += a * (corr[lag] - profile[lag]);
    }
    // A voiced sound that repeats an earlier one on a timer counts as unvoiced
    // (see REPEAT_SIMILARITY). A "sound" is a run of voiced frames with gaps
    // under BURST_GAP_FRAMES, split where it turns into a different sound
    // (two voiced frames in a row unlike its onset: a voice running on from a
    // tick, or a tick right after a stray noise blip). Its lag profile is the
    // sum of its first two voiced frames' (the first alone still overlaps the
    // silence before a tick's onset), its level the loudest of those and the
    // frame before (a tick is voiced only from its second frame).
    const aboveDb = noiseDb === null ? 0 : levelDb - noiseDb;
    const bc = this.burstCorr;
    const lc = this.lastVoicedCorr;
    if (best >= this.voicedThreshold()) {
      if (!this.inBurst) {
        this.beginBurst(this.frames, Math.max(aboveDb, this.prevAboveDb));
        this.burstOnsetAbove = this.prevAboveDb;
      }
      this.burstGap = 0;
      this.burstVoiced++;
      if (aboveDb > this.burstLevel) this.burstLevel = aboveDb;
      if (this.burstVoiced === 1) {
        for (let lag = minLag; lag <= maxLag; lag++) bc[lag] = corr[lag];
      } else if (this.burstVoiced === 2) {
        for (let lag = minLag; lag <= maxLag; lag++) bc[lag] += corr[lag];
        this.burstRepeat = this.isRepeatedSound();
        // (A tick is loudest at its onset, the frame before it reads voiced.)
        if (this.burstRepeat && this.burstOnsetAbove > REPEAT_MASK_DB) this.maskedTotal++;
      } else if (this.burstSlot >= 0) {
        this.burstUnlike = this.profileSimilarity(corr, this.burstSlot) < REPEAT_SIMILARITY_ON_BEAT ? this.burstUnlike + 1 : 0;
        if (this.burstUnlike >= 2) {
          // A different sound from the previous frame on.
          this.burstVoiced -= 2;
          this.endBurst(this.frames - 1);
          this.beginBurst(this.frames - 1, Math.max(aboveDb, this.prevAboveDb));
          this.burstVoiced = 2;
          this.burstLevel = Math.max(this.burstLevel, aboveDb);
          for (let lag = minLag; lag <= maxLag; lag++) bc[lag] = lc[lag] + corr[lag];
          this.burstRepeat = this.isRepeatedSound();
        }
      }
      for (let lag = minLag; lag <= maxLag; lag++) lc[lag] = corr[lag];
    } else if (this.inBurst && ++this.burstGap >= BURST_GAP_FRAMES) {
      this.endBurst(this.frames);
    }
    this.prevAboveDb = aboveDb;
    if (this.inBurst && this.burstRepeat) {
      if (this.burstVoiced + this.burstGap <= this.burstRepeatFrames) {
        this.repeatFrames++;
        this.maskedTotal++;
        return 0;
      }
      this.burstRepeat = false;
      if (this.burstSlot >= 0) this.repRevoked[this.burstSlot] = 0;
    }
    return best;
  }

  /** Starts remembering a voiced sound (its slot takes its resets from now on). */
  private beginBurst(onset: number, levelDb: number): void {
    this.inBurst = true;
    this.burstRepeat = false;
    this.burstVoiced = 0;
    this.burstGap = 0;
    this.burstUnlike = 0;
    this.burstLevel = levelDb;
    this.burstOnset = onset;
    const slot = this.repNext;
    this.repNext = (slot + 1) % REPEAT_SLOTS;
    // Matched against only once its profile is in (isRepeatedSound()).
    this.repOnsets[slot] = -Infinity;
    this.repPrevReset[slot] = this.lastActiveFrame;
    this.repPrevMasked[slot] = this.maskedAtReset;
    this.repLastReset[slot] = -1;
    this.repStarted[slot] = 0;
    this.repRevoked[slot] = 0;
    this.repBeat[slot] = 0;
    this.repLength[slot] = Infinity;
    this.burstSlot = slot;
  }

  private endBurst(frame: number): void {
    this.inBurst = false;
    // A one-frame sound (a short tick in noise) is checked now, on that frame
    // alone: if it repeats a beat, the resets it caused are taken back.
    if (this.burstSlot >= 0 && this.burstVoiced === 1) {
      const bc = this.burstCorr;
      const lc = this.lastVoicedCorr;
      for (let lag = this.minLag; lag <= this.maxLag; lag++) bc[lag] = lc[lag];
      if (this.isRepeatedSound()) this.repeatFrames++;
    }
    if (this.burstSlot >= 0) this.repLength[this.burstSlot] = this.burstVoiced;
    this.lastBurstSlot = this.burstSlot;
    this.lastBurstEnd = frame;
    this.burstSlot = -1;
  }

  /**
   * Called at the second voiced frame of a sound (burstCorr, burstLevel,
   * burstOnset, burstSlot set): compares its lag profile and level with the
   * last REPEAT_SLOTS sounds and remembers it. True if it repeats a beat (see
   * REPEAT_SIMILARITY); every remembered sound on that beat is then marked for
   * revoking (see revokeRepeats()).
   */
  private isRepeatedSound(): boolean {
    const corr = this.burstCorr;
    const aboveDb = this.burstLevel;
    const minLag = this.minLag;
    const lags = this.maxLag - minLag + 1;
    let mean = 0;
    for (let i = 0; i < lags; i++) mean += corr[minLag + i];
    mean /= lags;
    let norm = 0;
    for (let i = 0; i < lags; i++) norm += (corr[minLag + i] - mean) * (corr[minLag + i] - mean);
    norm = Math.sqrt(norm);
    const frame = this.burstOnset;
    const onsets = this.repOnsets;
    const profiles = this.repProfiles;
    const sims = this.repSims;
    const tol = REPEAT_TOLERANCE_FRAMES;
    // Similarity to each remembered sound in the window (-1: out of window,
    // or a different level).
    for (let s = 0; s < REPEAT_SLOTS; s++) {
      sims[s] = -1;
      if (norm === 0 || frame - onsets[s] > this.repWindowFrames || Math.abs(this.repLevels[s] - aboveDb) > REPEAT_LEVEL_DB) continue;
      let dot = 0;
      for (let i = 0, o = s * lags; i < lags; i++, o++) dot += (corr[minLag + i] - mean) * profiles[o];
      sims[s] = dot / norm;
    }
    let beat = 0;
    // A sound already found repeated, one to three of its beats back.
    for (let s = 0; s < REPEAT_SLOTS && beat === 0; s++) {
      if (this.repBeat[s] > 0 && sims[s] >= REPEAT_SIMILARITY_ON_BEAT && this.onBeat(frame - onsets[s], this.repBeat[s])) beat = this.repBeat[s];
    }
    // Or two matching sounds that keep one beat with this one.
    for (let a = 0; a < REPEAT_SLOTS && beat === 0; a++) {
      if (sims[a] < REPEAT_SIMILARITY) continue;
      const interval = frame - onsets[a];
      if (interval < this.repMinPeriodFrames) continue;
      for (let b = 0; b < REPEAT_SLOTS; b++) {
        if (b === a || sims[b] < REPEAT_SIMILARITY) continue;
        const gap = onsets[a] - onsets[b];
        if (gap < this.repMinPeriodFrames) continue;
        if (Math.abs(gap - interval) <= tol || Math.abs(gap - 2 * interval) <= tol || Math.abs(2 * gap - interval) <= tol) {
          beat = Math.min(gap, interval);
          break;
        }
      }
    }
    if (beat > 0) {
      // Every remembered sound like it on the same beat was the same thing.
      let longest = 0;
      for (let s = 0; s < REPEAT_SLOTS; s++) {
        if (sims[s] < REPEAT_SIMILARITY_ON_BEAT || !this.onBeat(frame - onsets[s], beat)) continue;
        this.repRevoked[s] = 1;
        if (this.repBeat[s] === 0) this.repBeat[s] = beat;
        if (Number.isFinite(this.repLength[s])) longest = Math.max(longest, this.repLength[s]);
      }
      // This one is discounted for about as long as those lasted.
      this.burstRepeatFrames = Math.ceil(longest * REPEAT_LENGTH_FACTOR) + BURST_GAP_FRAMES;
    }
    // Remember this sound (mean-removed, unit norm) in its slot.
    const s = this.burstSlot;
    onsets[s] = norm > 0 ? frame : -Infinity;
    for (let i = 0, o = s * lags; i < lags; i++, o++) profiles[o] = norm > 0 ? (corr[minLag + i] - mean) / norm : 0;
    this.repLevels[s] = aboveDb;
    this.repRevoked[s] = beat > 0 ? 1 : 0;
    this.repBeat[s] = beat;
    if (beat > 0) this.revokePending = true;
    return beat > 0;
  }

  /** Similarity of this frame's lag profile to a remembered sound's (-1..1). */
  private profileSimilarity(corr: Float64Array, slot: number): number {
    const minLag = this.minLag;
    const lags = this.maxLag - minLag + 1;
    let mean = 0;
    for (let i = 0; i < lags; i++) mean += corr[minLag + i];
    mean /= lags;
    let norm = 0;
    let dot = 0;
    const profiles = this.repProfiles;
    for (let i = 0, o = slot * lags; i < lags; i++, o++) {
      const x = corr[minLag + i] - mean;
      norm += x * x;
      dot += x * profiles[o];
    }
    return norm > 0 ? dot / Math.sqrt(norm) : 0;
  }

  /** `interval` is 1-3 beats (tolerance growing a frame per beat). */
  private onBeat(interval: number, beat: number): boolean {
    const k = Math.round(interval / beat);
    return k >= 1 && k <= 3 && Math.abs(interval - k * beat) <= REPEAT_TOLERANCE_FRAMES + k - 1;
  }

  /**
   * Takes back the pause resets that repeated sounds caused, most recent
   * first, as long as the timer's last reset is one of theirs; un-starts the
   * turn if only they started it.
   */
  private revokeRepeats(): void {
    this.revokePending = false;
    for (let pass = 0; pass < REPEAT_SLOTS; pass++) {
      let found = -1;
      for (let s = 0; s < REPEAT_SLOTS; s++) {
        if (this.repRevoked[s] && this.repLastReset[s] >= 0 && this.repLastReset[s] === this.lastActiveFrame) found = s;
      }
      if (found < 0) break;
      this.lastActiveFrame = this.repPrevReset[found];
      this.lastHangFrame = -1;
      this.maskedAtReset = this.repPrevMasked[found];
      this.repLastReset[found] = -1;
      if (this.spoken && this.repStarted[found] && this.lastActiveFrame < this.startFrame) {
        this.spoken = false;
        this.startFrame = -1;
        this.lastActiveFrame = -1;
        this.unstarts++;
        break;
      }
    }
  }

  /** Voicing a frame needs (before the level-consistency check) to count as voiced. */
  private voicedThreshold(): number {
    return Math.max(VOICED_MIN_CORRELATION, this.noiseVoicing + VOICED_ABOVE_NOISE);
  }

  private decide(levelDb: number, voicing: number): void {
    const frame = this.frames++;
    if (this.ended) return;
    // Median of the last MEDIAN_FRAMES frame levels.
    const ll = this.lastLevels;
    ll[this.levelCount % MEDIAN_FRAMES] = levelDb;
    this.levelCount++;
    const k = Math.min(this.levelCount, MEDIAN_FRAMES);
    let smoothed = levelDb;
    if (k === 3) {
      const a = ll[0], b = ll[1], c = ll[2];
      smoothed = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    } else if (k === 2) {
      smoothed = Math.min(ll[0], ll[1]);
    }

    let active = false;
    let voicedActive = false;
    let startVoiced = false;
    let frameAbove = -Infinity;
    const w = frame % WEAK_AVG_FRAMES;
    this.weakVoicing[w] = voicing;
    this.weakAbove[w] = -30;
    this.weakVoiced[w] = 0;
    if (smoothed > NO_SIGNAL_DB) {
      if (smoothed < this.turnMinLevel) this.turnMinLevel = smoothed;
      const noise = this.noiseDb ?? smoothed + NOISE_INITIAL_ABOVE_FLOOR_DB;
      const above = smoothed - noise;
      frameAbove = above;
      // Voicing consistent with how far above the noise the frame is.
      const need = Math.max(this.voicedThreshold(), VOICED_AT_HIGH_SNR * (1 - Math.pow(10, -Math.max(0, above) / 10)));
      const voiced = voicing >= need || (this.noiseVoicing >= TONAL_NOISE_VOICING && above > TONAL_MARGIN_DB);
      voicedActive = voiced && above > VOICED_MARGIN_DB;
      const recent = this.recentLevels;
      recent[frame % START_WINDOW_FRAMES] = smoothed;
      let recentMin = Infinity;
      for (let i = 0; i < START_WINDOW_FRAMES; i++) if (recent[i] < recentMin) recentMin = recent[i];
      startVoiced = voiced && above > START_MARGIN_DB && smoothed - recentMin > START_RISE_DB;
      if (voicedActive) {
        this.lastVoicedActiveFrame = frame;
        this.speechAboveDb = this.speechAboveDb === null ? above : this.speechAboveDb + 0.02 * (above - this.speechAboveDb);
      }
      const loud = above > ENERGY_MARGIN_DB;
      active = voicedActive || (loud && frame - this.lastVoicedActiveFrame <= this.nearVoiceFrames);
      const quiet = !loud && !voicedActive && frame - this.lastVoicedActiveFrame > this.quietFrames;
      // How periodic the noise alone looks (voicing 0: not measured, or a
      // repeated mechanical sound).
      if (quiet && above < NOISE_VOICING_MAX_ABOVE_DB && voicing > 0) this.learnNoiseVoicing(voicing);
      this.updateNoise(smoothed, quiet);
      this.weakAbove[w] = levelDb - noise;
      this.weakVoiced[w] = voiced ? 1 : 0;
    }
    if (frame === this.memoryCheckFrames - 1) this.checkStaleMemory();
    if (this.echoTail) this.trackEchoTail(frame, voicing, smoothed);

    // Start: a voiced syllable, after the echo guard.
    if (startVoiced) {
      this.startRun = this.startGap > START_GAP_FRAMES ? 1 : this.startRun + 1;
      this.startGap = 0;
    } else {
      this.startGap++;
    }
    const sSlot = frame % START_WINDOW_FRAMES;
    this.startCount += (startVoiced ? 1 : 0) - this.startHistory[sSlot];
    this.startHistory[sSlot] = startVoiced ? 1 : 0;
    if (startVoiced && this.startRun >= START_SOUND_FRAMES) this.soundStartFrame = frame;
    if (
      !this.spoken &&
      startVoiced &&
      (!this.echoTail || (this.tailCandidate && frame >= this.answerFromFrames)) &&
      this.startCount >= START_VOICED_FRAMES &&
      frame - this.soundStartFrame < START_WINDOW_FRAMES
    ) {
      this.spoken = true;
      this.startFrame = frame;
      this.lastActiveFrame = frame;
      this.lastStrongFrame = frame;
      this.maskedAtReset = this.maskedTotal;
      if (this.burstSlot >= 0) this.repStarted[this.burstSlot] = 1;
    }

    const aSlot = frame % ACTIVE_WINDOW_FRAMES;
    this.activeCount += (active ? 1 : 0) - this.activeHistory[aSlot];
    this.activeHistory[aSlot] = active ? 1 : 0;
    const rSlot = frame % RESUME_WINDOW_FRAMES;
    const rVal = (voicedActive ? 1 : 0) + (active ? 16 : 0);
    this.resumeCount += rVal - this.resumeHistory[rSlot];
    this.resumeHistory[rSlot] = rVal;
    if (!this.spoken) {
      this.revokePending = false;
      return;
    }
    if (active) {
      this.activeFrames++;
      this.speechDbSum += smoothed;
      this.speechDbCount++;
    }
    if (voicedActive) this.voicedFrames++;
    if (
      active &&
      this.activeCount >= ACTIVE_MIN_FRAMES &&
      (frame - this.lastActiveFrame <= this.resumeAfterFrames || (this.resumeCount & 15) >= RESUME_VOICED_FRAMES || this.resumeCount >> 4 >= RESUME_ACTIVE_FRAMES)
    ) {
      this.lastActiveFrame = frame;
      this.lastStrongFrame = frame;
    } else if (frame - this.lastStrongFrame <= this.weakBridgeFrames && this.weakVoice(frame)) {
      this.lastActiveFrame = frame;
      this.weakResets++;
    }
    if (this.lastActiveFrame === frame) {
      this.maskedAtReset = this.maskedTotal;
      const slot = this.burstSlot >= 0 ? this.burstSlot : frame - this.lastBurstEnd <= WEAK_AVG_FRAMES ? this.lastBurstSlot : -1;
      if (slot >= 0) this.repLastReset[slot] = frame;
    }
    if (this.revokePending) {
      this.revokeRepeats();
      if (!this.spoken) return;
    }
    if (
      frameAbove > HANG_DB &&
      Math.max(this.lastActiveFrame, this.lastHangFrame) === frame - 1 &&
      frame - this.lastActiveFrame <= this.hangFrames
    ) {
      this.lastHangFrame = frame;
    }
    // Frames a repeated sound masked don't count as pause.
    const pause = frame - Math.max(this.lastActiveFrame, this.lastHangFrame) - (this.maskedTotal - this.maskedAtReset);
    if (pause > this.maxPauseFrames) this.maxPauseFrames = pause;
    if (pause >= this.pauseFrames + this.edgeFrames()) {
      this.ended = true;
      this.endReason = 'pause';
    }
  }

  /** The allowance for phrase edges the detector can't hear (see EDGE_BASE_MS), in frames. */
  private edgeFrames(): number {
    const above = this.speechAboveDb ?? EDGE_REF_DB;
    const ms = Math.min(EDGE_MAX_MS, EDGE_BASE_MS + EDGE_PER_DB_MS * Math.max(0, EDGE_REF_DB - above));
    return Math.round(ms / this.frameMsExact);
  }

  /** Follows the AI reply's tail at the stream start (see ECHO_TAIL_GAP_MS). */
  private trackEchoTail(frame: number, voicing: number, levelDb: number): void {
    // (The level against the carried noise level or, if the car has got
    // louder since, this turn's quietest frame so far.)
    const loud = this.memoryFloor !== null && this.noiseDb !== null && levelDb > Math.max(this.noiseDb, this.turnMinLevel) + ECHO_TAIL_LEVEL_DB;
    const voiced = loud || voicing >= this.voicedThreshold();
    if (voiced && this.tailSeen && this.tailGap >= this.tailNewSoundFrames) {
      // A new sound after a pause: maybe the user's answer. Only its own
      // frames count toward a start (see ECHO_TAIL_NEW_SOUND_MS).
      this.tailCandidate = true;
      this.forgetStart();
    } else if (!voiced && this.tailGap + 1 >= this.tailNewSoundFrames) {
      this.tailCandidate = false;
    }
    this.tailGap = voiced ? 0 : this.tailGap + 1;
    if (frame < this.guardFrames) {
      if (voiced) this.tailSeen = true;
      return;
    }
    if (this.tailSeen && this.tailGap < this.tailGapFrames && frame < this.tailMaxFrames) return;
    this.echoTail = false;
    // A voice still going at ECHO_TAIL_MAX_MS is the user's (who answered at
    // once): it starts the turn as it stands. Otherwise what the tail added
    // toward a start is forgotten.
    if (this.tailSeen && this.tailGap < this.tailGapFrames) return;
    this.forgetStart();
  }

  /** Forgets the voiced frames counted toward a start. */
  private forgetStart(): void {
    this.startHistory.fill(0);
    this.startCount = 0;
    this.startRun = 0;
    this.soundStartFrame = -1_000_000;
  }

  /** The weak-voice rules (see WEAK_RUN_FRAMES) on the last frames. */
  private weakVoice(frame: number): boolean {
    if (Math.max(this.noiseVoicing, this.noiseVoicingPeak) >= WEAK_VOICE_MAX_NOISE_VOICING || frame < WEAK_AVG_FRAMES) return false;
    let runAbove = 0;
    let run = true;
    for (let i = 0; i < WEAK_RUN_FRAMES; i++) {
      const j = (frame - i) % WEAK_AVG_FRAMES;
      if (!this.weakVoiced[j]) {
        run = false;
        break;
      }
      runAbove += this.weakAbove[j];
    }
    if (run && runAbove / WEAK_RUN_FRAMES > WEAK_RUN_MIN_ABOVE_DB) return true;
    const nv = this.noiseVoicing;
    let v = 0;
    let above = 0;
    let over = 0;
    let voiced = 0;
    for (let j = 0; j < WEAK_AVG_FRAMES; j++) {
      v += this.weakVoicing[j];
      above += this.weakAbove[j];
      if (this.weakVoicing[j] > nv) over++;
      voiced += this.weakVoiced[j];
    }
    return voiced > 0 && over >= WEAK_AVG_MIN_OVER && v / WEAK_AVG_FRAMES - nv > WEAK_AVG_MIN_EXCESS && above / WEAK_AVG_FRAMES > WEAK_AVG_MIN_ABOVE_DB;
  }

  /** Updates the noise's 90th-percentile voicing (and its peak) with a noise frame's voicing. */
  private learnNoiseVoicing(voicing: number): void {
    if (this.nvCount < NOISE_VOICING_WINDOW) this.nvCount++;
    const carried = this.noiseVoicingCarried;
    // While the last turn's value is on trial: this turn's noise frames so far.
    if (carried) this.nvHist[Math.min(NOISE_VOICING_BINS - 1, Math.max(0, Math.floor(voicing * NOISE_VOICING_BINS)))]++;
    if (this.nvCount < NOISE_VOICING_MIN_COUNT) return;
    const q = NOISE_VOICING_QUANTILE;
    this.noiseVoicing += voicing > this.noiseVoicing ? NOISE_VOICING_STEP * q : -NOISE_VOICING_STEP * (1 - q);
    if (carried) {
      // Held to their 90th percentile (the value with 10% at or above it).
      const top = Math.ceil((1 - q) * this.nvCount);
      let cum = 0;
      for (let b = NOISE_VOICING_BINS - 1; b >= 0; b--) {
        cum += this.nvHist[b];
        if (cum >= top) {
          this.noiseVoicing = Math.min(this.noiseVoicing, (b + 0.5) / NOISE_VOICING_BINS);
          break;
        }
      }
      this.noiseVoicingPeak = this.noiseVoicing;
      if (this.nvCount >= NOISE_VOICING_WINDOW) this.noiseVoicingCarried = false;
    } else if (this.noiseVoicing > this.noiseVoicingPeak) {
      this.noiseVoicingPeak = this.noiseVoicing;
    }
  }

  /** At the end of the echo guard: drops the last turn's noise estimates if the car got a lot louder. */
  private checkStaleMemory(): void {
    if (this.memoryFloor === null || !(this.turnMinLevel > this.memoryFloor + MEMORY_STALE_DB)) return;
    for (let i = 0; i < NOISE_BLOCKS; i++) if (this.blockMins[i] === this.memoryFloor) this.blockMins[i] = Infinity;
    this.memoryFloor = null;
    this.memoryState = 'dropped';
    const floor = this.currentFloor();
    this.noiseMean = Number.isFinite(floor) ? floor + NOISE_INITIAL_ABOVE_FLOOR_DB : null;
    this.noiseDb = this.noiseMean;
    this.noiseVoicing = NOISE_VOICING_INITIAL;
    this.noiseVoicingCarried = false;
    this.noiseVoicingPeak = 0;
    this.nvHist.fill(0);
    this.nvCount = 0;
    this.noiseProfile.fill(0);
  }

  private currentFloor(): number {
    let floor = this.blockMin;
    for (let i = 0; i < NOISE_BLOCKS; i++) if (this.blockMins[i] < floor) floor = this.blockMins[i];
    return floor;
  }

  /** Minimum statistics over the block ring, and the quiet frames' average. */
  private updateNoise(levelDb: number, quiet: boolean): void {
    if (levelDb < this.blockMin) this.blockMin = levelDb;
    if (++this.blockFill >= this.blockFrames) {
      this.blockMins[this.blockIndex] = this.blockMin;
      this.blockIndex = (this.blockIndex + 1) % NOISE_BLOCKS;
      this.blockFill = 0;
      this.blockMin = Infinity;
    }
    const floor = this.currentFloor();
    if (this.noiseMean === null) this.noiseMean = floor + NOISE_INITIAL_ABOVE_FLOOR_DB;
    else if (quiet) this.noiseMean += this.noiseAlpha * (levelDb - this.noiseMean);
    this.noiseMean = Math.min(floor + NOISE_MAX_ABOVE_FLOOR_DB, Math.max(floor, this.noiseMean));
    this.noiseDb = this.noiseMean;
  }

  private recordTrace(levelDb: number, voicing: number): void {
    this.blockLevels[this.blockFrame] = levelDb;
    this.blockVoicing[this.blockFrame] = voicing;
    if (++this.blockFrame < TRACE_FRAMES_PER_BLOCK) return;
    this.blockFrame = 0;
    let lo = Infinity;
    for (let f = 0; f < TRACE_FRAMES_PER_BLOCK; f++) lo = Math.min(lo, this.blockLevels[f]);
    const base = this.traceBaseOf(lo);
    const slot = this.traceBlocks % TRACE_BLOCKS;
    this.traceBase[slot] = base;
    for (let f = 0; f < TRACE_FRAMES_PER_BLOCK; f++) {
      const k = slot * TRACE_FRAMES_PER_BLOCK + f;
      this.traceLevels[k] = this.traceLevelCode(this.blockLevels[f], base);
      this.traceVoicing[k] = this.traceVoicingCode(this.blockVoicing[f]);
    }
    this.traceBlocks++;
  }

  private traceBaseOf(lowestDb: number): number {
    return Math.max(0, Math.min(1295, Math.floor(lowestDb + TRACE_LEVEL_OFFSET_DB)));
  }

  private traceLevelCode(levelDb: number, base: number): number {
    return Math.max(0, Math.min(63, Math.round((levelDb + TRACE_LEVEL_OFFSET_DB - base) / TRACE_LEVEL_STEP_DB)));
  }

  private traceVoicingCode(voicing: number): number {
    return Math.max(0, Math.min(63, Math.round(voicing * 63)));
  }
}
