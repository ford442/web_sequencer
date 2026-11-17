/**
 * Pure helpers behind `analyze-bundle.mjs --compare <baseline.json>`.
 *
 * A report is what `analyze-bundle.mjs --json` prints:
 *   { entry, rows: [{file, raw, gzip, brotli, eager}], assets: [{file, raw, brotli}] }
 * `rows` covers every .js under dist/; `assets` is every non-.wasm file under
 * dist/assets/ — the exact population dist-budget.json's assetsDirMaxBytes rows
 * sum, so the aggregate here is the number the release gate compares.
 *
 * Report only: nothing here decides pass/fail. The gate stays
 * scripts/check-release-dist.mjs.
 */

/** `assets/Studio3D-B3MEUl4B.js` -> `assets/Studio3D.js` (Vite/rolldown content hash is 8 chars). */
export function stableName(file) {
  return file.replace(/-[A-Za-z0-9_-]{8}(\.[A-Za-z0-9]+)$/, '$1');
}

function byName(list, key) {
  const map = new Map();
  for (const item of list ?? []) {
    const name = stableName(item.file);
    const prev = map.get(name) ?? 0;
    map.set(name, prev + (item[key] ?? 0));
  }
  return map;
}

function diffMaps(before, after) {
  const grown = [];
  const shrunk = [];
  const added = [];
  const removed = [];
  for (const [name, now] of after) {
    if (!before.has(name)) added.push({ name, before: 0, after: now, delta: now });
    else {
      const was = before.get(name);
      if (now > was) grown.push({ name, before: was, after: now, delta: now - was });
      else if (now < was) shrunk.push({ name, before: was, after: now, delta: now - was });
    }
  }
  for (const [name, was] of before) {
    if (!after.has(name)) removed.push({ name, before: was, after: 0, delta: -was });
  }
  const desc = (a, b) => Math.abs(b.delta) - Math.abs(a.delta);
  return {
    grown: grown.sort(desc),
    shrunk: shrunk.sort(desc),
    added: added.sort(desc),
    removed: removed.sort(desc),
  };
}

const total = (list, key) => (list ?? []).reduce((n, r) => n + (r[key] ?? 0), 0);

/**
 * @param {object} baseline report from the base commit
 * @param {object} current  report from this build
 * @param {object} [budget] parsed dist-budget.json
 */
export function compareReports(baseline, current, budget = {}) {
  const baseAssets = baseline.assets ?? [];
  const curAssets = current.assets ?? [];
  const aggregate = {
    assetsRaw: { before: total(baseAssets, 'raw'), after: total(curAssets, 'raw') },
    assetsBrotli: { before: total(baseAssets, 'brotli'), after: total(curAssets, 'brotli') },
  };
  const entryOf = (r) => (r.rows ?? []).find((row) => row.file === r.entry);
  const be = entryOf(baseline);
  const ce = entryOf(current);
  aggregate.entryRaw = { before: be?.raw ?? 0, after: ce?.raw ?? 0 };
  aggregate.entryBrotli = { before: be?.brotli ?? 0, after: ce?.brotli ?? 0 };

  const compressed = budget.compressed ?? {};
  const budgets = [
    { label: 'dist/assets total, raw (non-.wasm)', key: 'assetsRaw', max: budget.assetsDirMaxBytes },
    { label: 'dist/assets total, brotli (non-.wasm)', key: 'assetsBrotli', max: compressed.assetsDirMaxBytes },
    { label: 'entry chunk, raw', key: 'entryRaw', max: budget.entryChunkMaxBytes },
    { label: 'entry chunk, brotli', key: 'entryBrotli', max: compressed.entryChunkMaxBytes },
  ]
    .filter((b) => typeof b.max === 'number')
    .map((b) => ({
      label: b.label,
      max: b.max,
      before: aggregate[b.key].before,
      after: aggregate[b.key].after,
      headroom: b.max - aggregate[b.key].after,
      over: aggregate[b.key].after > b.max,
    }));

  return {
    files: diffMaps(byName(baseAssets, 'raw'), byName(curAssets, 'raw')),
    aggregate,
    budgets,
  };
}

const n = (v) => v.toLocaleString('en-US');
const signed = (v) => (v > 0 ? '+' : v < 0 ? '-' : '') + n(Math.abs(v));

/** Markdown, so the same text works on a terminal and in $GITHUB_STEP_SUMMARY. */
export function formatComparison(cmp, { limit = 15 } = {}) {
  const out = ['## Bundle delta (dist/assets, non-.wasm)', ''];
  out.push('| budget row | before | after | max | headroom |', '|---|---:|---:|---:|---:|');
  for (const b of cmp.budgets) {
    out.push(
      `| ${b.label} | ${n(b.before)} | ${n(b.after)} | ${n(b.max)} | ` +
      `${b.over ? '**OVER by ' + n(-b.headroom) + '**' : n(b.headroom)} |`,
    );
  }
  const a = cmp.aggregate;
  out.push('', `Raw total ${signed(a.assetsRaw.after - a.assetsRaw.before)} B, brotli total ${signed(a.assetsBrotli.after - a.assetsBrotli.before)} B.`, '');
  for (const [title, list] of [
    ['Grown', cmp.files.grown],
    ['New', cmp.files.added],
    ['Shrunk', cmp.files.shrunk],
    ['Removed', cmp.files.removed],
  ]) {
    if (!list.length) continue;
    out.push(`### ${title} (${list.length})`, '', '| file | before | after | delta |', '|---|---:|---:|---:|');
    for (const f of list.slice(0, limit)) out.push(`| ${f.name} | ${n(f.before)} | ${n(f.after)} | ${signed(f.delta)} |`);
    if (list.length > limit) out.push(`| … ${list.length - limit} more | | | |`);
    out.push('');
  }
  return out.join('\n');
}
