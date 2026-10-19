#!/usr/bin/env node
/**
 * The vendored Mutable Instruments Plaits sources the macro-* voices build
 * from (third_party/eurorack + third_party/stmlib, pinned submodules, MIT).
 *
 * One list for every consumer:
 *   emscripten/build.sh                    stages + compiles the translation units
 *   emscripten/tests/run_offline_voices_test.sh   host g++ build of the same staged set
 *   scripts/native-worlds.mjs              hashes plaitsHashInputs() into the
 *                                          emcc world, so an upstream bump rebuilds
 *
 * The submodules stay pristine. The build compiles a STAGED copy: the source
 * trees below, copied to a temp dir with the wasm denormal guards in
 * tools/plaits_wasm_patches.mjs applied (WebAssembly has no flush-to-zero
 * mode; see that file). Both the wasm and the host build compile the staged
 * copy, so the host tests check what ships.
 *
 * plaits/dsp/voice.cc is deliberately absent: emscripten/macro_wrapper.cpp is
 * its DAW port (float output, sequencer gate, no 1 ms trigger delay). The
 * firmware side (plaits.cc, ui.cc, drivers/, user_data_receiver.cc) and the
 * GPL-3 test harness (plaits/test/) are never compiled.
 *
 * Usage:
 *   node tools/plaits_sources.mjs [--abs]      list the upstream translation units
 *   node tools/plaits_sources.mjs --stage DIR  stage + patch into DIR, list the
 *                                              staged units (absolute); include
 *                                              roots are DIR/eurorack and DIR
 * Exits 1, naming the fix, when a submodule is not checked out or a guard no
 * longer matches upstream.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLAITS_WASM_PATCHES } from './plaits_wasm_patches.mjs';

export const EURORACK_DIR = 'third_party/eurorack';
export const STMLIB_DIR = 'third_party/stmlib';

/** Translation units outside plaits/dsp/**. */
const EXTRA_UNITS = [
  `${EURORACK_DIR}/plaits/resources.cc`,
  `${STMLIB_DIR}/dsp/units.cc`,
  `${STMLIB_DIR}/utils/random.cc`,
];

/** Source trees whose every file feeds the build (headers included). */
const HASHED_TREES = [
  `${EURORACK_DIR}/plaits/dsp`,
  `${STMLIB_DIR}/dsp`,
  `${STMLIB_DIR}/utils`,
];
const HASHED_FILES = [
  `${EURORACK_DIR}/plaits/resources.cc`,
  `${EURORACK_DIR}/plaits/resources.h`,
  `${EURORACK_DIR}/README.md`, // its License section: STM32 code is MIT
  `${STMLIB_DIR}/stmlib.h`,
  `${STMLIB_DIR}/LICENSE`,
];

function walk(repoRoot, rel) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  const stack = [abs];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(path.relative(repoRoot, full).split(path.sep).join('/'));
    }
  }
  return out.sort();
}

/** True when both submodules are checked out far enough to build. */
export function plaitsAvailable(repoRoot) {
  return (
    fs.existsSync(path.join(repoRoot, EURORACK_DIR, 'plaits/dsp/dsp.h')) &&
    fs.existsSync(path.join(repoRoot, STMLIB_DIR, 'stmlib.h'))
  );
}

/** Repo-relative .cc files em++ compiles for the macro-* voices. */
export function plaitsTranslationUnits(repoRoot) {
  const dsp = walk(repoRoot, `${EURORACK_DIR}/plaits/dsp`).filter(
    (rel) => rel.endsWith('.cc') && rel !== `${EURORACK_DIR}/plaits/dsp/voice.cc`,
  );
  return [...dsp, ...EXTRA_UNITS];
}

/** Every vendored file whose content changes the built voice module. */
export function plaitsHashInputs(repoRoot) {
  const files = new Set(HASHED_FILES);
  for (const tree of HASHED_TREES) for (const rel of walk(repoRoot, tree)) files.add(rel);
  return [...files].sort();
}

/** third_party/<x>/… → <x>/… inside a stage dir. */
function stagedPath(stageDir, rel) {
  return path.join(stageDir, rel.replace(/^third_party\//, ''));
}

/**
 * Apply one guard. Every `find` must occur exactly `count` times (default 1)
 * in the pristine upstream text — anything else means upstream moved and the
 * guard needs a look, so it throws instead of silently skipping.
 */
export function applyPatch(text, patch, file) {
  let out = text;
  for (const edit of patch.edits) {
    const expected = edit.count ?? 1;
    const found = out.split(edit.find).length - 1;
    if (found !== expected) {
      throw new Error(
        `plaits patch "${patch.id}" no longer matches ${file}: expected ${expected} ` +
          `occurrence(s) of ${JSON.stringify(edit.find.slice(0, 60))}…, found ${found}`,
      );
    }
    out = out.split(edit.find).join(edit.replace);
  }
  return out;
}

/**
 * Copy the hashed source set into `stageDir` and apply PLAITS_WASM_PATCHES.
 * Returns the staged translation units (absolute paths).
 */
export function stagePlaits(repoRoot, stageDir, patches = PLAITS_WASM_PATCHES) {
  fs.rmSync(stageDir, { recursive: true, force: true });
  for (const rel of plaitsHashInputs(repoRoot)) {
    const dest = stagedPath(stageDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, rel), dest);
  }
  for (const patch of patches) {
    const dest = stagedPath(stageDir, patch.file);
    if (!fs.existsSync(dest)) throw new Error(`plaits patch "${patch.id}": ${patch.file} is not in the staged set`);
    fs.writeFileSync(dest, applyPatch(fs.readFileSync(dest, 'utf8'), patch, patch.file));
  }
  return plaitsTranslationUnits(repoRoot).map((rel) => stagedPath(stageDir, rel));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (!plaitsAvailable(repoRoot)) {
    console.error(
      `${EURORACK_DIR} / ${STMLIB_DIR} not checked out. ` +
        'Run: git submodule update --init --depth 1 third_party/eurorack third_party/stmlib',
    );
    process.exit(1);
  }
  const stageAt = process.argv.indexOf('--stage');
  let units;
  if (stageAt >= 0) {
    const stageDir = path.resolve(process.argv[stageAt + 1] ?? '');
    try {
      units = stagePlaits(repoRoot, stageDir);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  } else {
    const abs = process.argv.includes('--abs');
    units = plaitsTranslationUnits(repoRoot).map((rel) => (abs ? path.join(repoRoot, rel) : rel));
  }
  process.stdout.write(`${units.join('\n')}\n`);
}
