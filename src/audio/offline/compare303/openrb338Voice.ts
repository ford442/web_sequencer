/**
 * Drives `openrb338.wasm` (GPL-3.0-only, opt-in build) through its C ABI to
 * render an event script, for the voice comparison harness (#1543).
 *
 * Environment-agnostic: it takes the module's bytes (or exports), so the Node
 * CLI and tests read the file and the browser could fetch it. The module is
 * the same one `tools/verify-wasm.mjs` checks bit for bit against upstream
 * openrb-338 at 44.1 kHz, so a render here at 44.1 kHz is ReBirth 2.01's 303.
 */

import {
  OPENRB338_MODE_IDS,
  supportsOpenrb338,
  type Openrb338Exports,
  type Openrb338Mode,
} from '../../../audio-worklets/openrb338';
import { playScript, type Voice303Script } from './script';

/** Frames reserved in the voice's render buffer (one `openrb303_render` call at most). */
const MAX_FRAMES = 4096;

/** Instantiate the module (it has no imports) and check it speaks this ABI. */
export async function instantiateOpenrb338(bytes: BufferSource): Promise<Openrb338Exports> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  if (!supportsOpenrb338(instance.exports)) {
    throw new Error('openrb338.wasm does not satisfy the Openrb338Exports ABI');
  }
  return instance.exports;
}

/** Render `script` through one openrb-338 voice in `mode`. */
export function renderOpenrb338(
  exports: Openrb338Exports,
  mode: Openrb338Mode,
  script: Voice303Script,
): Float32Array {
  const handle = exports.openrb303_create(script.sampleRate, OPENRB338_MODE_IDS[mode]);
  if (handle === 0) throw new Error(`openrb303_create(${script.sampleRate}, ${mode}) failed`);
  try {
    const ptr = exports.openrb303_buffer(handle, MAX_FRAMES) >>> 0;
    const out = new Float32Array(script.totalFrames);
    let written = 0;
    playScript(
      script,
      MAX_FRAMES,
      (event) => {
        switch (event.kind) {
          case 'on':
            exports.openrb303_note_on(handle, event.note, event.velocity);
            break;
          case 'off':
            exports.openrb303_note_off(handle, event.note);
            break;
          case 'param':
            exports.openrb303_set_param(handle, event.id, event.value);
            break;
          case 'alloff':
            exports.openrb303_all_notes_off(handle);
            break;
        }
      },
      (frames) => {
        exports.openrb303_render(handle, frames);
        // memory.buffer can be replaced if the module grows, so view it per call.
        out.set(new Float32Array(exports.memory.buffer, ptr, frames), written);
        written += frames;
      },
    );
    return out;
  } finally {
    exports.openrb303_destroy(handle);
  }
}
