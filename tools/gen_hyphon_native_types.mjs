#!/usr/bin/env node
/**
 * Generate the typed surfaces hyphon_native shares with TypeScript (#1344 P4,
 * #1497 P1):
 *
 *   src/shared/rt/hyphonNativeExports.ts   the wasm exports, typed
 *   src/shared/rt/eventLayout.ts           the control-plane record: offsets,
 *                                          type ids, EventWriter / EventReader,
 *                                          the event ring header words
 *   emscripten/core/event_layout.h         the same for C++: hyphon::Event,
 *                                          hyphon::EventType, EventRingHeader,
 *                                          static_asserts
 *
 * Inputs, so nothing here is a hand-kept list:
 *   emscripten/core/event_schema.json      the record layout, its types and the
 *                                           ring header (#1497 P2)
 *   emscripten/wasm_export_manifest.json   which names exist (required / optional)
 *   emscripten/*_wrapper.cpp                their EMSCRIPTEN_KEEPALIVE prototypes,
 *                                           and the engine-private event enums
 *   emscripten/core/voice_exports.h         the HYPHON_EXPORT_VOICE signatures,
 *                                           expanded for every engine that uses it
 *
 * Usage:
 *   node tools/gen_hyphon_native_types.mjs           write the files
 *   node tools/gen_hyphon_native_types.mjs --check   exit 1 if any is stale
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXPORTS_OUTPUT = 'src/shared/rt/hyphonNativeExports.ts';
export const EVENT_SCHEMA = 'emscripten/core/event_schema.json';
export const EVENT_LAYOUT_TS = 'src/shared/rt/eventLayout.ts';
export const EVENT_LAYOUT_H = 'emscripten/core/event_layout.h';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** Wrappers compiled into hyphon_native (rubberband_wrapper.cpp is its own module). */
function wrapperSources() {
  return fs
    .readdirSync(path.join(REPO_ROOT, 'emscripten'))
    .filter((f) => f.endsWith('_wrapper.cpp') && f !== 'rubberband_wrapper.cpp')
    .sort()
    .map((f) => ({ file: `emscripten/${f}`, text: read(`emscripten/${f}`) }));
}

/** `int a, float b` → [{ type, name }]. */
function parseParams(list) {
  const trimmed = list.replace(/\s+/g, ' ').trim();
  if (trimmed === '' || trimmed === 'void') return [];
  return trimmed.split(',').map((p) => {
    const m = p.trim().match(/^(.*?)([A-Za-z_]\w*)$/);
    if (!m) throw new Error(`cannot parse parameter "${p}"`);
    return { type: m[1].replace(/\s+/g, ' ').trim(), name: m[2] };
  });
}

/** EMSCRIPTEN_KEEPALIVE <ret> <name>(<params>) — possibly split across lines. */
function parsePrototypes(text) {
  const out = new Map();
  const re = /EMSCRIPTEN_KEEPALIVE\s+([A-Za-z_][\w\s*]*?)\s*\b([a-z]\w*)\s*\(([^)]*)\)/g;
  for (const m of text.matchAll(re)) {
    out.set(m[2], { ret: m[1].replace(/\s+/g, ' ').trim(), params: parseParams(m[3]) });
  }
  return out;
}

/** The macro's prototypes with `prefix##_` left as a placeholder. */
function macroPrototypes() {
  const text = read('emscripten/core/voice_exports.h').replace(/\\\n/g, '\n');
  const out = new Map();
  const re = /EMSCRIPTEN_KEEPALIVE\s+([A-Za-z_][\w\s*]*?)\s*prefix##_(\w+)\s*\(([^)]*)\)/g;
  for (const m of text.matchAll(re)) {
    out.set(m[2], { ret: m[1].replace(/\s+/g, ' ').trim(), params: parseParams(m[3]) });
  }
  return out;
}

function voicePrefixes(sources) {
  return sources.flatMap(({ text }) => [...text.matchAll(/^HYPHON_EXPORT_VOICE\((\w+),/gm)].map((m) => m[1]));
}

const NUMERIC = new Set(['int', 'float', 'double', 'size_t', 'uint32_t', 'int32_t', 'unsigned', 'bool']);

function tsType(cType, name, fnName) {
  if (cType === 'void') return 'void';
  if (/char\s*\*$/.test(cType) || /\*$/.test(cType)) return 'WasmPtr';
  if (cType === 'uintptr_t') {
    if (name === 'h' || name === 'handle') return 'VoiceHandle';
    if (name === '' && /_create$/.test(fnName)) return 'VoiceHandle';
    return 'WasmPtr';
  }
  if (NUMERIC.has(cType)) return 'number';
  throw new Error(`no TS type for C type "${cType}" (${fnName})`);
}

/** Runtime / allocator exports with no prototype in the wrappers. */
const BUILTIN = new Map([
  ['malloc', { ret: 'uintptr_t', params: [{ type: 'size_t', name: 'bytes' }] }],
  ['free', { ret: 'void', params: [{ type: 'uintptr_t', name: 'ptr' }] }],
]);

/** enum Name : uint16_t { kA = 1, kB = hyphon::kEngine + 1 } → { A: 1, B: 257 }. */
function parseEnum(text, enumName, scope) {
  const m = text.match(new RegExp(`enum\\s+${enumName}\\s*:\\s*\\w+\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`enum ${enumName} not found`);
  const body = m[1].replace(/\/\/[^\n]*/g, '');
  const values = {};
  for (const entry of body.split(',')) {
    const e = entry.trim();
    if (!e) continue;
    const [name, expr] = e.split('=').map((s) => s.trim());
    const resolved = expr.replace(/hyphon::(k\w+)/g, (_, k) => {
      if (!(k in scope)) throw new Error(`unknown ${k} in ${enumName}`);
      return String(scope[k]);
    });
    if (!/^[\d\sx+a-fA-F-]+$/.test(resolved)) throw new Error(`cannot evaluate ${enumName}.${name} = ${expr}`);
    // Only digits, hex literals and "+" reach here (checked above).
    values[name] = resolved.split('+').reduce((acc, t) => acc + Number(t.trim()), 0);
  }
  return values;
}

const stripK = (values, prefix = '') =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k.replace(new RegExp(`^k${prefix}`), ''), v]));

function formatConst(name, doc, values) {
  const body = Object.entries(values)
    .map(([k, v]) => `  ${k}: ${v >= 0x100 ? `0x${v.toString(16)}` : v},`)
    .join('\n');
  return `/** ${doc} */\nexport const ${name} = {\n${body}\n} as const;\n`;
}

// ── Event schema (#1497) ────────────────────────────────────────────────────

/** Field kinds the two emitters know, with their size (= alignment) in bytes. */
const FIELD_KINDS = {
  int64: { bytes: 8, cpp: 'int64_t', zero: '0' },
  uint16: { bytes: 2, cpp: 'uint16_t', zero: '0' },
  float32: { bytes: 4, cpp: 'float', zero: '0.0f' },
};

const SYMBOL = /^[A-Z][A-Za-z0-9]*$/;
const NAME = /^[A-Z][A-Z0-9_]*$/;
const FIELD = /^[a-z][A-Za-z0-9]*$/;

/**
 * Reads and validates event_schema.json, and lays the record out: fields in
 * order at natural alignment, which must come to record.bytes exactly.
 */
export function loadEventSchema(text = read(EVENT_SCHEMA)) {
  const schema = JSON.parse(text);
  const fail = (msg) => {
    throw new Error(`${EVENT_SCHEMA}: ${msg}`);
  };
  if (!Number.isInteger(schema.version) || schema.version < 1) fail('version must be a positive integer');

  let offset = 0;
  let maxAlign = 1;
  const fields = (schema.record?.fields ?? []).map((f) => {
    const kind = FIELD_KINDS[f.type];
    if (!kind) fail(`field ${f.name}: unknown type "${f.type}" (known: ${Object.keys(FIELD_KINDS).join(', ')})`);
    if (!FIELD.test(f.name ?? '')) fail(`field name "${f.name}" is not a lowerCamel identifier`);
    const count = f.count ?? 1;
    if (!Number.isInteger(count) || count < 1) fail(`field ${f.name}: count must be a positive integer`);
    if (offset % kind.bytes !== 0) fail(`field ${f.name} (${f.type}) would sit at byte ${offset}, not ${kind.bytes}-aligned`);
    const field = { ...f, count, kind, offset, array: f.count !== undefined };
    offset += kind.bytes * count;
    maxAlign = Math.max(maxAlign, kind.bytes);
    return field;
  });
  if (fields.length === 0) fail('record.fields is empty');
  if (offset !== schema.record.bytes) fail(`fields take ${offset} bytes, record.bytes says ${schema.record.bytes}`);
  if (schema.record.bytes % maxAlign !== 0) fail(`record.bytes is not a multiple of its alignment (${maxAlign})`);

  const types = schema.types ?? [];
  const base = schema.engineBase;
  if (!base || !SYMBOL.test(base.symbol ?? '') || !Number.isInteger(base.id)) fail('engineBase needs a symbol and an integer id');
  const ids = new Set();
  const symbols = new Set([base.symbol]);
  for (const t of types) {
    if (!NAME.test(t.name ?? '')) fail(`type name "${t.name}" is not UPPER_SNAKE`);
    if (!SYMBOL.test(t.symbol ?? '')) fail(`type ${t.name}: symbol "${t.symbol}" is not PascalCase`);
    if (!Number.isInteger(t.id) || t.id < 1 || t.id >= base.id) fail(`type ${t.name}: id must be 1..${base.id - 1}`);
    if (ids.has(t.id)) fail(`type id ${t.id} is used twice`);
    if (symbols.has(t.symbol)) fail(`type symbol ${t.symbol} is used twice`);
    ids.add(t.id);
    symbols.add(t.symbol);
    const argField = fields.find((f) => f.name === 'args');
    for (const [i, a] of (t.args ?? []).entries()) {
      if (!FIELD.test(a.name ?? '')) fail(`type ${t.name}: arg ${i} name "${a.name}" is not lowerCamel`);
      if (!argField || i >= argField.count) fail(`type ${t.name}: names more arg slots than the record has`);
    }
  }
  for (const list of ['targets', 'expressionDimensions']) {
    const seen = new Set();
    for (const e of schema[list] ?? []) {
      if (!SYMBOL.test(e.symbol ?? '') || !Number.isInteger(e.id)) fail(`${list}: each entry needs a PascalCase symbol and an integer id`);
      if (seen.has(e.symbol)) fail(`${list}: ${e.symbol} is used twice`);
      seen.add(e.symbol);
    }
  }
  return { ...schema, fields, types, base, bytes: schema.record.bytes, ring: loadRing(schema.ring, fail) };
}

/** Header words both ends of a ring need, whatever else the schema adds. */
const RING_WORDS = ['write', 'dropped', 'highWater', 'read', 'magic', 'version', 'capacity'];
/** Words the two ends publish to each other with atomics. */
const RING_ATOMIC_WORDS = ['write', 'dropped', 'highWater', 'read'];

/**
 * The event ring's header (#1497 P2): JS writes the C++ ring in place, so the
 * word indices, the header size and the magic come from here for both sides.
 */
function loadRing(ring, fail) {
  if (!ring) fail('ring is missing');
  const { headerBytes, magic } = ring;
  if (!Number.isInteger(headerBytes) || headerBytes <= 0 || headerBytes % 64 !== 0) {
    fail('ring.headerBytes must be a positive multiple of 64 (records stay cache-line aligned)');
  }
  if (typeof magic !== 'string' || !/^[\x20-\x7e]{4}$/.test(magic)) fail('ring.magic must be 4 printable ASCII characters');
  const slots = headerBytes / 4;
  const seen = new Map();
  const words = (ring.words ?? []).map((w) => {
    if (!FIELD.test(w.name ?? '')) fail(`ring word name "${w.name}" is not lowerCamel`);
    if (seen.has(w.name)) fail(`ring word ${w.name} is listed twice`);
    if (!Number.isInteger(w.index) || w.index < 0 || w.index >= slots) fail(`ring word ${w.name}: index must be 0..${slots - 1}`);
    if ([...seen.values()].some((v) => v.index === w.index)) fail(`ring word index ${w.index} is used twice`);
    const word = { name: w.name, index: w.index, atomic: w.atomic === true, doc: w.doc ?? '' };
    seen.set(w.name, word);
    return word;
  });
  for (const name of RING_WORDS) if (!seen.has(name)) fail(`ring.words needs "${name}"`);
  for (const name of RING_ATOMIC_WORDS) if (!seen.get(name).atomic) fail(`ring word ${name} must be atomic`);
  // The two ends write these: sharing a 64-byte line would bounce it between cores.
  if (seen.get('write').index >> 4 === seen.get('read').index >> 4) fail('ring words write and read must sit on different 64-byte lines');
  const magicValue = [...magic].reduce((v, ch, i) => v + ch.charCodeAt(0) * 2 ** (8 * i), 0);
  return { headerBytes, magic, magicValue, words: words.sort((a, b) => a.index - b.index) };
}

/** hyphon::EventType as C++ enumerator → value, for the wrappers' `hyphon::k…` expressions. */
function eventTypeScope(schema) {
  const scope = Object.fromEntries(schema.types.map((t) => [`k${t.symbol}`, t.id]));
  scope[`k${schema.base.symbol}`] = schema.base.id;
  return scope;
}

const hex = (v) => (v >= 0x100 ? `0x${v.toString(16)}` : String(v));
const hexUpper = (v) => (v >= 0x100 ? `0x${v.toString(16).toUpperCase()}` : String(v));
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));

/** The JS parameter names of a record: scalars by field name, arrays as a0..aN. */
function recordParams(schema) {
  return schema.fields.flatMap((f) =>
    f.array ? Array.from({ length: f.count }, (_, i) => ({ field: f, name: `${f.name[0]}${i}`, index: i })) : [{ field: f, name: f.name, index: 0 }],
  );
}

/** Index expression of a param in the typed view its kind uses. */
function viewIndex(p, recordWords) {
  const k = p.field.kind;
  const elem = k.bytes === 8 ? 4 : k.bytes; // int64 is written as two int32 words
  const at = p.field.offset / elem + p.index * (k.bytes / elem);
  const base = k.bytes === 2 ? 'h' : 'w';
  return { base, at, recordWords };
}

export function generateEventLayoutTs(schema = loadEventSchema()) {
  const params = recordParams(schema);
  const words = schema.bytes / 4;
  const halves = schema.bytes / 2;
  if (!Number.isInteger(Math.log2(words))) throw new Error(`${EVENT_SCHEMA}: record.bytes must be a power of two`);
  const wordShift = Math.log2(words);
  const halfShift = Math.log2(halves);

  const offsetDocs = schema.fields
    .map((f) => `  /** ${f.type}${f.array ? `[${f.count}]` : ''}: ${f.doc} */\n  ${f.name}: ${f.offset},`)
    .join('\n');
  const typeLines = schema.types
    .map((t) => `  /** ${t.name}: ${t.doc} */\n  ${t.symbol}: ${hex(t.id)},`)
    .concat(`  /** ${schema.base.doc} */\n  ${schema.base.symbol}: ${hex(schema.base.id)},`)
    .join('\n');
  const names = schema.types.map((t) => `  ${t.id}: '${t.name}',`).join('\n');
  const argLines = schema.types
    .filter((t) => t.args?.length)
    .map((t) => `  ${t.symbol}: {\n${t.args.map((a, i) => `    /** ${a.doc} */\n    ${a.name}: ${i},`).join('\n')}\n  },`)
    .join('\n');
  const enumBlock = (list) => (schema[list] ?? []).map((e) => `  /** ${e.doc} */\n  ${e.symbol}: ${hex(e.id)},`).join('\n');
  const cancelled = schema.types.filter((t) => t.cancelledByStop);
  const cancelExpr = cancelled.length ? cancelled.map((t) => `type === ${t.id}`).join(' || ') : 'false';

  const fieldIndex = params.map((p, i) => `  ${p.name}: ${i},`).join('\n');
  const sig = params.map((p) => (p.field.array ? `${p.name} = 0` : `${p.name}: number`));
  sig.unshift('slot: number');
  // One emitter per access style: positional args / EventRecord fields, or a
  // Float64Array of fields (EventField order).
  const accessors = (src, dst) => {
    const writes = [];
    const reads = [];
    params.forEach((p, i) => {
      const { base, at } = viewIndex(p, words);
      const idx = (n) => `${base}${n === 0 ? '' : ` + ${n}`}`;
      const from = src(p, i);
      const to = dst(p, i);
      if (p.field.type === 'int64') {
        // A Float64Array element is read once, into a local.
        const v = p.name;
        if (from !== p.name) writes.push(`    const ${v} = ${from};`);
        writes.push(
          `    const hi = Math.floor(${v} / TWO_32);`,
          `    this.i32[${idx(at)}] = ${v} - hi * TWO_32;`,
          `    this.i32[${idx(at + 1)}] = hi;`,
        );
        reads.push(`    ${to} = this.i32[${idx(at + 1)}] * TWO_32 + (this.i32[${idx(at)}] >>> 0);`);
      } else {
        const view = p.field.type === 'uint16' ? 'u16' : 'f32';
        writes.push(`    this.${view}[${idx(at)}] = ${from};`);
        reads.push(`    ${to} = this.${view}[${idx(at)}];`);
      }
    });
    return { writes, reads };
  };
  const named = accessors((p) => p.name, (p) => `out.${p.name}`);
  const indexed = accessors((_, i) => `fields[${i}]`, (_, i) => `out[${i}]`);
  const writes = named.writes;
  const reads = named.reads;
  const frameField = schema.fields.find((f) => f.name === 'frame' && f.type === 'int64');
  const typeField = schema.fields.find((f) => f.name === 'type' && f.type === 'uint16');
  if (!frameField || !typeField) throw new Error(`${EVENT_SCHEMA}: the record needs an int64 frame and a uint16 type`);
  const usesHalves = params.some((p) => p.field.type === 'uint16');
  const ring = schema.ring;
  const ringWords = ring.words.map((w) => `  /** ${w.doc} */\n  ${w.name}: ${w.index},`).join('\n');

  return [
    '// GENERATED by tools/gen_hyphon_native_types.mjs — do not edit.',
    `// Source: ${EVENT_SCHEMA}. Regenerate: pnpm run gen:native-types`,
    '//',
    '// The real-time control-plane record (#1497): its layout, type ids and a',
    '// typed, allocation-free writer and reader. hyphon::Event',
    `// (${EVENT_LAYOUT_H}) is generated from the same schema, so the two`,
    '// sides cannot drift. Shared real-time code: ES2022 only.',
    '',
    `/** ${EVENT_SCHEMA} version. */`,
    `export const EVENT_SCHEMA_VERSION = ${schema.version};`,
    '/** Bytes per record (sizeof(hyphon::Event)). */',
    `export const EVENT_BYTES = ${schema.bytes};`,
    '',
    '/** Byte offset of each field in a record. */',
    'export const EventOffset = {',
    offsetDocs,
    '} as const;',
    '',
    '/** hyphon::EventType. Ids are wire format. */',
    'export const EventType = {',
    typeLines,
    '} as const;',
    '',
    '/** Record name of each EventType id, for logs and telemetry. */',
    'export const EVENT_TYPE_NAMES: Readonly<Record<number, string>> = {',
    names,
    '};',
    '',
    '/** Named arg slots: `EventArg.<Type>.<name>` indexes args (a0..a3). */',
    'export const EventArg = {',
    argLines,
    '} as const;',
    '',
    '/** Special `target` values. */',
    'export const EventTargetId = {',
    enumBlock('targets'),
    '} as const;',
    '',
    '/** NOTE_EXPRESSION dimensions (`EventArg.NoteExpression.dimension`). */',
    'export const ExpressionDimension = {',
    enumBlock('expressionDimensions'),
    '} as const;',
    '',
    '/** Types a transport stop or a mute cancels: anything that starts or ends a sound. */',
    'export function isNoteEventType(type: number): boolean {',
    `  return ${cancelExpr};`,
    '}',
    '',
    '/** One decoded record. Reuse one instance: reading into it allocates nothing. */',
    'export interface EventRecord {',
    ...params.map((p) => `  ${p.name}: number;`),
    '}',
    '',
    '/** A record as an EventRecord: fine off the audio path. Storing a double into a field boxes it. */',
    'export function createEventRecord(): EventRecord {',
    `  return { ${params.map((p) => `${p.name}: 0`).join(', ')} };`,
    '}',
    '',
    '/**',
    ' * Index of each field in a Float64Array record (createEventFields). Typed-array',
    ' * elements hold doubles unboxed, so staging or decoding a record this way',
    ' * allocates nothing, whatever the JIT inlines: use it on hot paths.',
    ' */',
    'export const EventField = {',
    fieldIndex,
    '} as const;',
    '',
    `export const EVENT_FIELD_COUNT = ${params.length};`,
    '',
    'export function createEventFields(): Float64Array {',
    `  return new Float64Array(${params.length});`,
    '}',
    '',
    '/**',
    ' * The event ring header (hyphon::EventRingHeader): int32 words, then the',
    ' * records from EVENT_RING_HEADER_BYTES. eventRing.ts reads and writes it, in a',
    ' * SharedArrayBuffer of its own or in place inside hyphon_native memory.',
    ' */',
    `export const EVENT_RING_HEADER_BYTES = ${ring.headerBytes};`,
    `/** '${ring.magic}', little-endian: the magic word of a ring that is laid out. */`,
    `export const EVENT_RING_MAGIC = 0x${ring.magicValue.toString(16)};`,
    '',
    '/** Int32 index of each event ring header word. */',
    'export const EventRingWord = {',
    ringWords,
    '} as const;',
    '',
    'const TWO_32 = 4294967296;',
    '// wasm memory is little-endian; typed arrays use the platform order.',
    'const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;',
    '',
    '/**',
    ' * Typed views over `capacity` consecutive records from `byteOffset` (8-aligned)',
    ' * of an ArrayBuffer, a SharedArrayBuffer or a wasm memory buffer.',
    ' */',
    'export class EventViews {',
    '  readonly capacity: number;',
    '  readonly i32: Int32Array;',
    '  readonly u16: Uint16Array;',
    '  readonly f32: Float32Array;',
    '',
    `  constructor(buffer: ArrayBufferLike, byteOffset = 0, capacity = Math.floor((buffer.byteLength - byteOffset) / ${schema.bytes})) {`,
    "    if (!LITTLE_ENDIAN) throw new Error('event records are little-endian (wasm byte order)');",
    '    if (byteOffset % 8 !== 0) throw new Error(`event records must start 8-aligned (byteOffset ${byteOffset})`);',
    `    if (!Number.isInteger(capacity) || capacity < 0 || byteOffset + capacity * ${schema.bytes} > buffer.byteLength) {`,
    '      throw new Error(`${capacity} event records do not fit at byte ${byteOffset} of ${buffer.byteLength}`);',
    '    }',
    '    this.capacity = capacity;',
    `    this.i32 = new Int32Array(buffer, byteOffset, capacity * ${words});`,
    `    this.u16 = new Uint16Array(buffer, byteOffset, capacity * ${halves});`,
    `    this.f32 = new Float32Array(buffer, byteOffset, capacity * ${words});`,
    '  }',
    '',
    '  /**',
    '   * Copies record `from` of `source` — the int32 words of another run of',
    '   * records, such as another EventViews.i32 — into `slot`, bit for bit.',
    '   */',
    '  copyFrom(slot: number, source: Int32Array, from: number): void {',
    `    const w = slot << ${wordShift};`,
    `    const s = from << ${wordShift};`,
    `    for (let i = 0; i < ${words}; i++) this.i32[w + i] = source[s + i];`,
    '  }',
    '}',
    '',
    '/** Writes records. `frame` must be an integer (|frame| < 2^53); NaN writes 0, the next block. */',
    'export class EventWriter extends EventViews {',
    `  write(${sig.join(', ')}): void {`,
    `    const w = slot << ${wordShift};`,
    ...(usesHalves ? [`    const h = slot << ${halfShift};`] : []),
    ...writes,
    '  }',
    '',
    '  /** write() from a Float64Array record (EventField order). */',
    '  writeFrom(slot: number, fields: Float64Array): void {',
    `    const w = slot << ${wordShift};`,
    ...(usesHalves ? [`    const h = slot << ${halfShift};`] : []),
    ...indexed.writes,
    '  }',
    '}',
    '',
    '/** Reads records into an EventRecord. */',
    'export class EventReader extends EventViews {',
    '  read(slot: number, out: EventRecord): EventRecord {',
    `    const w = slot << ${wordShift};`,
    ...(usesHalves ? [`    const h = slot << ${halfShift};`] : []),
    ...reads,
    '    return out;',
    '  }',
    '',
    '  /** read() into a Float64Array record (EventField order): allocates nothing. */',
    '  readInto(slot: number, out: Float64Array): void {',
    `    const w = slot << ${wordShift};`,
    ...(usesHalves ? [`    const h = slot << ${halfShift};`] : []),
    ...indexed.reads,
    '  }',
    '',
    '  frameAt(slot: number): number {',
    `    const w = slot << ${wordShift};`,
    `    return this.i32[w + ${frameField.offset / 4 + 1}] * TWO_32 + (this.i32[w${frameField.offset ? ` + ${frameField.offset / 4}` : ''}] >>> 0);`,
    '  }',
    '',
    '  typeAt(slot: number): number {',
    `    return this.u16[(slot << ${halfShift}) + ${typeField.offset / 2}];`,
    '  }',
    '}',
    '',
  ].join('\n');
}

export function generateEventLayoutH(schema = loadEventSchema()) {
  const typeRows = schema.types.map((t) => [`k${t.symbol}`, hexUpper(t.id), `${t.name}: ${t.doc}`]);
  typeRows.push([`k${schema.base.symbol}`, hexUpper(schema.base.id), schema.base.doc]);
  const width = Math.max(...typeRows.map(([n]) => n.length));
  const enumBody = typeRows.map(([n, v, d]) => `    ${pad(n, width)} = ${pad(`${v},`, 6)} // ${d}`).join('\n');
  const dims = schema.expressionDimensions ?? [];
  const dimWidth = Math.max(0, ...dims.map((e) => `kExpression${e.symbol}`.length));
  const dimBody = dims.map((e) => `    ${pad(`kExpression${e.symbol}`, dimWidth)} = ${pad(`${hexUpper(e.id)},`, 6)} // ${e.doc}`).join('\n');
  const targets = (schema.targets ?? []).map((e) => `constexpr uint16_t kTarget${e.symbol} = 0x${e.id.toString(16).toUpperCase()};  // ${e.doc}`);
  const args = schema.types.flatMap((t) =>
    (t.args ?? []).map((a, i) => `constexpr int k${t.symbol}Arg${a.name[0].toUpperCase()}${a.name.slice(1)} = ${i};  // ${t.name}: ${a.doc}`),
  );
  const fieldWidth = Math.max(...schema.fields.map((f) => f.kind.cpp.length));
  const nameWidth = Math.max(...schema.fields.map((f) => (f.array ? `${f.name}[${f.count}]` : f.name).length));
  const fieldLines = schema.fields.map((f) => {
    const decl = f.array ? `${f.name}[${f.count}]` : f.name;
    const init = f.array ? `{${Array(f.count).fill(f.kind.zero).join(', ')}}` : f.kind.zero;
    return `    ${pad(f.kind.cpp, fieldWidth)} ${pad(decl, nameWidth)} = ${init};  // ${f.doc}`;
  });
  const offsetAsserts = schema.fields.map(
    (f) => `static_assert(offsetof(Event, ${f.name}) == ${f.offset}, "Event::${f.name} moved: regenerate from ${EVENT_SCHEMA}");`,
  );
  const cancelled = schema.types.filter((t) => t.cancelledByStop);
  const cancelExpr = cancelled.length ? cancelled.map((t) => `type == k${t.symbol}`).join(' || ') : 'false';

  // EventRingHeader: one uint32 per word, at its index, padded between.
  const ring = schema.ring;
  const ringLines = [];
  let at = 0;
  const padTo = (index) => {
    if (index > at) ringLines.push(`    uint32_t pad${at}_[${index - at}] = {};`);
    at = index;
  };
  const ringInit = { magic: 'kEventRingMagic', version: 'kEventSchemaVersion' };
  const ringWidth = Math.max(...ring.words.map((w) => (w.atomic ? `std::atomic<uint32_t> ${w.name}{0};` : `uint32_t ${w.name} = ${ringInit[w.name] ?? '0'};`).length));
  for (const w of ring.words) {
    padTo(w.index);
    const decl = w.atomic ? `std::atomic<uint32_t> ${w.name}{0};` : `uint32_t ${w.name} = ${ringInit[w.name] ?? '0'};`;
    ringLines.push(`    ${pad(decl, ringWidth)}  // ${w.doc}`);
    at = w.index + 1;
  }
  padTo(ring.headerBytes / 4);
  const ringAsserts = ring.words.map(
    (w) => `static_assert(offsetof(EventRingHeader, ${w.name}) == ${w.index * 4}, "EventRingHeader::${w.name} moved: regenerate from ${EVENT_SCHEMA}");`,
  );

  return [
    '// GENERATED by tools/gen_hyphon_native_types.mjs — do not edit.',
    `// Source: ${EVENT_SCHEMA}. Regenerate: pnpm run gen:native-types`,
    '//',
    '// The real-time control-plane record (#1497): hyphon::Event, the event type',
    '// ids, the named arg slots and the event ring header. The JS side',
    `// (${EVENT_LAYOUT_TS}) is generated from the same schema, so the JS`,
    '// writers and these structs cannot drift.',
    '#pragma once',
    '',
    '#include <atomic>',
    '#include <cstddef>',
    '#include <cstdint>',
    '#include <type_traits>',
    '',
    'namespace hyphon {',
    '',
    `constexpr uint32_t kEventSchemaVersion = ${schema.version};`,
    `constexpr size_t kEventBytes = ${schema.bytes};`,
    '',
    'enum EventType : uint16_t {',
    enumBody,
    '};',
    '',
    '/** NOTE_EXPRESSION dimension, in args[kNoteExpressionArgDimension]. */',
    'enum ExpressionDimension : uint16_t {',
    dimBody,
    '};',
    '',
    ...targets,
    '',
    '// Named arg slots: Event::args[k<Type>Arg<Name>].',
    ...args,
    '',
    'struct Event {',
    ...fieldLines,
    '};',
    `static_assert(sizeof(Event) == kEventBytes, "Event layout is shared with the JS side (${EVENT_SCHEMA})");`,
    ...offsetAsserts,
    'static_assert(std::is_trivially_copyable<Event>::value, "Event is copied by value through the ring");',
    '',
    '/** Types a stop / mute cancels: anything that starts or ends a sound. */',
    'constexpr bool isNoteEventType(uint16_t type) {',
    `    return ${cancelExpr};`,
    '}',
    '',
    '// ── Event ring header ─────────────────────────────────────────────────────',
    '',
    `constexpr size_t kEventRingHeaderBytes = ${ring.headerBytes};`,
    `constexpr uint32_t kEventRingMagic = 0x${ring.magicValue.toString(16).toUpperCase()};  // '${ring.magic}', little-endian`,
    '',
    '/**',
    ' * The first kEventRingHeaderBytes of a hyphon::EventRing, the records after',
    ' * it. The JS side reads and writes these words in place (eventRing.ts), so',
    ' * a producer on the main thread can fill a voice\'s ring inside hyphon_native',
    ' * memory with no copy and no message.',
    ' */',
    'struct alignas(64) EventRingHeader {',
    ...ringLines,
    '};',
    `static_assert(sizeof(EventRingHeader) == kEventRingHeaderBytes, "the ring header is shared with the JS side (${EVENT_SCHEMA})");`,
    'static_assert(std::is_standard_layout<EventRingHeader>::value, "offsetof needs a standard-layout header");',
    'static_assert(sizeof(std::atomic<uint32_t>) == 4, "a ring count is one plain 32-bit word to the JS side");',
    '// The single-threaded wasm build has no atomics feature and lowers these to',
    '// plain loads and stores; where threads exist, JS Atomics need the same word.',
    '#if defined(__EMSCRIPTEN_PTHREADS__) || !defined(__EMSCRIPTEN__)',
    'static_assert(std::atomic<uint32_t>::is_always_lock_free, "JS Atomics and the C++ ring must share a lock-free word");',
    '#endif',
    ...ringAsserts,
    '',
    '}  // namespace hyphon',
    '',
  ].join('\n');
}

// ── hyphonNativeExports.ts ──────────────────────────────────────────────────

export function generate(schema = loadEventSchema()) {
  const manifest = JSON.parse(read('emscripten/wasm_export_manifest.json'));
  const sources = wrapperSources();
  const protos = new Map(BUILTIN);
  for (const { text } of sources) for (const [k, v] of parsePrototypes(text)) protos.set(k, v);
  const generic = macroPrototypes();
  for (const prefix of voicePrefixes(sources)) {
    for (const [suffix, proto] of generic) protos.set(`${prefix}_${suffix}`, proto);
  }

  const lines = [];
  const emit = (name, optional) => {
    const proto = protos.get(name);
    if (!proto) throw new Error(`${name} is in the manifest but has no EMSCRIPTEN_KEEPALIVE prototype`);
    const params = proto.params.map((p) => `${p.name}: ${tsType(p.type, p.name, name)}`).join(', ');
    lines.push(`  ${name}${optional ? '?' : ''}(${params}): ${tsType(proto.ret, '', name)};`);
  };
  for (const name of manifest.required) emit(name, false);
  for (const name of manifest.optional) emit(name, true);

  const eventType = eventTypeScope(schema);
  const engineEnums = [];
  for (const { file, text } of sources) {
    for (const m of text.matchAll(/enum\s+(\w+Event)\s*:\s*uint16_t\s*\{/g)) {
      engineEnums.push({ file, name: m[1], values: parseEnum(text, m[1], eventType) });
    }
  }

  return [
    '// GENERATED by tools/gen_hyphon_native_types.mjs — do not edit.',
    '// Source: emscripten/wasm_export_manifest.json, the EMSCRIPTEN_KEEPALIVE',
    '// prototypes in emscripten/*_wrapper.cpp and emscripten/core/voice_exports.h,',
    `// ${EVENT_SCHEMA} and the engine event enums.`,
    '// Regenerate: pnpm run gen:native-types',
    '',
    '/** Byte address in hyphon_native linear memory (wasm32). */',
    'export type WasmPtr = number;',
    '/** Voice handle: VoiceSlots slot index + generation, 0 = none. */',
    'export type VoiceHandle = number;',
    '',
    '/** hyphon_native.wasm exports, as resolved through the export map. Optional ones may be absent. */',
    'export interface HyphonNativeExports {',
    ...lines,
    '}',
    '',
    `/** hyphon::EventType, from ${EVENT_SCHEMA} (see eventLayout.ts). */`,
    "export { EventType as VoiceEvent } from './eventLayout';",
    '',
    ...engineEnums.map(({ file, name, values }) => {
      const engine = name.replace(/Event$/, '');
      return formatConst(name, `Engine-private event types (${file}).`, stripK(values, engine));
    }),
  ].join('\n');
}

/** Every generated file and its expected content. */
export function generatedFiles() {
  const schema = loadEventSchema();
  return [
    { rel: EVENT_LAYOUT_TS, text: generateEventLayoutTs(schema) },
    { rel: EVENT_LAYOUT_H, text: generateEventLayoutH(schema) },
    { rel: EXPORTS_OUTPUT, text: generate(schema) },
  ];
}

/** Paths whose committed content differs from what the generator writes. */
export function staleGeneratedFiles() {
  return generatedFiles()
    .filter(({ rel, text }) => {
      const target = path.join(REPO_ROOT, rel);
      return !fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text;
    })
    .map(({ rel }) => rel);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const stale = staleGeneratedFiles();
    for (const rel of stale) console.error(`${rel} is stale — run: pnpm run gen:native-types`);
    if (stale.length) process.exit(1);
    for (const { rel } of generatedFiles()) console.log(`${rel} is up to date.`);
  } else {
    for (const { rel, text } of generatedFiles()) {
      fs.writeFileSync(path.join(REPO_ROOT, rel), text);
      console.log(`wrote ${rel}`);
    }
  }
}
