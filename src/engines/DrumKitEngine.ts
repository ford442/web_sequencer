/**
 * Drum Kit Engine
 *
 * Provides kit-aware drum synthesis that shapes the sound character
 * based on 808 vs 909 selection. The engine applies kit-specific
 * oscillator waveforms, pitch envelopes, and noise characteristics
 * to produce authentic ReBirth-style drum sounds.
 *
 * Usage:
 * ```typescript
 * const engine = new DrumKitEngine('808');
 * engine.playKick(context, masterGain, params, time);
 * engine.setKit('909'); // switch kits
 * ```
 */

import type { KickParams, SnareParams, HatParams, DrumSound, DrumKitType } from '../types';

/** Kit-specific synthesis parameters applied on top of user params */
interface KitSynthCharacter {
  /** Kick: starting frequency multiplier */
  kickFreqStart: number;
  /** Kick: ending frequency multiplier */
  kickFreqEnd: number;
  /** Kick: oscillator waveform */
  kickWaveform: OscillatorType;
  /** Kick: pitch envelope curve (higher = faster sweep) */
  kickPitchCurve: number;
  /** Snare: body oscillator type */
  snareWaveform: OscillatorType;
  /** Snare: noise filter frequency */
  snareNoiseFreq: number;
  /** Snare: noise filter Q */
  snareNoiseQ: number;
  /** Hat: filter resonance */
  hatResonance: number;
  /** Hat: number of metallic square oscillators */
  hatOscCount: number;
}

const KIT_CHARACTER: Record<DrumKitType, KitSynthCharacter> = {
  '808': {
    kickFreqStart: 1.0,        // Lower start pitch
    kickFreqEnd: 0.08,         // Deeper sub sweep
    kickWaveform: 'sine',      // Pure sine for deep 808 boom
    kickPitchCurve: 0.6,       // Slower pitch sweep = more boom
    snareWaveform: 'triangle', // Softer body
    snareNoiseFreq: 1500,      // Lower noise = warmer snap
    snareNoiseQ: 1.0,          // Less resonant
    hatResonance: 2.0,         // Moderate ring
    hatOscCount: 4,            // Fewer harmonics = more analog
  },
  '909': {
    kickFreqStart: 1.2,        // Higher attack pitch
    kickFreqEnd: 0.01,         // Tighter decay
    kickWaveform: 'sine',      // Still sine but with different envelope
    kickPitchCurve: 0.3,       // Faster sweep = punchier
    snareWaveform: 'triangle', // Brighter body
    snareNoiseFreq: 3000,      // Higher noise band = crispier
    snareNoiseQ: 2.0,          // More resonant snap
    hatResonance: 4.0,         // More metallic ring
    hatOscCount: 6,            // More harmonics = digital shimmer
  },
};

export class DrumKitEngine {
  private _kitType: DrumKitType;
  private _character: KitSynthCharacter;

  constructor(kitType: DrumKitType = '808') {
    this._kitType = kitType;
    this._character = KIT_CHARACTER[kitType];
  }

  get kitType(): DrumKitType {
    return this._kitType;
  }

  setKit(kitType: DrumKitType): void {
    this._kitType = kitType;
    this._character = KIT_CHARACTER[kitType];
  }

  /**
   * Play a drum sound with kit-specific character
   */
  play(
    context: AudioContext,
    masterGain: GainNode,
    noiseBuffer: AudioBuffer | null,
    sound: DrumSound,
    params: KickParams | SnareParams | HatParams,
    time: number
  ): void {
    switch (sound) {
      case 'kick':
        this.playKick(context, masterGain, params as KickParams, time);
        break;
      case 'snare':
        this.playSnare(context, masterGain, noiseBuffer, params as SnareParams, time);
        break;
      case 'closedHat':
      case 'openHat':
        this.playHat(context, masterGain, noiseBuffer, params as HatParams, time);
        break;
    }
  }

  /**
   * 808/909-style kick synthesis with pitch envelope
   */
  private playKick(context: AudioContext, masterGain: GainNode, params: KickParams, time: number): void {
    const c = this._character;
    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = c.kickWaveform;

    // Pitch envelope: start high, sweep down (808 sweeps slower, 909 punchier)
    const startFreq = params.pitch * c.kickFreqStart * 3;
    const endFreq = Math.max(0.01, params.pitch * c.kickFreqEnd);
    const sweepTime = params.decay * c.kickPitchCurve;

    osc.frequency.setValueAtTime(startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(endFreq, time + sweepTime);

    // Amplitude envelope with tone-controlled click
    const clickLevel = params.tone * 0.3;
    gain.gain.setValueAtTime(params.volume + clickLevel, time);
    gain.gain.setValueAtTime(params.volume, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, time + params.decay);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(time);
    osc.stop(time + params.decay + 0.01);
  }

  /**
   * 808/909-style snare: body oscillator + shaped noise
   */
  private playSnare(
    context: AudioContext,
    masterGain: GainNode,
    noiseBuffer: AudioBuffer | null,
    params: SnareParams,
    time: number
  ): void {
    const c = this._character;

    // Body tone oscillator
    const osc = context.createOscillator();
    const oscGain = context.createGain();
    osc.type = c.snareWaveform;
    osc.frequency.setValueAtTime(params.tone, time);
    osc.frequency.exponentialRampToValueAtTime(params.tone * 0.5, time + params.decay * 0.3);

    // Tone volume scaled by kit character
    const toneLevel = params.volume * 0.6;
    oscGain.gain.setValueAtTime(toneLevel, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + params.decay * 0.5);

    osc.connect(oscGain);
    oscGain.connect(masterGain);
    osc.start(time);
    osc.stop(time + params.decay + 0.01);

    // Noise component
    if (noiseBuffer) {
      const noise = context.createBufferSource();
      noise.buffer = noiseBuffer;

      const noiseFilter = context.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = c.snareNoiseFreq;
      noiseFilter.Q.value = c.snareNoiseQ;

      const noiseGain = context.createGain();
      // params.noise ranges ~2000-4000 (Hz-like value); normalize to 0-1 amplitude
      const noiseLevel = Math.min(1.0, params.noise / 5000) * params.volume;
      noiseGain.gain.setValueAtTime(noiseLevel, time);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, time + params.decay);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(masterGain);
      noise.start(time);
      noise.stop(time + params.decay + 0.01);
    }
  }

  /**
   * 808/909-style hi-hat: metallic noise with bandpass shaping
   */
  private playHat(
    context: AudioContext,
    masterGain: GainNode,
    noiseBuffer: AudioBuffer | null,
    params: HatParams,
    time: number
  ): void {
    const c = this._character;

    if (noiseBuffer) {
      const src = context.createBufferSource();
      src.buffer = noiseBuffer;

      // High-pass for metallic character
      const hpFilter = context.createBiquadFilter();
      hpFilter.type = 'highpass';
      hpFilter.frequency.value = params.pitch;
      hpFilter.Q.value = c.hatResonance;

      // Bandpass for tonal shaping
      const bpFilter = context.createBiquadFilter();
      bpFilter.type = 'bandpass';
      bpFilter.frequency.value = params.pitch * 1.5;
      bpFilter.Q.value = c.hatResonance * 0.5;

      const gain = context.createGain();
      gain.gain.setValueAtTime(params.volume, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + params.decay);

      src.connect(hpFilter);
      hpFilter.connect(bpFilter);
      bpFilter.connect(gain);
      gain.connect(masterGain);
      src.start(time);
      src.stop(time + params.decay + 0.01);
    }
  }
}
