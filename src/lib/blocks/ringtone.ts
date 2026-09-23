// Caller ringtone — synthesized in-browser via Web Audio so we don't
// have to ship an audio file. Plays a classic "BRRT-brrt …" pattern:
// two short pulses separated by a small gap, then a longer pause,
// repeat. Volume is held well below 1.0 so it doesn't startle; the
// envelope (gain ramps at the start/end of each pulse) prevents the
// clicks that a hard gate would produce.
//
// Why synthesize rather than an <audio src="..."> file:
//   - Zero asset cost (no file to host / cache / version).
//   - The ringtone is identical across browsers + OS audio routing.
//   - The caller can change it later (per-user setting) without
//     touching the bundle.
//
// Lifecycle: call `startRingtone()` once, then `stopRingtone()` exactly
// once when the ringing window closes. `stopRingtone()` is idempotent —
// safe to call from a React effect cleanup. Calling `startRingtone()`
// while one is already playing restarts it (used when the same call is
// re-accepted / re-declined, which is rare but defensive).
//
// Autoplay caveat: most browsers gate AudioContext on a user gesture.
// `startRingtone()` must be called from inside a click/keydown handler
// (or another handler in the same call stack) so the AudioContext
// starts in the "running" state. The caller's CallDialog is opened
// from a button click and the recipient's IncomingCallDialog opens
// from the auto-pop hook — but the auto-pop hook fires from a query
// result, not a user gesture. To handle the recipient side, the
// AudioContext is created lazily on first startRingtone() call, and
// the first attempt to start it (which may be inside a non-gesture
// path) is wrapped in a try/catch that retries on the next user
// gesture (see ensureRunning).

let ctx: AudioContext | null = null;
let pulseTimer: ReturnType<typeof setTimeout> | null = null;
let pulseGain: GainNode | null = null;
let pulseOsc: OscillatorNode | null = null;
let nextStartAt = 0;

// Pattern in ms: two short pulses, short gap, longer pause. Tuned to
// match the existing "ringing pulse" visual rhythm in CallDialog +
// IncomingCallDialog so the visual + audio cues feel like one cue.
// Each segment is one of two shapes — the union narrowing in
// runLoop() relies on the `kind` discriminator rather than the
// `in` operator (TypeScript narrows unions by `in` only when fields
// are unique to one branch).
type PulseSegment = { kind: "pulse"; pulse: number; gap: number };
type PauseSegment = { kind: "pause"; pause: number };
type PatternSegment = PulseSegment | PauseSegment;

const PATTERN: PatternSegment[] = [
  { kind: "pulse", pulse: 350, gap: 80 }, // brrt
  { kind: "pulse", pulse: 350, gap: 0 }, // brrt
  { kind: "pause", pause: 800 }, // ………
];

async function ensureRunning(): Promise<void> {
  if (!ctx) {
    const W = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = W.AudioContext ?? W.webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      // Browser refused to start the context (likely no user gesture
      // in the call stack yet). The next startRingtone() call from a
      // gesture will retry — drop this attempt silently rather than
      // surface an error toast for a cosmetic feature.
    }
  }
}

async function scheduleNote(
  freq: number,
  startAt: number,
  durationMs: number,
): Promise<void> {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  // Envelope: 30 ms attack, hold at 0.18, 80 ms release. Keeps the
  // perceived volume gentle (peak ~ -15 dB) and prevents the clicks
  // a hard gate produces.
  const start = ctx.currentTime + startAt;
  const dur = durationMs / 1000;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.18, start + 0.03);
  gain.gain.setValueAtTime(0.18, start + dur - 0.08);
  gain.gain.linearRampToValueAtTime(0, start + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
  // Keep the most-recent osc/gain refs so stopRingtone() can fade
  // them out cleanly without a hard cutoff.
  pulseOsc = osc;
  pulseGain = gain;
}

function clearTimer(): void {
  if (pulseTimer != null) {
    clearTimeout(pulseTimer);
    pulseTimer = null;
  }
}

async function runLoop(): Promise<void> {
  if (!ctx) return;
  // Pattern position counter — advance by total elapsed time so we
  // re-anchor `nextStartAt` after each iteration even if a pulse
  // drifted slightly.
  const stepMs = (s: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, s));
  for (const seg of PATTERN) {
    if (!ctx) return; // stopped mid-pattern
    if (seg.kind === "pulse") {
      await scheduleNote(440, 0, seg.pulse);
      nextStartAt += seg.pulse;
      if (seg.gap > 0) {
        await stepMs(seg.gap);
        nextStartAt += seg.gap;
      }
    } else {
      await stepMs(seg.pause);
      nextStartAt += seg.pause;
    }
  }
  // Schedule the next iteration so the loop never blocks the call
  // stack. We re-enter via setTimeout rather than recurse to keep
  // the stack shallow.
  if (ctx) {
    pulseTimer = setTimeout(() => {
      void runLoop();
    }, 10);
  }
}

export async function startRingtone(): Promise<void> {
  await ensureRunning();
  if (!ctx || ctx.state !== "running") return;
  // If already running, stop first so callers can re-trigger without
  // overlapping notes. startRingtone() is idempotent in effect.
  stopRingtone();
  nextStartAt = 0;
  pulseTimer = setTimeout(() => {
    void runLoop();
  }, 10);
}

export function stopRingtone(): void {
  clearTimer();
  // Fade the most-recent gain to zero then disconnect — avoids the
  // pop that a hard disconnect at peak amplitude produces.
  if (ctx && pulseGain && pulseOsc) {
    const now = ctx.currentTime;
    try {
      pulseGain.gain.cancelScheduledValues(now);
      pulseGain.gain.setValueAtTime(pulseGain.gain.value, now);
      pulseGain.gain.linearRampToValueAtTime(0, now + 0.08);
    } catch {
      // Gain was already disconnected — ignore.
    }
    try {
      pulseOsc.stop(now + 0.1);
    } catch {
      // Already stopped — ignore.
    }
  }
  pulseGain = null;
  pulseOsc = null;
}

// Test helper (also useful for hot-module-reload cleanup so a stale
// audio context doesn't keep ringing after a code update).
export function stopRingtoneHard(): void {
  clearTimer();
  try {
    pulseOsc?.stop();
  } catch {
    /* ignore */
  }
  pulseOsc?.disconnect();
  pulseGain?.disconnect();
  pulseOsc = null;
  pulseGain = null;
  try {
    ctx?.close();
  } catch {
    /* ignore */
  }
  ctx = null;
}
