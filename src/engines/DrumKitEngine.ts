/**
 * Drum Kit Engine
 *
 * Message façade for analog 808/909 drums. Live hits go to `drumkit-processor`
 * (hyphon_native `drumkit_*` handles). If the worklet/WASM path fails, the
 * existing Web Audio oscillator kit remains the fallback (HUD reason, non-silent).
 */

import type { KickParams, SnareParams, HatParams, DrumSound, DrumKitType } from '@/types';
import { KIT_CHARACTER, kitToNativeId, DRUMKIT_VOICE, type KitSynthCharacter } from './DrumKitCharacter';
import {
    engineTelemetry,
    isAppleWebKit,
    loadHyphonWasmExportMap,
    logEngineFallback,
    resolvePublicAsset,
} from '@/utils/engineTelemetry';
import {
    DRUMKIT_REQUIRED_WASM_EXPORTS,
    drumkitExportMapInsufficient,
    formatMissingWasmExports,
    HYPHON_NATIVE_MIN_MEMORY_PAGES,
    wasmExportNameSnapshot,
} from '@/audio-worklets/hyphonNativeImports';

const HYPHON_NATIVE_WASM_URL = resolvePublicAsset('hyphon_native.wasm');
const DRUMKIT_INIT_TIMEOUT_MS = 8000;

export class DrumKitEngine {
  private _kitType: DrumKitType;
  private _character: KitSynthCharacter;
  private workletNode: AudioWorkletNode | null = null;
  private audioContext: AudioContext | null = null;
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
   * Load drumkit-processor and instantiate hyphon_native once for the whole kit.
   * Returns false when the Web Audio fallback should handle hits.
   */
  async init(
    audioContext: AudioContext,
    workletUrl: string,
    destination: AudioNode,
  ): Promise<boolean> {
    this.audioContext = audioContext;

    if (isAppleWebKit()) {
      this.useFallback('threaded hyphon_native.wasm is unsafe in WebKit AudioWorklet');
      return false;
    }

    if (!audioContext.audioWorklet || !workletUrl) {
      this.useFallback(
        !audioContext.audioWorklet ? 'AudioWorklet unavailable' : 'worklet URL missing',
      );
      return false;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DRUMKIT_INIT_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(HYPHON_NATIVE_WASM_URL, { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!response.ok) {
        this.useFallback(`hyphon_native.wasm fetch HTTP ${response.status} (${HYPHON_NATIVE_WASM_URL})`);
        return false;
      }
      const wasmBytes = await response.arrayBuffer();
      const exportMap = await this.fetchExportMap(wasmBytes);
      return this.initWithWasmBytes(audioContext, workletUrl, destination, wasmBytes, exportMap);
    } catch (e) {
      const aborted =
        (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof Error && e.name === 'AbortError');
      this.useFallback(
        aborted
          ? `hyphon_native.wasm fetch timeout (${DRUMKIT_INIT_TIMEOUT_MS}ms)`
          : 'init exception before worklet load',
        aborted ? undefined : e,
      );
      return false;
    }
  }

  private async fetchExportMap(wasmBytes: ArrayBuffer): Promise<Record<string, string>> {
    const map = await loadHyphonWasmExportMap();
    const mapUrl = resolvePublicAsset('hyphon_wasm_export_map.json');
    const glueUrl = resolvePublicAsset('hyphon_native.js');
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
  ): Promise<boolean> {
    try {
      await audioContext.audioWorklet.addModule(workletUrl);

      this.workletNode = new AudioWorkletNode(audioContext, 'drumkit-processor', {
        outputChannelCount: [2],
      });
      this.workletNodesCreated += 1;

      const module = await WebAssembly.compile(wasmBytes);
      const imports = WebAssembly.Module.imports(module);
      const isThreaded = imports.some((i) => i.kind === 'memory');
      const memoryPages = isThreaded ? HYPHON_NATIVE_MIN_MEMORY_PAGES : undefined;

      this.workletNode.port.postMessage({
        type: 'init-wasm',
        data: {
          wasmBytes,
          sampleRate: audioContext.sampleRate,
          isThreaded,
          variant: isThreaded ? 'threaded' : 'single',
          memoryPages,
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
   * allocates Web Audio oscillators (legacy kit).
   */
  play(
    context: AudioContext,
    masterGain: GainNode,
    noiseBuffer: AudioBuffer | null,
    sound: DrumSound,
    params: KickParams | SnareParams | HatParams,
    time: number,
  ): void {
    if (this.wasmReady && this.workletNode) {
      this.triggerWorklet(sound, params, time);
      return;
    }
    this.playFallback(context, masterGain, noiseBuffer, sound, params, time);
  }

  /** Tests: how many AudioWorkletNodes this engine constructed. */
  get workletInstanceCount(): number {
    return this.workletNodesCreated;
  }

  private triggerWorklet(
    sound: DrumSound,
    params: KickParams | SnareParams | HatParams,
    audioTime: number,
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
      data: { voice, velocity: 1, a, b, c, d, audioTime },
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
  }

  private cleanupWorklet(): void {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode.port.close();
      this.workletNode = null;
    }
  }

  private playFallback(
    context: AudioContext,
    masterGain: GainNode,
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

  private playKick(context: AudioContext, masterGain: GainNode, params: KickParams, time: number): void {
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
    masterGain: GainNode,
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
    masterGain: GainNode,
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
