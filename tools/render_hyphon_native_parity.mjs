#!/usr/bin/env node
/**
 * Render the canonical 303 pattern (and a drum / Prophecy phrase) THROUGH a
 * built hyphon_native wasm, the way the AudioWorklets do: no Emscripten glue,
 * hand-built imports, export names resolved through the export-name map.
 *
 * Why this exists: `pnpm run test:native` and scripts/generate_303_baselines.sh
 * compile the DSP with the HOST g++, so they cannot see what em++ / wasm-opt /
 * LTO do to the shipped binary. This is the wasm-side gate for compiler and
 * link-flag changes (docs/wasm/BUILD_NOTES.md#render-parity).
 *
 * Usage:
 *   # render one build into a directory of raw little-endian float32 files
 *   node tools/render_hyphon_native_parity.mjs render \
 *       --wasm public/hyphon_native.st.wasm --map public/hyphon_wasm_export_map.st.json \
 *       --out /tmp/parity/new
 *
 *   # compare two renders (exit 1 on any difference above --max-abs)
 *   node tools/render_hyphon_native_parity.mjs compare /tmp/parity/old /tmp/parity/new [--max-abs 0]
 *
 *   # compare a render against the committed host-g++ 24-bit baseline WAVs
 *   node tools/render_hyphon_native_parity.mjs baselines /tmp/parity/new [--max-lsb N]
 *
 *   # heap high-water mark of a full voice set (wasm_memory_budget.json evidence)
 *   node tools/render_hyphon_native_parity.mjs heap --wasm … --map … [--sr 192000 --block 4096]
 *
 *   # CPU of the macro (Plaits) voices: every engine, 8 voices, as % of a quantum
 *   node tools/render_hyphon_native_parity.mjs macro-cpu --wasm … --map … [--sr 48000 --seconds 2 --mode held|sequenced]
 */
import fs from 'node:fs';
import path from 'node:path';

const SAMPLE_RATE = 48000;
const BLOCK = 128;
const STEP_BLOCKS = 57;
const ACCENT_VEL = 120;
const NORMAL_VEL = 90;
const PATTERN = [
  { note: 36, accent: false, legato: false },
  { note: 36, accent: true, legato: true },
  { note: 39, accent: false, legato: false },
  { note: 43, accent: true, legato: true },
];
// P_WAVEFORM..P_VOLUME as in emscripten/tests/tb303_baseline_dump.cpp.
const TB303_PARAMS = [
  [0, 0.0],
  [2, 0.35],
  [3, 0.7],
  [4, 0.55],
  [5, 0.5],
  [6, 0.7],
  [7, 0.8],
];
const OPEN303_MODELS = [
  'stock-open303',
  '1ink303-v1',
  'experimental-01',
  'rebirth-338-1.5',
  'rebirth-2.0',
  'mb33-mkii',
  'raveolution',
];
const WASM_PAGE = 65536;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

/** Instantiate like hyphonNativeSession: imported memory, no-op stubs, run ctors. */
function instantiate(wasmPath, mapPath) {
  const bytes = fs.readFileSync(wasmPath);
  const module = new WebAssembly.Module(bytes);
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const budget = JSON.parse(
    fs.readFileSync(new URL('../emscripten/wasm_memory_budget.json', import.meta.url), 'utf8'),
  );
  const threaded = WebAssembly.Module.imports(module).some(
    (i) => i.kind === 'function' && /thread|mailbox/.test(i.name),
  );
  const key = threaded ? 'hyphonNative' : 'hyphonNativeSt';
  const memory = new WebAssembly.Memory({
    initial: (budget[key].initialMemoryMb * 1024 * 1024) / WASM_PAGE,
    maximum: (budget[key].maximumMemoryMb * 1024 * 1024) / WASM_PAGE,
    shared: threaded,
  });

  const imports = {};
  const unknown = [];
  for (const imp of WebAssembly.Module.imports(module)) {
    imports[imp.module] ??= {};
    if (imp.kind === 'memory') {
      imports[imp.module][imp.name] = memory;
      continue;
    }
    if (imp.kind !== 'function') continue;
    if (imp.name === 'emscripten_resize_heap') {
      imports[imp.module][imp.name] = (requested) => {
        const need = Math.ceil((requested - memory.buffer.byteLength) / WASM_PAGE);
        try {
          memory.grow(Math.max(need, 1));
          return 1;
        } catch {
          return 0;
        }
      };
    } else if (imp.name === 'abort' || imp.name === '__cxa_throw') {
      imports[imp.module][imp.name] = () => {
        throw new Error(`wasm called ${imp.name}`);
      };
    } else if (imp.name === 'emscripten_get_now' || imp.name === 'emscripten_date_now') {
      imports[imp.module][imp.name] = () => 0;
    } else {
      unknown.push(`${imp.module}.${imp.name}`);
      imports[imp.module][imp.name] = () => 0;
    }
  }

  const instance = new WebAssembly.Instance(module, imports);
  const raw = instance.exports;
  const fn = (name) => {
    const minified = map[name] ?? name;
    const f = raw[minified];
    if (typeof f !== 'function') throw new Error(`export ${name} (${minified}) missing`);
    return f;
  };
  const has = (name) => typeof raw[map[name] ?? name] === 'function';
  const ctors = raw[map.__wasm_call_ctors ?? '__wasm_call_ctors'];
  if (typeof ctors === 'function') ctors();
  return { fn, has, memory, threaded, stubbed: unknown };
}

function readFloats(memory, ptr, n) {
  return new Float32Array(memory.buffer.slice(ptr, ptr + n * 4));
}

function renderTb303(api, prefix, { modelIndex, oversample } = {}) {
  const { fn, memory } = api;
  const h = fn(`${prefix}_create`)();
  const init = prefix === 'jc303' ? fn('jc303_init_handle') : fn(`${prefix}_init`);
  init(h, SAMPLE_RATE, BLOCK);
  if (modelIndex !== undefined && !fn('open303_set_model')(h, modelIndex)) {
    fn(`${prefix}_destroy`)(h);
    return null;
  }
  if (oversample) fn(`${prefix}_set_oversample`)(h, oversample);
  for (const [id, v] of TB303_PARAMS) fn(`${prefix}_set_param`)(h, id, v);

  const out = new Float32Array(PATTERN.length * STEP_BLOCKS * BLOCK);
  const scratch = prefix === 'jc303' ? 0 : fn('malloc')(BLOCK * 4);
  let w = 0;
  let prev = -1;
  for (const s of PATTERN) {
    if (!s.legato && prev >= 0) fn(`${prefix}_note_off`)(h, prev);
    fn(`${prefix}_note_on`)(h, s.note, s.accent ? ACCENT_VEL : NORMAL_VEL);
    prev = s.note;
    for (let b = 0; b < STEP_BLOCKS; b++) {
      let ptr;
      if (prefix === 'jc303') {
        ptr = Number(fn('jc303_process_handle')(h, BLOCK));
      } else {
        new Float32Array(memory.buffer, scratch, BLOCK).fill(0);
        fn(`${prefix}_process`)(h, scratch, BLOCK);
        ptr = scratch;
      }
      out.set(readFloats(memory, ptr, BLOCK), w);
      w += BLOCK;
    }
  }
  if (scratch) fn('free')(scratch);
  fn(`${prefix}_destroy`)(h);
  return out;
}

function renderProphecy(api) {
  const { fn, memory } = api;
  const h = fn('prophecy_create')();
  fn('prophecy_init')(h, SAMPLE_RATE, BLOCK);
  const out = new Float32Array(PATTERN.length * STEP_BLOCKS * BLOCK);
  let w = 0;
  let prev = -1;
  for (const s of PATTERN) {
    if (prev >= 0) fn('prophecy_note_off')(h, prev);
    fn('prophecy_note_on')(h, s.note + 12, s.accent ? 1.0 : 0.7);
    prev = s.note + 12;
    for (let b = 0; b < STEP_BLOCKS; b++) {
      out.set(readFloats(memory, Number(fn('prophecy_process')(h, BLOCK)), BLOCK), w);
      w += BLOCK;
    }
  }
  fn('prophecy_destroy')(h);
  return out;
}

function renderDrumkit(api, kit) {
  const { fn, memory } = api;
  const h = fn('drumkit_create')();
  fn('drumkit_init')(h, SAMPLE_RATE, BLOCK);
  fn('drumkit_set_kit')(h, kit);
  // kick, closed hat, snare, closed hat, kick, open hat, snare, closed hat
  const voices = [0, 2, 1, 2, 0, 3, 1, 2];
  const out = new Float32Array(voices.length * 24 * BLOCK);
  let w = 0;
  for (const v of voices) {
    fn('drumkit_trigger')(h, v, 0.9, 0.5, 0.5, 0.5, 0.5);
    for (let b = 0; b < 24; b++) {
      out.set(readFloats(memory, Number(fn('drumkit_process')(h, BLOCK)), BLOCK), w);
      w += BLOCK;
    }
  }
  fn('drumkit_destroy')(h);
  return out;
}

// MACRO_ENGINE order — src/engines/MacroParams.ts MACRO_ENGINES.
const MACRO_ENGINE_NAMES = [
  'va-vcf', 'phase-distortion', 'six-op-1', 'six-op-2', 'six-op-3', 'wave-terrain',
  'string-machine', 'chiptune', 'virtual-analog', 'waveshaper', 'fm', 'grain',
  'additive', 'wavetable', 'chords', 'speech', 'swarm', 'noise', 'particle',
  'string', 'modal', 'bass-drum', 'snare-drum', 'hi-hat',
];

/** The canonical pattern an octave up on one macro engine; left channel of the planar stereo block. */
function renderMacro(api, engine) {
  const { fn, memory } = api;
  const h = fn('macro_create')();
  fn('macro_init')(h, SAMPLE_RATE, BLOCK);
  fn('macro_set_param')(h, 0, engine);
  const out = new Float32Array(PATTERN.length * STEP_BLOCKS * BLOCK);
  let w = 0;
  let prev = -1;
  for (const s of PATTERN) {
    if (prev >= 0) fn('macro_note_off')(h, prev);
    fn('macro_note_on')(h, s.note + 12, s.accent ? 1.0 : 0.7);
    prev = s.note + 12;
    for (let b = 0; b < STEP_BLOCKS; b++) {
      out.set(readFloats(memory, Number(fn('macro_process')(h, BLOCK)), BLOCK), w);
      w += BLOCK;
    }
  }
  fn('macro_destroy')(h);
  return out;
}

/**
 * CPU of 8 macro voices per engine, as % of one 128-frame render quantum.
 * `held`: 8 notes held for the whole run (worst case). `sequenced`: 8-note
 * chords retriggered every 16th at 120 BPM with a 50 % gate — what a pattern
 * does, voices sleeping between hits.
 */
function macroCpu(args) {
  const api = instantiate(args.wasm, args.map);
  const { fn } = api;
  const sr = Number(args.sr ?? 48000);
  const seconds = Number(args.seconds ?? 2);
  const mode = args.mode ?? 'held';
  const quanta = Math.round((seconds * sr) / BLOCK);
  const budgetUs = (BLOCK / sr) * 1e6;
  const sixteenth = Math.round((0.125 * sr) / BLOCK);
  const rows = [];
  for (let e = 0; e < MACRO_ENGINE_NAMES.length; e++) {
    const h = fn('macro_create')();
    fn('macro_init')(h, sr, BLOCK);
    fn('macro_set_param')(h, 0, e);
    const notes = Array.from({ length: 8 }, (_, i) => 48 + 3 * i);
    const on = () => notes.forEach((n) => fn('macro_note_on')(h, n, 0.8));
    const off = () => notes.forEach((n) => fn('macro_note_off')(h, n));
    // Warm up the JIT on this engine before timing it.
    on();
    for (let q = 0; q < 200; q++) fn('macro_process')(h, BLOCK);
    if (mode === 'held') on();
    const t0 = process.hrtime.bigint();
    for (let q = 0; q < quanta; q++) {
      if (mode === 'sequenced') {
        const phase = q % sixteenth;
        if (phase === 0) on();
        else if (phase === sixteenth >> 1) off();
      }
      fn('macro_process')(h, BLOCK);
    }
    const us = Number(process.hrtime.bigint() - t0) / 1e3 / quanta;
    rows.push({ engine: MACRO_ENGINE_NAMES[e], usPerQuantum: Number(us.toFixed(1)), percentOfQuantum: Number(((100 * us) / budgetUs).toFixed(2)) });
    fn('macro_destroy')(h);
  }
  const worst = rows.reduce((a, b) => (b.usPerQuantum > a.usPerQuantum ? b : a));
  console.log(JSON.stringify({ wasm: path.basename(args.wasm), sampleRate: sr, mode, voices: 8, budgetUs: Number(budgetUs.toFixed(1)), worst, rows }, null, 2));
}

function findModelIndex(api, id) {
  const { fn } = api;
  const bytes = new TextEncoder().encode(`${id}\0`);
  const ptr = fn('malloc')(bytes.length);
  new Uint8Array(api.memory.buffer, ptr, bytes.length).set(bytes);
  const idx = fn('open303_find_model_index')(ptr);
  fn('free')(ptr);
  return idx;
}

function render(args) {
  if (!args.wasm || !args.map || !args.out) {
    throw new Error('render needs --wasm, --map and --out');
  }
  const api = instantiate(args.wasm, args.map);
  fs.mkdirSync(args.out, { recursive: true });
  const summary = { wasm: path.basename(args.wasm), threaded: api.threaded, stubbed: api.stubbed, renders: {} };
  const write = (name, data) => {
    if (!data) return;
    fs.writeFileSync(path.join(args.out, `${name}.f32`), Buffer.from(data.buffer));
    let peak = 0;
    let finite = true;
    for (const x of data) {
      if (!Number.isFinite(x)) finite = false;
      else peak = Math.max(peak, Math.abs(x));
    }
    summary.renders[name] = { samples: data.length, peak: Number(peak.toFixed(6)), finite };
  };

  for (const id of OPEN303_MODELS) {
    const idx = findModelIndex(api, id);
    if (idx < 0) continue;
    write(id, renderTb303(api, 'open303', { modelIndex: idx }));
  }
  write('jc303', renderTb303(api, 'jc303'));
  write('highfid-cpu', renderTb303(api, 'highfid303', { oversample: 4 }));
  write('prophecy', renderProphecy(api));
  write('drumkit-808', renderDrumkit(api, 0));
  write('drumkit-909', renderDrumkit(api, 1));
  // A build without the macro voices (before the macro-* family) just skips them.
  if (api.has('macro_create')) {
    MACRO_ENGINE_NAMES.forEach((name, e) => write(`macro-${name}`, renderMacro(api, e)));
  }
  fs.writeFileSync(path.join(args.out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

function loadF32(file) {
  const b = fs.readFileSync(file);
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}

function compare(args) {
  const [a, b] = args._;
  const maxAbs = Number(args['max-abs'] ?? 0);
  const names = fs.readdirSync(a).filter((f) => f.endsWith('.f32'));
  let failed = false;
  for (const f of names) {
    const pb = path.join(b, f);
    if (!fs.existsSync(pb)) {
      console.log(`${f}: MISSING in ${b}`);
      failed = true;
      continue;
    }
    const x = loadF32(path.join(a, f));
    const y = loadF32(pb);
    let max = 0;
    let diffs = 0;
    let sq = 0;
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const d = Math.abs(x[i] - y[i]);
      if (d !== 0 || Object.is(x[i], -0) !== Object.is(y[i], -0)) diffs++;
      max = Math.max(max, d);
      sq += d * d;
    }
    const rms = Math.sqrt(sq / x.length);
    const ok = x.length === y.length && max <= maxAbs;
    if (!ok) failed = true;
    console.log(
      `${ok ? 'OK  ' : 'FAIL'} ${f.padEnd(24)} ${diffs === 0 ? 'bit-identical' : `${diffs}/${x.length} differ, maxAbs=${max.toExponential(3)}, rms=${rms.toExponential(3)}`}`,
    );
  }
  process.exit(failed ? 1 : 0);
}

function readWav24(file) {
  const b = fs.readFileSync(file);
  const dataAt = b.indexOf('data', 12) + 8;
  const n = (b.length - dataAt) / 3;
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const o = dataAt + i * 3;
    out[i] = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) << 8 >> 8;
  }
  return out;
}

function baselines(args) {
  const [dir] = args._;
  const maxLsb = Number(args['max-lsb'] ?? Infinity);
  const baseDir = new URL('../docs/audio-engine/303-baseline/', import.meta.url).pathname;
  let failed = false;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.f32'))) {
    const wav = path.join(baseDir, `${f.replace(/\.f32$/, '')}_canonical.wav`);
    if (!fs.existsSync(wav)) continue;
    const ref = readWav24(wav);
    const x = loadF32(path.join(dir, f));
    let max = 0;
    let diffs = 0;
    for (let i = 0; i < Math.min(ref.length, x.length); i++) {
      const c = Math.max(-1, Math.min(1, x[i]));
      const q = Math.round(c * 8388607);
      const d = Math.abs(q - ref[i]);
      if (d) diffs++;
      max = Math.max(max, d);
    }
    const ok = ref.length === x.length && max <= maxLsb;
    if (!ok) failed = true;
    console.log(
      `${ok ? 'OK  ' : 'FAIL'} ${f.padEnd(24)} vs host-g++ baseline: ${diffs}/${ref.length} samples differ, max ${max} LSB (24-bit)`,
    );
  }
  process.exit(failed ? 1 : 0);
}

/**
 * Heap high-water mark for a worst-case live voice set. dlmalloc grows the heap
 * upward from __heap_base, so a fresh small allocation's address bounds what is
 * in use; it is sampled before any voice exists and after every voice has
 * rendered (internal buffers are sized lazily on the first process call).
 */
function heap(args) {
  const api = instantiate(args.wasm, args.map);
  const { fn, memory } = api;
  const sr = Number(args.sr ?? 192000);
  const block = Number(args.block ?? 4096);
  const probe = () => {
    const p = fn('malloc')(16);
    fn('free')(p);
    return p;
  };
  const before = probe();
  const voices = [];
  const scratch = fn('malloc')(block * 4);
  const add = (prefix, init, setup, process) => {
    const h = fn(`${prefix}_create`)();
    init(h);
    setup?.(h);
    voices.push(() => process(h));
  };
  const tb = (prefix, oversample) => (h) => {
    if (oversample) fn(`${prefix}_set_oversample`)(h, oversample);
    fn(`${prefix}_note_on`)(h, 36, 120);
  };
  for (let i = 0; i < 3; i++) {
    add('open303', (h) => fn('open303_init')(h, sr, block), tb('open303', 4), (h) => fn('open303_process')(h, scratch, block));
    add('jc303', (h) => fn('jc303_init_handle')(h, sr, block), tb('jc303'), (h) => fn('jc303_process_handle')(h, block));
    add('highfid303', (h) => fn('highfid303_init')(h, sr, block), tb('highfid303', 2), (h) => fn('highfid303_process')(h, scratch, block));
  }
  for (let i = 0; i < 2; i++) {
    add('prophecy', (h) => fn('prophecy_init')(h, sr, block), (h) => fn('prophecy_note_on')(h, 48, 1), (h) => fn('prophecy_process')(h, block));
  }
  add('drumkit', (h) => fn('drumkit_init')(h, sr, block), (h) => fn('drumkit_trigger')(h, 0, 1, 0.5, 0.5, 0.5, 0.5), (h) => fn('drumkit_process')(h, block));
  if (api.has('macro_create')) {
    // SYNTH A + SYNTH B on macro engines, all 8 voices of each sounding.
    for (let i = 0; i < 2; i++) {
      add(
        'macro',
        (h) => fn('macro_init')(h, sr, block),
        (h) => {
          for (let n = 0; n < 8; n++) fn('macro_note_on')(h, 48 + n, 0.8);
        },
        (h) => fn('macro_process')(h, block),
      );
    }
  }
  for (let b = 0; b < 8; b++) for (const run of voices) run();
  const after = probe();
  const mb = (n) => Number((n / 1048576).toFixed(3));
  const out = {
    wasm: path.basename(args.wasm),
    sampleRate: sr,
    block,
    voices: voices.length,
    staticAndStackMb: mb(before),
    voiceHeapMb: mb(after - before),
    highWaterMb: mb(after),
    memoryMb: mb(memory.buffer.byteLength),
  };
  console.log(JSON.stringify(out, null, 2));
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._.shift();
if (cmd === 'render') render(args);
else if (cmd === 'compare') compare(args);
else if (cmd === 'baselines') baselines(args);
else if (cmd === 'heap') heap(args);
else if (cmd === 'macro-cpu') macroCpu(args);
else {
  console.error('Usage: render_hyphon_native_parity.mjs render|compare|baselines|heap|macro-cpu … (see header)');
  process.exit(2);
}
