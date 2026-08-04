import { VoiceFXStrip } from '../../../engines/audio-fx/VoiceFXStrip';
import type { SingingVoice } from '../../../engines/SingingVoice';

interface StretchDriveNode {
  shaper: WaveShaperNode;
}

const stripCache = new WeakMap<SingingVoice, VoiceFXStrip>();
const driveCache = new WeakMap<SingingVoice, StretchDriveNode>();
const stripMainWired = new WeakMap<SingingVoice, boolean>();

export function getStretchFxStrip(voice: SingingVoice, context: AudioContext): VoiceFXStrip {
  let strip = stripCache.get(voice);
  if (!strip) {
    strip = new VoiceFXStrip(context);
    stripCache.set(voice, strip);
  }
  return strip;
}

/** Disconnect per-trigger sends and main output so nodes can be rewired without leaking. */
export function releaseStretchFxRouting(voice: SingingVoice): void {
  const strip = stripCache.get(voice);
  if (strip) {
    strip.connectReverb(null);
    strip.connectDelay(null);
    if (stripMainWired.get(voice)) {
      try {
        strip.output.disconnect();
      } catch {
        /* already disconnected */
      }
      stripMainWired.delete(voice);
    }
  }
  const drive = driveCache.get(voice);
  if (drive) {
    try {
      drive.shaper.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}

export interface StretchFxRouting {
  strip: VoiceFXStrip;
  voiceEntry: AudioNode;
}

/**
 * Reuse VoiceFXStrip + optional drive shaper per singing voice.
 * Caller must call voice.disconnectOutput() before wiring.
 */
export function wireStretchFxRouting(
  voice: SingingVoice,
  context: AudioContext,
  mainDest: AudioNode,
  reverbNode: ConvolverNode | null,
  delayNode: DelayNode | null,
  driveAmount: number,
  driveCurve: (amount: number) => Float32Array,
): StretchFxRouting {
  const strip = getStretchFxStrip(voice, context);

  if (!stripMainWired.get(voice)) {
    strip.output.connect(mainDest);
    stripMainWired.set(voice, true);
  }

  strip.connectReverb(reverbNode);
  strip.connectDelay(delayNode);

  let voiceEntry: AudioNode = strip.input;

  if (driveAmount > 0) {
    let drive = driveCache.get(voice);
    if (!drive) {
      drive = { shaper: context.createWaveShaper() };
      driveCache.set(voice, drive);
    }
    drive.shaper.curve = driveCurve(driveAmount * 100) as Float32Array<ArrayBuffer>;
    try {
      drive.shaper.disconnect();
    } catch {
      /* noop */
    }
    drive.shaper.connect(strip.input);
    voiceEntry = drive.shaper;
  }

  return { strip, voiceEntry };
}
