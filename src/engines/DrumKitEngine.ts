/**
 * Drum Kit Engine
 *
 * Message façade for analog 808/909 drums. Live hits go to `drumkit-processor`
 * (one `drumkit_*` voice on the audio session's shared hyphon_native instance).
 * If the worklet/WASM path fails, the existing Web Audio oscillator kit remains
 * the fallback (HUD reason, non-silent).
 */

import type { KickParams, SnareParams, HatParams, DrumSound, DrumKitType } from '@/types';
import { KIT_CHARACTER, kitToNativeId, DRUMKIT_VOICE, type KitSynthCharacter } from './DrumKitCharacter';
import {
    engineTelemetry,
    loadHyphonWasmExportMap,
    logEngineFallback,
    resolvePublicAsset,
} from '@/utils/engineTelemetry';
import {
    DRUMKIT_REQUIRED_WASM_EXPORTS,
    drumkitExportMapInsufficient,
    formatMissingWasmExports,
    wasmExportNameSnapshot,
    type HyphonNativeArtifact,
} from '@/audio-worklets/hyphonNativeImports';
import { resolveHyphonNativeArtifact } from './hyphonNativeVariant';

const DRUMKIT_INIT_TIMEOUT_MS = 8000;

/**
 * Per-hit pan law, shared with panGains() in emscripten/drumkit_wrapper.cpp:
 * constant power with unity at the centre (√2·cos / √2·sin of the pan angle),
 * so a centred hit is the mono kit on both channels and a hard-panned one is
 * +3 dB on its side. Out-of-range pans clamp; a non-finite one is centre.
 */
export function drumPanGains(pan: number | undefined): [left: number, right: number] {
  if (pan === undefined || !Number.isFinite(pan) || pan === 0) return [1, 1];
  const angle = (Math.min(1, Math.max(-1, pan)) + 1) * (Math.PI / 4);
  return [Math.SQRT2 * Math.cos(angle), Math.SQRT2 * Math.sin(angle)];
}

export class DrumKitEngine {
  private _kitType: DrumKitType;
  private _character: KitSynthCharacter;
  private workletNode: AudioWorkletNode | null = null;
  private audioContext: AudioContext | null = null;
  /**
   * Where the kit sounds: the patch's `drumkitVoice` node. The Web Audio
   * fallback hits land here too, so an insert on the kit hears both paths.
   */
  private output: AudioNode | null = null;
  private wasmReady = false;
  private workletNodesCreated = 0;
  fallbackReason: string | null = null;

  constructor(kitType: DrumKitType = '808') {
    this._kitType = kitType;
    this._character = KIT_CHARACTER[kitType];
  }

  get kitType(): DrumKitType {
    return this._kitType;
  }

  /** True when hits are rendered inside the AudioWorklet (no per-hit OscillatorNode). */
  get isWorkletReady(): boolean {
    return this.wasmReady;
  }

  setKit(kitType: DrumKitType): void {
    this._kitType = kitType;
    this._character = KIT_CHARACTER[kitType];
    if (this.wasmReady && this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'set-kit',
        data: { kit: kitToNativeId(kitType) },
      });
    }
  }

  /**
   * Load drumkit-processor; the kit takes one voice on the audio session's
   * hyphon_native instance (the profile the context is bound to — single-threaded
   * on WebKit and on pages that are not crossOriginIsolated).
   * Returns false when the Web Audio fallback should handle hits.
   */
  async init(
    audioContext: AudioContext,
    workletUrl: string,
    destination: AudioNode,
  ): Promise<boolean> {
    this.audioContext = audioContext;
    this.output = destination;

    if (!audioContext.audioWorklet || !workletUrl) {
      this.useFallback(
        !audioContext.audioWorklet ? 'AudioWorklet unavailable' : 'worklet URL missing',
      );
      return false;
    }

    const { artifact } = resolveHyphonNativeArtifact(audioContext);
    const wasmUrl = resolvePublicAsset(artifact.wasm);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DRUMKIT_INIT_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(wasmUrl, { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!response.ok) {
        this.useFallback(`${artifact.wasm} fetch HTTP ${response.status} (${wasmUrl})`);
        return false;
      }
      const wasmBytes = await response.arrayBuffer();
      const exportMap = await this.fetchExportMap(wasmBytes, artifact);
      return this.initWithWasmBytes(audioContext, workletUrl, destination, wasmBytes, exportMap, artifact);
    } catch (e) {
      const aborted =
        (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof Error && e.name === 'AbortError');
      this.useFallback(
        aborted
          ? `${artifact.wasm} fetch timeout (${DRUMKIT_INIT_TIMEOUT_MS}ms)`
          : 'init exception before worklet load',
        aborted ? undefined : e,
      );
      return false;
    }
  }

  private async fetchExportMap(
    wasmBytes: ArrayBuffer,
    artifact: HyphonNativeArtifact,
  ): Promise<Record<string, string>> {
    const map = await loadHyphonWasmExportMap(artifact.threading);
    const mapUrl = resolvePublicAsset(artifact.exportMap);
    const glueUrl = resolvePublicAsset(artifact.glue);
    const wasmModule = await WebAssembly.compile(wasmBytes);
    const rawExports = wasmExportNameSnapshot(wasmModule);

    if (Object.keys(map).length === 0) {
      logEngineFallback(
        'drumkit',
        'wasm-worklet',
        `hyphon_wasm_export_map.json empty and glue parse found no exports ` +
        `(tried ${mapUrl} and ${glueUrl}). ` +
        formatMissingWasmExports(rawExports, [...DRUMKIT_REQUIRED_WASM_EXPORTS]),
      );
      return map;
    }

    if (drumkitExportMapInsufficient(wasmModule, map)) {
      logEngineFallback(
        'drumkit',
        'wasm-worklet',
        `export map did not resolve drumkit_* against WASM. ` +
        formatMissingWasmExports(rawExports, [...DRUMKIT_REQUIRED_WASM_EXPORTS]),
      );
    }

    return map;
  }

  async initWithWasmBytes(
    audioContext: AudioContext,
    workletUrl: string,
    destination: AudioNode,
    wasmBytes: ArrayBuffer,
    exportMap: Record<string, string> = {},
    artifact: HyphonNativeArtifact = resolveHyphonNativeArtifact(audioContext).artifact,
  ): Promise<boolean> {
    try {
      await audioContext.audioWorklet.addModule(workletUrl);

      this.workletNode = new AudioWorkletNode(audioContext, 'drumkit-processor', {
        outputChannelCount: [2],
      });
      this.workletNodesCreated += 1;

      // Same profile as every other voice on this context: they share one instance.
      this.workletNode.port.postMessage({
        type: 'init-wasm',
        data: {
          wasmBytes,
          sampleRate: audioContext.sampleRate,
          isThreaded: artifact.sharedMemory,
          variant: artifact.threading,
          memoryPages: artifact.minMemoryPages,
          exportMap,
        },
      });

      this.workletNode.connect(destination);

      const initSuccess = await new Promise<boolean>((resolve) => {
        let readyReceived = false;
        this.workletNode!.port.onmessage = (e: MessageEvent<{ type?: string; error?: unknown }>) => {
          if (e.data.type === 'ready') {
            readyReceived = true;
            resolve(true);
          } else if (e.data.type === 'error') {
            const errDetail =
              typeof e.data.error === 'string'
                ? e.data.error
                : e.data.error != null
                  ? String(e.data.error)
                  : 'unknown worklet error';
            this.useFallback(`worklet init-wasm error: ${errDetail}`);
            resolve(false);
          }
        };
        setTimeout(() => {
          if (!readyReceived) {
            this.useFallback(`worklet ready timeout (${DRUMKIT_INIT_TIMEOUT_MS}ms)`);
            resolve(false);
          }
        }, DRUMKIT_INIT_TIMEOUT_MS);
      });

      if (!initSuccess) {
        this.cleanupWorklet();
        return false;
      }

      this.wasmReady = true;
      this.fallbackReason = null;
      this.workletNode.port.postMessage({
        type: 'set-kit',
        data: { kit: kitToNativeId(this._kitType) },
      });
      try {
        engineTelemetry.registerResolution('drumkit', 'wasm-worklet', 'worklet-ready heapCount=1');
      } catch {
        /* telemetry must never break audio */
      }
      return true;
    } catch (e) {
      this.useFallback('AudioWorklet.addModule or node creation failed', e);
      this.cleanupWorklet();
      return false;
    }
  }

  /**
   * Play a drum sound. Worklet path posts a trigger at `audioTime`; fallback
   * allocates Web Audio oscillators (legacy kit). `pan` (-1..1, the step's)
   * overrides the sound's own `params.pan`; both paths use drumPanGains().
   */
  play(
    context: AudioContext,
    masterGain: GainNode,
    noiseBuffer: AudioBuffer | null,
    sound: DrumSound,
    params: KickParams | SnareParams | HatParams,
    time: number,
    pan?: number,
  ): void {
    const hitPan = pan ?? params.pan ?? 0;
    if (this.wasmReady && this.workletNode) {
      this.triggerWorklet(sound, params, time, hitPan);
      return;
    }
    const dest = this.output ?? masterGain;
    this.playFallback(context, hitPan === 0 ? dest : panStage(context, dest, hitPan), noiseBuffer, sound, params, time);
  }

  /**
   * Transport stop: drop the hits the worklet still holds for later frames —
   * the clock posts steps up to STEP_LOOKAHEAD_MS early, so a hit due just
   * after STOP is already queued. Hits already sounding ring out.
   */
  cancelPending(): void {
    if (this.wasmReady && this.workletNode) {
      this.workletNode.port.postMessage({ type: 'allNotesOff' });
    }
  }

  /** Tests: how many AudioWorkletNodes this engine constructed. */
  get workletInstanceCount(): number {
    return this.workletNodesCreated;
  }

  private triggerWorklet(
    sound: DrumSound,
    params: KickParams | SnareParams | HatParams,
    audioTime: number,
    pan: number,
  ): void {
    const voice = DRUMKIT_VOICE[sound];
    let a = 0;
    let b = 0;
    let c = 0;
    let d = 0;
    if (sound === 'kick') {
      const p = params as KickParams;
      a = p.pitch;
      b = p.decay;
      c = p.tone;
      d = p.volume;
    } else if (sound === 'snare') {
      const p = params as SnareParams;
      a = p.tone;
      b = p.decay;
      c = p.noise;
      d = p.volume;
    } else {
      const p = params as HatParams;
      a = p.pitch;
      b = p.decay;
      c = p.volume;
      d = 0;
    }
    this.workletNode!.port.postMessage({
      type: 'trigger',
      data: { voice, velocity: 1, a, b, c, d, pan, audioTime },
    });
  }

  private useFallback(reason: string, err?: unknown): void {
    this.wasmReady = false;
    this.fallbackReason = reason;
    logEngineFallback('drumkit', 'wasm-worklet', reason, err);
  }

  /** Release the worklet node (engine re-init / teardown). */
  dispose(): void {
    this.cleanupWorklet();
    this.wasmReady = false;
    this.output = null;
  }

  private cleanupWorklet(): void {
    if (this.workletNode) {
      // The kit's voice lives on the shared instance: hand the handle back.
      this.workletNode.port.postMessage({ type: 'dispose' });
      this.workletNode.disconnect();
      this.workletNode.port.close();
      this.workletNode = null;
    }
  }

  private playFallback(
    context: AudioContext,
    masterGain: AudioNode,
    noiseBuffer: AudioBuffer | null,
    sound: DrumSound,
    params: KickParams | SnareParams | HatParams,
    time: number,
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

  private playKick(context: AudioContext, masterGain: AudioNode, params: KickParams, time: number): void {
    const c = this._character;
    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = c.kickWaveform;

    const startFreq = params.pitch * c.kickFreqStart * 3;
    const endFreq = Math.max(0.01, params.pitch * c.kickFreqEnd);
    const sweepTime = params.decay * c.kickPitchCurve;

    osc.frequency.setValueAtTime(startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(endFreq, time + sweepTime);

    const clickLevel = params.tone * 0.3;
    gain.gain.setValueAtTime(params.volume + clickLevel, time);
    gain.gain.setValueAtTime(params.volume, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, time + params.decay);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(time);
    osc.stop(time + params.decay + 0.01);
  }

  private playSnare(
    context: AudioContext,
    masterGain: AudioNode,
    noiseBuffer: AudioBuffer | null,
    params: SnareParams,
    time: number,
  ): void {
    const c = this._character;

    const osc = context.createOscillator();
    const oscGain = context.createGain();
    osc.type = c.snareWaveform;
    osc.frequency.setValueAtTime(params.tone, time);
    osc.frequency.exponentialRampToValueAtTime(params.tone * 0.5, time + params.decay * 0.3);

    const toneLevel = params.volume * 0.6;
    oscGain.gain.setValueAtTime(toneLevel, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + params.decay * 0.5);

    osc.connect(oscGain);
    oscGain.connect(masterGain);
    osc.start(time);
    osc.stop(time + params.decay + 0.01);

    if (noiseBuffer) {
      const noise = context.createBufferSource();
      noise.buffer = noiseBuffer;

      const noiseFilter = context.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = c.snareNoiseFreq;
      noiseFilter.Q.value = c.snareNoiseQ;

      const noiseGain = context.createGain();
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

  private playHat(
    context: AudioContext,
    masterGain: AudioNode,
    noiseBuffer: AudioBuffer | null,
    params: HatParams,
    time: number,
  ): void {
    const c = this._character;

    if (noiseBuffer) {
      const src = context.createBufferSource();
      src.buffer = noiseBuffer;

      const hpFilter = context.createBiquadFilter();
      hpFilter.type = 'highpass';
      hpFilter.frequency.value = params.pitch;
      hpFilter.Q.value = c.hatResonance;

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

/**
 * Fallback-kit pan for one hit: the hit's (mono) signal into two gains with
 * drumPanGains() and a merger onto `dest`. Built only for a panned hit; a
 * centred one connects straight to `dest`, as it always has.
 */
function panStage(context: AudioContext, dest: AudioNode, pan: number): AudioNode {
  const [left, right] = drumPanGains(pan);
  const input = context.createGain();
  input.channelCount = 1;
  input.channelCountMode = 'explicit';
  const gainL = context.createGain();
  const gainR = context.createGain();
  gainL.gain.value = left;
  gainR.gain.value = right;
  const merger = context.createChannelMerger(2);
  input.connect(gainL);
  input.connect(gainR);
  gainL.connect(merger, 0, 0);
  gainR.connect(merger, 0, 1);
  merger.connect(dest);
  return input;
}
