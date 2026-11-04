/**
 * Event script: the one input every 303 backend in the comparison harness
 * renders (#1543).
 *
 * A script is a list of timestamped note / param events at a fixed sample
 * rate. Each backend (TypeScript port, native C++ via a host build, the
 * openrb-338 wasm) is driven by the same list, so two renders of the same
 * script differ only by the voice's DSP. Param ids are the shared
 * `OPEN303_PARAM_IDS` (waveform 0, tuning 1, cutoff 2, resonance 3, env mod 4,
 * decay 5, accent 6, volume 7, filter mode 8, slide time 11), the same ones
 * every 303 engine takes.
 */

export type Voice303Event =
  | { frame: number; kind: 'on'; note: number; velocity: number }
  | { frame: number; kind: 'off'; note: number }
  | { frame: number; kind: 'param'; id: number; value: number }
  | { frame: number; kind: 'alloff' };

export interface Voice303Script {
  sampleRate: number;
  /** Frames to render, including the release tail after the last event. */
  totalFrames: number;
  /** Ascending by frame; events on one frame apply in list order. */
  events: Voice303Event[];
}

/** Shared Open303Param ids (see `OPEN303_PARAM_IDS`). */
export const PARAM = {
  waveform: 0,
  tuning: 1,
  cutoff: 2,
  resonance: 3,
  envMod: 4,
  decay: 5,
  accent: 6,
  volume: 7,
  filterMode: 8,
  slideTime: 11,
} as const;

/** MIDI velocity that is an accent (> `ACCENT_VELOCITY_THRESHOLD` = 100). */
export const ACCENT_VELOCITY = 127;
export const NORMAL_VELOCITY = 90;

/** Sort events by frame, keeping list order within a frame. */
export function sortEvents(events: readonly Voice303Event[]): Voice303Event[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((x, y) => x.event.frame - y.event.frame || x.index - y.index)
    .map((entry) => entry.event);
}

/**
 * Text form read by `emscripten/tests/port_baseline/event_render.cpp`
 * (the native backends).
 */
export function serializeScriptForNative(script: Voice303Script): string {
  const lines = [`sr ${script.sampleRate}`, `frames ${script.totalFrames}`];
  for (const e of sortEvents(script.events)) {
    switch (e.kind) {
      case 'on':
        lines.push(`e ${e.frame} on ${e.note} ${e.velocity}`);
        break;
      case 'off':
        lines.push(`e ${e.frame} off ${e.note}`);
        break;
      case 'param':
        // Round-trip a float32 exactly; the engines store the value as float.
        lines.push(`e ${e.frame} param ${e.id} ${Math.fround(e.value)}`);
        break;
      case 'alloff':
        lines.push(`e ${e.frame} alloff`);
        break;
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Walk a script in chunks of at most `maxBlock` frames, cut at every event, so
 * each event is applied on its exact frame. `render(frames)` is called for the
 * audio between events, `apply(event)` for each event.
 */
export function playScript(
  script: Voice303Script,
  maxBlock: number,
  apply: (event: Voice303Event) => void,
  render: (frames: number) => void,
): void {
  let pos = 0;
  const renderTo = (target: number) => {
    const end = Math.min(target, script.totalFrames);
    while (pos < end) {
      const n = Math.min(maxBlock, end - pos);
      render(n);
      pos += n;
    }
  };
  for (const event of sortEvents(script.events)) {
    renderTo(event.frame);
    apply(event);
  }
  renderTo(script.totalFrames);
}
