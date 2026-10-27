#!/usr/bin/env node
/**
 * Generate src/shared/rt/hyphonNativeExports.ts — the typed surface of
 * hyphon_native.wasm (#1344 P4).
 *
 * Inputs, so nothing here is a hand-kept list:
 *   emscripten/wasm_export_manifest.json   which names exist (required / optional)
 *   emscripten/*_wrapper.cpp                their EMSCRIPTEN_KEEPALIVE prototypes
 *   emscripten/core/voice_exports.h         the HYPHON_EXPORT_VOICE signatures,
 *                                           expanded for every engine that uses it
 *   emscripten/core/voice.h + wrappers      the event type enums
 *
 * Usage:
 *   node tools/gen_hyphon_native_types.mjs           write the file
 *   node tools/gen_hyphon_native_types.mjs --check   exit 1 if it is stale
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT = 'src/shared/rt/hyphonNativeExports.ts';

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

export function generate() {
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

  const voiceH = read('emscripten/core/voice.h');
  const eventType = parseEnum(voiceH, 'EventType', {});
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
    '// and the event enums. Regenerate: pnpm run gen:native-types',
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
    formatConst('VoiceEvent', 'hyphon::EventType (emscripten/core/voice.h).', stripK(eventType)),
    ...engineEnums.map(({ file, name, values }) => {
      const engine = name.replace(/Event$/, '');
      return formatConst(name, `Engine-private event types (${file}).`, stripK(values, engine));
    }),
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const next = generate();
  const target = path.join(REPO_ROOT, OUTPUT);
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (current !== next) {
      console.error(`${OUTPUT} is stale — run: pnpm run gen:native-types`);
      process.exit(1);
    }
    console.log(`${OUTPUT} is up to date.`);
  } else {
    fs.writeFileSync(target, next);
    console.log(`wrote ${OUTPUT}`);
  }
}
