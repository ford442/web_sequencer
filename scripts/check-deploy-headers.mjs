#!/usr/bin/env node
/**
 * Verify a DEPLOYED bundle is served with what the app needs, i.e. the `curl -I`
 * check of the deploy flow — and that the host serves the commit you meant to ship.
 *
 * The app needs SharedArrayBuffer (pthread hyphon_native.wasm), which requires
 * cross-origin isolation: COOP `same-origin`, COEP `require-corp`, and a CORP header
 * on the resources. Nothing else checks that the PRODUCTION host sends them (Vite
 * dev/preview do; a static host does not unless configured).
 *
 *   node scripts/check-deploy-headers.mjs https://host/hyphon/
 *   node scripts/check-deploy-headers.mjs https://host/hyphon/ --expect-sha "$(git rev-parse HEAD)"
 *   node scripts/check-deploy-headers.mjs http://localhost:4173/ --path rubberband.wasm
 *
 * Checks index.html and hyphon_native.wasm by default (+ any --path). For each:
 * HTTP 200, COOP, COEP, CORP present, and a sane Content-Type (WebAssembly
 * streaming compile needs application/wasm; index.html must not be utf-16).
 * With --expect-sha, native-artifacts.json's sources.gitHead must match.
 * Exit 1 on any failure; prints the relevant response headers either way.
 */
const args = process.argv.slice(2);
const base = args.find((a) => /^https?:\/\//.test(a));
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const extraPaths = args.flatMap((a, i) => (a === '--path' ? [args[i + 1]] : []));
const expectSha = flag('--expect-sha');

if (!base) {
  console.error('usage: check-deploy-headers.mjs <base-url> [--expect-sha <sha>] [--path <file>]...');
  process.exit(2);
}
const root = base.replace(/\/?$/, '/');
const PATHS = ['index.html', 'hyphon_native.wasm', ...extraPaths];
const SHOWN = [
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'content-type',
  'content-length',
  'last-modified',
  'cache-control',
];

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(`  ✗ ${msg}`);
};

for (const rel of PATHS) {
  const url = new URL(rel, root).href;
  // HEAD is what `curl -I` does; fall back to GET for hosts that refuse it.
  let res = await fetch(url, { method: 'HEAD', redirect: 'follow' }).catch((e) => e);
  if (res instanceof Error || res.status === 405) {
    res = await fetch(url, { redirect: 'follow' }).catch((e) => e);
  }
  console.log(`\n${url}`);
  if (res instanceof Error) {
    fail(`request failed: ${res.cause?.message ?? res.message}`);
    continue;
  }
  console.log(`  HTTP ${res.status}`);
  for (const h of SHOWN) {
    const v = res.headers.get(h);
    if (v !== null) console.log(`  ${h}: ${v}`);
  }
  if (res.status !== 200) fail(`expected HTTP 200, got ${res.status}`);
  const h = (n) => (res.headers.get(n) ?? '').toLowerCase();
  if (h('cross-origin-opener-policy') !== 'same-origin') fail('Cross-Origin-Opener-Policy must be "same-origin"');
  if (h('cross-origin-embedder-policy') !== 'require-corp') fail('Cross-Origin-Embedder-Policy must be "require-corp"');
  if (!['same-origin', 'same-site', 'cross-origin'].includes(h('cross-origin-resource-policy'))) {
    fail('Cross-Origin-Resource-Policy header is missing (same-origin / same-site / cross-origin)');
  }
  const type = h('content-type');
  if (rel.endsWith('.wasm') && !type.startsWith('application/wasm')) fail(`wasm must be served as application/wasm, got "${type}"`);
  if (rel.endsWith('.html') && (!type.startsWith('text/html') || /utf-?16/.test(type))) {
    fail(`index.html must be text/html (UTF-8), got "${type}"`);
  }
}

if (expectSha) {
  const url = new URL('native-artifacts.json', root).href;
  console.log(`\n${url}`);
  try {
    const res = await fetch(url);
    const served = res.ok ? (await res.json()).sources?.gitHead : null;
    console.log(`  served sources.gitHead: ${served ?? '(unavailable)'}`);
    if (served !== expectSha) fail(`served commit ${served} != expected ${expectSha}`);
  } catch (e) {
    fail(`could not read native-artifacts.json: ${e.message}`);
  }
}

console.log(failed ? '\n[deploy-headers] FAILED' : '\n[deploy-headers] OK');
process.exit(failed ? 1 : 0);
