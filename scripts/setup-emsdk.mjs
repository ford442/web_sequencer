#!/usr/bin/env node
/**
 * Install the PINNED Emscripten (emscripten/toolchain.json#emscripten.version)
 * into .cache/emsdk/ without cloning emsdk or needing git/GitHub access.
 *
 * It downloads the same `wasm-binaries.tar.xz` release build emsdk itself
 * installs: the build hash comes from emsdk's own emscripten-releases-tags.json
 * and the tarball from storage.googleapis.com. emscripten/toolchain_env.sh finds
 * .cache/emsdk/emsdk_env.sh automatically, so afterwards
 * `pnpm run build:native` just works.
 *
 *   pnpm run setup:emsdk
 *   pnpm run setup:emsdk -- --force            # reinstall
 *
 * Environment:
 *   HYPHON_EMSCRIPTEN_RELEASE_HASH   skip the tags lookup (offline mirrors)
 *   HYPHON_EMSCRIPTEN_BINARIES_URL   full URL of the wasm-binaries.tar.xz to use
 *
 * Supports linux-x64. Elsewhere use the regular emsdk (see the error text).
 * Needs: node >= 22, python3, tar with xz support.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'emscripten', 'toolchain.json'), 'utf8'),
).emscripten.version;
const ROOT = path.join(REPO_ROOT, '.cache', 'emsdk');
const INSTALL = path.join(ROOT, 'install');
const ENV_SH = path.join(ROOT, 'emsdk_env.sh');
const force = process.argv.includes('--force');

const TAGS_URL = 'https://raw.githubusercontent.com/emscripten-core/emsdk/main/emscripten-releases-tags.json';
const binariesUrl = (hash) =>
  process.env.HYPHON_EMSCRIPTEN_BINARIES_URL ??
  `https://storage.googleapis.com/webassembly/emscripten-releases-builds/linux/${hash}/wasm-binaries.tar.xz`;

function fail(msg) {
  console.error(`[setup-emsdk] ${msg}`);
  process.exit(1);
}

function installedVersion() {
  if (!fs.existsSync(ENV_SH)) return null;
  const r = spawnSync('bash', ['-c', `source "${ENV_SH}" && emcc -dumpversion`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim().split('\n').pop() : null;
}

if (os.platform() !== 'linux' || os.arch() !== 'x64') {
  fail(
    `automatic install supports linux-x64 only (this is ${os.platform()}-${os.arch()}).\n` +
      `  Use emsdk instead: git clone https://github.com/emscripten-core/emsdk ~/emsdk && \\\n` +
      `    ~/emsdk/emsdk install ${VERSION} && ~/emsdk/emsdk activate ${VERSION}`,
  );
}

if (!force && installedVersion() === VERSION) {
  console.log(`[setup-emsdk] emcc ${VERSION} already installed in .cache/emsdk`);
  process.exit(0);
}

let hash = process.env.HYPHON_EMSCRIPTEN_RELEASE_HASH;
if (!hash) {
  console.log(`[setup-emsdk] resolving release build for ${VERSION} ...`);
  const res = await fetch(TAGS_URL);
  if (!res.ok) fail(`${res.status} ${res.statusText} for ${TAGS_URL} (set HYPHON_EMSCRIPTEN_RELEASE_HASH to skip)`);
  hash = (await res.json()).releases?.[VERSION];
  if (!hash) fail(`emsdk's release list has no build for ${VERSION}`);
}

fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });
const tarball = path.join(ROOT, 'wasm-binaries.tar.xz');
const url = binariesUrl(hash);
console.log(`[setup-emsdk] GET ${url}`);
const res = await fetch(url);
if (!res.ok || !res.body) fail(`${res.status} ${res.statusText} for ${url}`);
await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tarball));
console.log(`[setup-emsdk] ${(fs.statSync(tarball).size / 1048576).toFixed(0)} MB, extracting ...`);

const tar = spawnSync('tar', ['-xJf', tarball, '-C', ROOT], { stdio: 'inherit' });
if (tar.status !== 0) fail('tar -xJf failed (is xz installed?)');
fs.rmSync(tarball);
if (!fs.existsSync(path.join(INSTALL, 'emscripten', 'emcc'))) fail('archive did not contain install/emscripten/emcc');

// Release builds carry a "-git" suffix in emscripten-version.txt; the pin check
// (emscripten/toolchain_env.sh) compares against the bare release version.
fs.writeFileSync(path.join(INSTALL, 'emscripten', 'emscripten-version.txt'), VERSION);

const config = path.join(ROOT, '.emscripten');
fs.writeFileSync(
  config,
  [
    `LLVM_ROOT = '${path.join(INSTALL, 'bin')}'`,
    `BINARYEN_ROOT = '${INSTALL}'`,
    `NODE_JS = '${process.execPath}'`,
    `EMSCRIPTEN_ROOT = '${path.join(INSTALL, 'emscripten')}'`,
    `JS_ENGINES = [NODE_JS]`,
    '',
  ].join('\n'),
);
fs.writeFileSync(
  ENV_SH,
  [
    `export EMSDK="${ROOT}"`,
    `export EM_CONFIG="${config}"`,
    `export PATH="${path.join(INSTALL, 'emscripten')}:${path.join(INSTALL, 'bin')}:$PATH"`,
    '',
  ].join('\n'),
);

const got = installedVersion();
if (got !== VERSION) fail(`installed emcc reports "${got}", expected ${VERSION}`);
console.log(`[setup-emsdk] OK — emcc ${got} in .cache/emsdk (picked up by emscripten/toolchain_env.sh)`);
