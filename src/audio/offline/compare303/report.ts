/**
 * Report output for the 303 voice comparison (#1543): a JSON document, a
 * Markdown summary, and two SVGs per case (waveform overlay, spectrum overlay).
 * Pure string builders; the CLI writes the files.
 */

import { BAND_CENTERS_HZ, toDb, type PairMetrics } from './metrics';
import type { CaseResult, VoiceResult } from './run';

export interface ReportSettings {
  sampleRate: number;
  mapping: string;
  loops: number;
  gate: number;
  backendPreference: string;
  referenceId: string;
}

export interface VoiceSummary {
  id: string;
  label: string;
  backend: string;
  standInFor?: string;
  cases: number;
  /** Cases where the voice rendered silence (excluded from the means). */
  silentCases: number;
  levelDb: number;
  rmsDbfs: number;
  nullDb: number;
  corr: number;
  lsdDb: number;
  avgSpectrumLsdDb: number;
  centroidHz: number;
  centroidDeltaHz: number;
  envCorr: number;
  envRangeDb: number;
}

const mean = (xs: readonly number[]): number => {
  const finite = xs.filter(Number.isFinite);
  return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : NaN;
};

/** Per-voice means over the cases the voice rendered in (the reference has no pair metrics). */
export function summarize(cases: readonly CaseResult[]): VoiceSummary[] {
  const byId = new Map<string, VoiceResult[]>();
  for (const c of cases) {
    for (const r of c.results) byId.set(r.voice.id, [...(byId.get(r.voice.id) ?? []), r]);
  }
  return [...byId.entries()].map(([id, all]) => {
    const rs = all.filter((r) => !r.analysis.silent);
    const pairs = rs.map((r) => r.vsReference).filter((p): p is PairMetrics => !!p);
    const first = all[0].voice;
    return {
      id,
      label: first.label,
      backend: first.backend ?? 'none',
      standInFor: first.standInFor,
      cases: all.length,
      silentCases: all.length - rs.length,
      levelDb: pairs.length ? mean(pairs.map((p) => p.levelDb)) : 0,
      rmsDbfs: mean(rs.map((r) => toDb(r.analysis.rms ** 2))),
      nullDb: mean(pairs.map((p) => p.nullDb)),
      corr: mean(pairs.map((p) => p.corr)),
      lsdDb: mean(pairs.map((p) => p.lsdDb)),
      avgSpectrumLsdDb: mean(pairs.map((p) => p.avgSpectrumLsdDb)),
      centroidHz: mean(rs.map((r) => r.analysis.centroidHz)),
      centroidDeltaHz: mean(pairs.map((p) => p.centroidDeltaHz)),
      envCorr: mean(pairs.map((p) => p.envCorr)),
      envRangeDb: mean(rs.map((r) => r.analysis.envRangeDb)),
    };
  });
}

/** Mean matrix of spectral distances (dB) over the cases both voices rendered in. */
export function meanMatrix(cases: readonly CaseResult[]): { ids: string[]; values: number[][] } {
  const ids = [...new Set(cases.flatMap((c) => c.results.map((r) => r.voice.id)))];
  const sums = ids.map(() => ids.map(() => ({ sum: 0, n: 0 })));
  for (const c of cases) {
    const idx = c.results.map((r) => ids.indexOf(r.voice.id));
    c.matrix.forEach((row, i) =>
      row.forEach((v, j) => {
        if (i !== j && Number.isFinite(v)) {
          sums[idx[i]][idx[j]].sum += v;
          sums[idx[i]][idx[j]].n++;
        }
      }),
    );
  }
  return { ids, values: sums.map((row) => row.map((s) => (s.n ? s.sum / s.n : NaN))) };
}

const f = (x: number, digits = 1): string => (Number.isFinite(x) ? x.toFixed(digits) : '—');
const signed = (x: number, digits = 1): string => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(digits)}` : '—');

function voiceTable(rows: Array<{ label: string; cells: string[] }>): string {
  const head =
    '| Voice | Backend | RMS dBFS | Level Δ dB | Null dB | Corr | Frame LSD dB | Avg-spectrum LSD dB | Centroid Hz (Δ) | Env corr | Gate range dB |\n' +
    '|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|\n';
  return head + rows.map((r) => `| ${r.label} | ${r.cells.join(' | ')} |`).join('\n') + '\n';
}

export function renderMarkdown(
  cases: readonly CaseResult[],
  settings: ReportSettings,
  skippedVoices: ReadonlyArray<{ id: string; reason: string }>,
): string {
  const summary = summarize(cases);
  const ref = settings.referenceId;
  const lines: string[] = [
    '# 303 voice comparison',
    '',
    `Reference voice: **${ref}**. ${cases.length} case(s), ${settings.sampleRate} Hz, mapping \`${settings.mapping}\`, ` +
      `${settings.loops} loops per pattern, gate ${settings.gate}, open303 backend \`${settings.backendPreference}\`.`,
    '',
    'Read it as: **Null dB** is the residual after aligning (±5 ms) and gain-matching a voice to the reference ' +
      '(0 = nothing in common, −20 = a tenth of the amplitude left, −∞ = identical). **Frame LSD** is the RMS ' +
      'third-octave difference per frame after matching level over the frames each voice sounds in (0 = same timbre). **Level Δ** is whole-file RMS relative to the reference. ' +
      '**Gate range** is the dB between the loud and quiet 10 ms envelope: large when the voice closes between notes, small when it drones.',
    '',
    `## Summary (mean over ${cases.length} case${cases.length === 1 ? '' : 's'})`,
    '',
    voiceTable(
      summary.map((s) => ({
        label: `${s.id}${s.id === ref ? ' **(ref)**' : ''}${s.standInFor ? ` (as highfid-cpu)` : ''}${s.silentCases ? ` — silent in ${s.silentCases}/${s.cases}` : ''}`,
        cells: [
          s.backend,
          f(s.rmsDbfs),
          s.id === ref ? '—' : signed(s.levelDb),
          s.id === ref ? '—' : f(s.nullDb),
          s.id === ref ? '—' : f(s.corr, 3),
          s.id === ref ? '—' : f(s.lsdDb),
          s.id === ref ? '—' : f(s.avgSpectrumLsdDb),
          s.id === ref ? f(s.centroidHz, 0) : `${f(s.centroidHz, 0)} (${signed(s.centroidDeltaHz, 0)})`,
          s.id === ref ? '—' : f(s.envCorr, 3),
          f(s.envRangeDb, 0),
        ],
      })),
    ),
  ];

  const { ids, values } = meanMatrix(cases);
  lines.push('## Voice-to-voice spectral distance (mean frame LSD, dB)', '', `| from \\ to | ${ids.join(' | ')} |`, `|---|${ids.map(() => '--:').join('|')}|`);
  ids.forEach((id, i) => lines.push(`| ${id} | ${values[i].map((v, j) => (i === j ? '·' : f(v))).join(' | ')} |`));
  lines.push('');

  if (skippedVoices.length) {
    lines.push('## Not rendered', '', ...skippedVoices.map((s) => `- \`${s.id}\`: ${s.reason}`), '');
  }

  lines.push('## Cases', '');
  for (const c of cases) {
    const p = c.case.pattern;
    lines.push(
      `### ${c.case.id}`,
      '',
      `${c.case.song} · 303 ${p.device} slot ${p.slot} · ${p.notes} notes · ${p.uses} arrangement uses · ${c.case.tempo} BPM · ` +
        `${(c.case.script.totalFrames / c.case.script.sampleRate).toFixed(1)} s`,
      '',
      voiceTable(
        c.results.map((r) => ({
          label: r.voice.id === c.referenceId ? `${r.voice.id} **(ref)**` : r.voice.id,
          cells: [
            r.voice.backend ?? 'none',
            f(toDb(r.analysis.rms ** 2)),
            r.vsReference ? signed(r.vsReference.levelDb) : '—',
            r.vsReference ? f(r.vsReference.nullDb) : '—',
            r.vsReference ? f(r.vsReference.corr, 3) : '—',
            r.vsReference ? f(r.vsReference.lsdDb) : '—',
            r.vsReference ? f(r.vsReference.avgSpectrumLsdDb) : '—',
            r.vsReference ? `${f(r.analysis.centroidHz, 0)} (${signed(r.vsReference.centroidDeltaHz, 0)})` : f(r.analysis.centroidHz, 0),
            r.vsReference ? f(r.vsReference.envCorr, 3) : '—',
            r.analysis.silent ? 'silent' : f(r.analysis.envRangeDb, 0),
          ],
        })),
      ),
    );
  }
  return lines.join('\n');
}

// ── SVG ─────────────────────────────────────────────────────────────────────

const PALETTE = ['#1f77b4', '#d95f02', '#1b9e77', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666', '#17becf', '#8c564b', '#bcbd22', '#9467bd'];

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * Waveform overlay: for each voice, the reference (blue) under the voice
 * (orange), the first `seconds` of the case. The voice is scaled to the
 * reference's level while sounding. The null test's lag is applied only when
 * the two correlate (|corr| > 0.5); otherwise it is noise and the traces are
 * drawn at lag 0.
 */
export function overlaySvg(result: CaseResult, seconds = 1.2): string {
  const ref = result.results.find((r) => r.voice.id === result.referenceId);
  const rows = result.results.filter((r) => r !== ref && r.alignment);
  const W = 900;
  const rowH = 64;
  const pad = 22;
  const H = pad + rows.length * (rowH + 8) + 8;
  if (!ref) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="40"/>`;
  const sr = ref.analysis.sampleRate;
  const n = Math.min(Math.round(seconds * sr), ref.signal.length);
  const peak = Math.max(ref.analysis.peak, 1e-6);

  const column = (sig: Float32Array, offset: number, gain: number, x: number): [number, number] => {
    const from = Math.floor((x / W) * n);
    const to = Math.max(from + 1, Math.floor(((x + 1) / W) * n));
    let lo = 0;
    let hi = 0;
    for (let i = from; i < to; i++) {
      const j = i + offset;
      const v = j >= 0 && j < sig.length ? sig[j] * gain : 0;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return [lo, hi];
  };
  const path = (sig: Float32Array, offset: number, gain: number, cy: number): string => {
    const top: string[] = [];
    const bottom: string[] = [];
    for (let x = 0; x < W; x++) {
      const [lo, hi] = column(sig, offset, gain, x);
      top.push(`${x},${(cy - (hi / peak) * (rowH / 2)).toFixed(1)}`);
      bottom.push(`${x},${(cy - (lo / peak) * (rowH / 2)).toFixed(1)}`);
    }
    return `M${top.join('L')}L${bottom.reverse().join('L')}Z`;
  };

  const body = rows
    .map((r, i) => {
      const cy = pad + i * (rowH + 8) + rowH / 2;
      const coherent = !!r.vsReference && Math.abs(r.vsReference.corr) > 0.5;
      const lag = coherent ? r.alignment!.lagSamples : 0;
      const gain = Math.sqrt(Math.max(ref.analysis.activePower, 1e-20) / Math.max(r.analysis.activePower, 1e-20));
      return (
        `<text x="4" y="${cy - rowH / 2 + 10}" font-size="11" fill="#444">${esc(r.voice.id)}  (corr ${r.vsReference ? r.vsReference.corr.toFixed(2) : '—'}, null ${r.vsReference ? r.vsReference.nullDb.toFixed(1) : '—'} dB${coherent ? `, lag ${lag} smp` : ', not coherent: lag 0'})</text>` +
        `<path d="${path(ref.signal, 0, 1, cy)}" fill="#1f77b4" fill-opacity="0.5"/>` +
        `<path d="${path(r.signal, lag, gain, cy)}" fill="#d95f02" fill-opacity="0.5"/>`
      );
    })
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif">` +
    `<rect width="${W}" height="${H}" fill="#fff"/>` +
    `<text x="4" y="14" font-size="12" fill="#222">${esc(result.case.id)} — <tspan fill="#1f77b4">${esc(result.referenceId)}</tspan> vs <tspan fill="#d95f02">voice</tspan> (level-matched while sounding, first ${seconds}s)</text>` +
    body +
    '</svg>'
  );
}

/** Long-term average third-octave spectra, level-matched to the reference. */
export function spectraSvg(result: CaseResult): string {
  const W = 900;
  const H = 360;
  const left = 46;
  const bottom = 30;
  const top = 26;
  const ref = result.results.find((r) => r.voice.id === result.referenceId);
  if (!ref) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="40"/>`;
  const nb = BAND_CENTERS_HZ.length;
  const refPower = Math.max(ref.analysis.activePower, 1e-20);
  const curves = result.results.map((r) => {
    const scale = refPower / Math.max(r.analysis.activePower, 1e-20);
    return Array.from(r.analysis.bandPower, (p) => toDb(p * scale));
  });
  const refMax = Math.max(...curves[result.results.indexOf(ref)]);
  const yMin = -70;
  const x = (b: number) => left + (b / (nb - 1)) * (W - left - 8);
  const y = (db: number) => top + (1 - (Math.max(db - refMax, yMin) - yMin) / -yMin) * (H - top - bottom);
  const lines = curves
    .map((c, i) => {
      const isRef = result.results[i] === ref;
      const d = c.map((v, b) => `${b ? 'L' : 'M'}${x(b).toFixed(1)},${y(v).toFixed(1)}`).join('');
      return `<path d="${d}" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="${isRef ? 3 : 1.4}" ${isRef ? '' : 'stroke-opacity="0.85"'}/>`;
    })
    .join('');
  const key = result.results
    .map(
      (r, i) =>
        `<text x="${W - 190}" y="${top + 4 + i * 14}" font-size="11" fill="${PALETTE[i % PALETTE.length]}">■ ${esc(r.voice.id)}</text>`,
    )
    .join('');
  const ticks = [100, 200, 500, 1000, 2000, 5000, 10000]
    .map((hz) => {
      const b = (Math.log2(hz / 31.5) * 3) - 4;
      return `<line x1="${x(b)}" x2="${x(b)}" y1="${top}" y2="${H - bottom}" stroke="#ddd"/><text x="${x(b)}" y="${H - 12}" font-size="10" text-anchor="middle" fill="#555">${hz >= 1000 ? `${hz / 1000}k` : hz}</text>`;
    })
    .join('');
  const dbTicks = [0, -20, -40, -60]
    .map((db) => `<line x1="${left}" x2="${W - 8}" y1="${y(refMax + db)}" y2="${y(refMax + db)}" stroke="#eee"/><text x="${left - 6}" y="${y(refMax + db) + 3}" font-size="10" text-anchor="end" fill="#555">${db}</text>`)
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif">` +
    `<rect width="${W}" height="${H}" fill="#fff"/>` +
    `<text x="4" y="14" font-size="12" fill="#222">${esc(result.case.id)} — average spectrum, level-matched while sounding (dB re reference peak band)</text>` +
    ticks + dbTicks + lines + key +
    '</svg>'
  );
}
