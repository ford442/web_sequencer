/**
 * Offline render targets for every registered 303 voice (#1543).
 *
 * `TB303_MODELS` is the registry; this maps each id to the backend that
 * renders it from a `Voice303Script`:
 *
 * | backend            | voices                                   | needs |
 * |--------------------|------------------------------------------|-------|
 * | `native-open303`   | the open303-family profiles              | host g++ build of `open303_wrapper.cpp` |
 * | `ts-open303`       | the same profiles, the app's TS port     | nothing (`OfflineOpen303Engine`) |
 * | `native-jc303`     | `jc303` (rosic Open303)                  | host g++ + the `jc303_wasm` submodule |
 * | `ts-highfid`       | `highfid-cpu` (and `live-highfid`, `gpu-highfid` as stand-ins) | nothing |
 * | `openrb338-wasm`   | `openrb338-vintage`, `openrb338-2.0`     | `pnpm run build:wasm:openrb338` |
 *
 * The native and wasm backends are injected (`BackendRunners`), because they
 * need Node (a compiler, a file). A voice whose runner is missing is reported
 * unavailable with the reason, never swapped for another voice: the app's own
 * offline path renders `jc303` with stock-open303 coefficients, and a
 * comparison must not hide that.
 */

import { TB303_MODELS, type Engine303Family, type TB303ModelInfo } from '../../../engines/TB303Models';
import { OPENRB338_V2_MODEL_ID, openrb338ModeForModel, type Openrb338Mode } from '../../../audio-worklets/openrb338';
import { OfflineHighFid303Engine, HIGHFID_CPU_MODEL_ID } from '../OfflineHighFid303Engine';
import { OfflineOpen303Engine, OFFLINE_303_MODELS, type Offline303Params } from '../OfflineOpen303Engine';
import { playScript, type Voice303Script } from './script';

export type CompareBackendId =
  | 'native-open303'
  | 'ts-open303'
  | 'native-jc303'
  | 'ts-highfid'
  | 'openrb338-wasm';

/** Backend preference for the open303 family: native C++ when built, else the TS port. */
export type BackendPreference = 'auto' | 'native' | 'ts';

/** Renderers that need Node (a compiler or a file); supplied by the CLI / tests. */
export interface BackendRunners {
  nativeOpen303?: (modelId: string, script: Voice303Script) => Promise<Float32Array>;
  nativeJc303?: (script: Voice303Script) => Promise<Float32Array>;
  openrb338?: (mode: Openrb338Mode, script: Voice303Script) => Promise<Float32Array>;
}

export interface CompareVoice {
  /** Registered id (`TB303_MODELS`). */
  id: string;
  label: string;
  family: Engine303Family;
  /** Backend that renders it, or null when none is available. */
  backend: CompareBackendId | null;
  /** Why `backend` is null. */
  unavailableReason?: string;
  /** Set when the renderer stands in for the registered voice (e.g. `gpu-highfid` renders as `highfid-cpu`). */
  standInFor?: string;
  license?: string;
}

const OPEN303_FAMILY_TS_IDS: ReadonlySet<string> = new Set(OFFLINE_303_MODELS.map((m) => m.id));

/** Shared param id → Offline303Params key; ids the TS engines have no equivalent for are dropped. */
const TS_PARAM_KEYS: Readonly<Record<number, keyof Offline303Params>> = {
  0: 'waveform',
  2: 'cutoff',
  3: 'resonance',
  4: 'envMod',
  5: 'decay',
  6: 'accent',
  7: 'volume',
  10: 'accentDecay',
  11: 'slideTime',
  13: 'squareDrv',
};

/** Oversampling of the diode-ladder reference (`highfid-cpu` canonical renders). */
const HIGHFID_OVERSAMPLE = 4;

function resolveOne(
  model: TB303ModelInfo,
  runners: BackendRunners,
  preference: BackendPreference,
): CompareVoice {
  const base: CompareVoice = {
    id: model.id,
    label: model.label,
    family: model.family,
    backend: null,
    license: model.license,
  };
  switch (model.family) {
    case 'open303': {
      if (preference !== 'ts' && runners.nativeOpen303) return { ...base, backend: 'native-open303' };
      if (preference === 'native') {
        return { ...base, unavailableReason: 'native open303 build unavailable (needs host g++)' };
      }
      if (OPEN303_FAMILY_TS_IDS.has(model.id)) return { ...base, backend: 'ts-open303' };
      return { ...base, unavailableReason: `no TS profile for ${model.id}` };
    }
    case 'jc303':
      return runners.nativeJc303
        ? { ...base, backend: 'native-jc303' }
        : { ...base, unavailableReason: 'needs host g++ and the jc303_wasm submodule (git submodule update --init jc303_wasm)' };
    case 'highfid':
      // live-highfid freezes through the CPU diode ladder; gpu-highfid falls back to it without WebGPU.
      return {
        ...base,
        backend: 'ts-highfid',
        standInFor: model.id === HIGHFID_CPU_MODEL_ID ? undefined : model.id,
      };
    case 'openrb338':
      return runners.openrb338
        ? { ...base, backend: 'openrb338-wasm' }
        : { ...base, unavailableReason: 'openrb338.wasm not built (pnpm run build:wasm:openrb338)' };
    default:
      return { ...base, unavailableReason: `unknown family ${String(model.family)}` };
  }
}

/** Every registered voice, resolved to its offline backend. */
export function resolveCompareVoices(
  runners: BackendRunners,
  preference: BackendPreference = 'auto',
): CompareVoice[] {
  return TB303_MODELS.map((model) => resolveOne(model, runners, preference));
}

interface TsEngine {
  setParams(partial: Partial<Offline303Params>): void;
  noteOn(note: number, velocity: number): void;
  noteOff(note?: number): void;
  allNotesOff(): void;
  process(output: Float32Array, frames?: number): void;
}

function renderTsEngine(engine: TsEngine, script: Voice303Script): Float32Array {
  const out = new Float32Array(script.totalFrames);
  const block = new Float32Array(128);
  let written = 0;
  playScript(
    script,
    block.length,
    (event) => {
      switch (event.kind) {
        case 'on':
          engine.noteOn(event.note, event.velocity);
          break;
        case 'off':
          engine.noteOff(event.note);
          break;
        case 'param': {
          const key = TS_PARAM_KEYS[event.id];
          if (key) engine.setParams({ [key]: event.value });
          break;
        }
        case 'alloff':
          engine.allNotesOff();
          break;
      }
    },
    (frames) => {
      engine.process(block, frames);
      out.set(block.subarray(0, frames), written);
      written += frames;
    },
  );
  return out;
}

/** Render a script through a resolved voice. */
export async function renderCompareVoice(
  voice: CompareVoice,
  script: Voice303Script,
  runners: BackendRunners,
): Promise<Float32Array> {
  switch (voice.backend) {
    case 'ts-open303':
      return renderTsEngine(new OfflineOpen303Engine(script.sampleRate, voice.id), script);
    case 'ts-highfid': {
      const engine = new OfflineHighFid303Engine(script.sampleRate);
      engine.setOversample(HIGHFID_OVERSAMPLE);
      return renderTsEngine(engine, script);
    }
    case 'native-open303':
      if (!runners.nativeOpen303) throw new Error('native open303 runner missing');
      return runners.nativeOpen303(voice.id, script);
    case 'native-jc303':
      if (!runners.nativeJc303) throw new Error('native jc303 runner missing');
      return runners.nativeJc303(script);
    case 'openrb338-wasm': {
      const mode = openrb338ModeForModel(voice.id);
      if (!mode || !runners.openrb338) throw new Error(`openrb338 runner missing for ${voice.id}`);
      return runners.openrb338(mode, script);
    }
    default:
      throw new Error(`voice ${voice.id} has no backend: ${voice.unavailableReason ?? 'unavailable'}`);
  }
}

/** The voice the others are measured against by default. */
export const DEFAULT_REFERENCE_VOICE = OPENRB338_V2_MODEL_ID;
