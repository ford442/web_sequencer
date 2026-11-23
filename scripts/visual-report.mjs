#!/usr/bin/env node
/**
 * Builds the "State of the App" report (Release 3/5) from a run of tests/visual-showcase.spec.ts.
 *
 *   node scripts/visual-report.mjs --in visual-report --url https://host/staging/ --sha <sha> [--before <dir>]
 *
 * Reads  <in>/states-<browser>.json   (layout facts + intentional console findings per state)
 *        <in>/<browser>/<name>.png    (every captured screenshot)
 * Writes <in>/index.html              (screenshot grid, viewport x state, with before/after pairs when --before is given)
 *        <in>/REPORT.md               (the text to post: URL, SHA, console + layout results per browser)
 * The unexpected-console count is not recomputed here: the spec FAILS on any unexpected finding, so
 * a green run means zero; the intentional ones are listed so a reviewer can challenge them.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg('in', 'visual-report');
const url = arg('url', '(local preview)');
const sha = arg('sha', 'unknown');
const before = arg('before', null);
const VIEWPORTS = ['1920x1080', '1440x900', '1280x720', '1024x768', '768x1024', '390x844'];

const browsers = readdirSync(dir).filter((f) => /^states-.*\.json$/.test(f)).map((f) => f.slice(7, -5));
const md = [`## State of the App`, '', `- **Deployed URL:** ${url}`, `- **Commit:** \`${sha}\``, `- **Generated:** ${new Date().toISOString()}`, ''];
md.push('### Console + layout results per browser', '', '| Browser | States captured | Horizontal scroll | Clipped header | Touch targets < 32px | Intentional console findings |', '|---|---|---|---|---|---|');
const intentionalByBrowser = {};
for (const b of browsers) {
  const rows = JSON.parse(readFileSync(join(dir, `states-${b}.json`), 'utf8'));
  const sum = (f) => rows.filter(f).length;
  const intentional = [...new Set(rows.flatMap((r) => r.intentional))];
  intentionalByBrowser[b] = intentional;
  md.push(`| ${b} | ${rows.length} | ${sum((r) => r.layout.pageOverflowX > 0)} | ${sum((r) => r.layout.headerClipped.length > 0 || r.layout.bottomBarClipped.length > 0)} | ${sum((r) => r.layout.smallTargets.length > 0)} | ${intentional.length} |`);
}
md.push('', 'Unexpected console errors / failed requests: the spec fails on any, so a passing run means **0** (see the run log for pass/fail).', '');
for (const [b, list] of Object.entries(intentionalByBrowser)) {
  if (!list.length) continue;
  md.push(`<details><summary>Intentional findings, ${b} (error states triggered on purpose)</summary>`, '', ...list.map((l) => `- \`${l.slice(0, 200)}\``), '', '</details>', '');
}

const states = new Set();
for (const b of browsers) {
  const d = join(dir, b);
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d)) {
    const m = f.match(/^(.*)-(\d+x\d+)\.png$/);
    if (m) states.add(m[1]);
  }
}
const order = ['boot', 'main'];
const sorted = [...states].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
let html = `<!doctype html><meta charset="utf-8"><title>State of the App</title><style>body{font:14px system-ui;background:#0b0d10;color:#ddd;margin:16px}h2{margin-top:32px}.row{display:flex;gap:12px;flex-wrap:wrap}figure{margin:0}img{display:block;max-width:360px;border:1px solid #333}figcaption{font-size:12px;color:#9ab}.pair{display:flex;gap:4px}</style><h1>State of the App</h1><p>${url} @ <code>${sha}</code></p>`;
for (const b of browsers) {
  html += `<h2>${b}</h2>`;
  for (const s of sorted) {
    const cells = VIEWPORTS.filter((v) => existsSync(join(dir, b, `${s}-${v}.png`)));
    if (!cells.length) continue;
    html += `<h3>${s}</h3><div class="row">`;
    for (const v of cells) {
      const beforeImg = before && existsSync(join(before, b, `${s}-${v}.png`)) ? `<figure><img src="${before}/${b}/${s}-${v}.png"><figcaption>before</figcaption></figure>` : '';
      html += `<figure class="pair">${beforeImg}<figure><img src="${b}/${s}-${v}.png"><figcaption>${before ? 'after ' : ''}${v}</figcaption></figure></figure>`;
    }
    html += '</div>';
  }
}
writeFileSync(join(dir, 'index.html'), html);
writeFileSync(join(dir, 'REPORT.md'), md.join('\n') + '\n');
console.log(`[visual-report] ${browsers.join(', ')}: ${sorted.length} state(s) -> ${dir}/index.html, REPORT.md`);
