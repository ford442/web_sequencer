/**
 * `render_and_measure`'s report: the render the export modal makes, measured
 * with the functions `pnpm run ai-song:render` writes `report.json` with
 * (`agent/audioMetrics.ts`), boiled down to what an agent can act on.
 */

import { analyzeAudio, mixDown, parseWav, spectralCentroid, stepsPerBar, type AudioMetrics } from '../audioMetrics';
import type { AgentRenderResult } from '../agentApi';
import type { OfflineAutomationReport } from '../../audio/offline/offlineLaneAutomation';

export interface LevelSummary {
    integratedLufs: number | null;
    truePeakDbtp: number | null;
    peakDbfs: number | null;
    rmsDbfs: number | null;
    /** Peak over RMS, dB: low = squashed, high = spiky. */
    crestDb: number | null;
    /** Spectral centroid of the whole file, Hz: where the energy sits. */
    centroidHz: number | null;
    silent: boolean;
}

export interface MeasureReport {
    seconds: number;
    master: LevelSummary & { bars?: Array<{ bar: number; rmsDbfs: number | null; centroidHz: number | null }> };
    /** Per stem (`synthA`, `synthB`, `bass2`, `drums`, `sampler-bank-N`). */
    stems: Record<string, LevelSummary>;
    /** Tracks the mix mutes or solos away (rendered as silence). */
    silencedTracks: string[];
    /** Engines on a fallback (e.g. a macro model rendered as its fallback waveform). */
    engineIssues: Array<{ subsystem: string; message: string; activeBackend: string }>;
    /** Lanes the render plays, and routed lanes it cannot. */
    automation: OfflineAutomationReport;
}

/** The export's stem ids, with the two SYNTH stems named as get_song names their tracks. */
const STEM_NAMES: Readonly<Record<string, string>> = { partA: 'synthA', partB: 'synthB' };

const round1 = (x: number | null): number | null => (x === null ? null : Math.round(x * 10) / 10);

function base64Bytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function summarize(metrics: AudioMetrics, channels: readonly Float32Array[], sampleRate: number): LevelSummary {
    const centroid = metrics.silent ? null : spectralCentroid(mixDown(channels), sampleRate);
    return {
        integratedLufs: round1(metrics.integratedLufs),
        truePeakDbtp: round1(metrics.truePeakDbtp),
        peakDbfs: round1(metrics.peakDbfs),
        rmsDbfs: round1(metrics.rmsDbfs),
        crestDb: metrics.peakDbfs !== null && metrics.rmsDbfs !== null ? round1(metrics.peakDbfs - metrics.rmsDbfs) : null,
        centroidHz: centroid === null ? null : Math.round(centroid),
        silent: metrics.silent,
    };
}

export function measureRender(
    render: AgentRenderResult,
    song: { tempo: number; timeSignature?: readonly [number, number] },
    options: { bars: boolean },
): MeasureReport {
    const grid = { stepSeconds: 15 / song.tempo, stepsPerBar: stepsPerBar(song.timeSignature) };
    let master: MeasureReport['master'] | null = null;
    let seconds = 0;
    const stems: Record<string, LevelSummary> = {};
    for (const file of render.files) {
        const wav = parseWav(base64Bytes(file.base64));
        const metrics = analyzeAudio(wav.channels, wav.sampleRate, grid);
        const summary = summarize(metrics, wav.channels, wav.sampleRate);
        const id = file.path.replace(/^stems\//, '').replace(/\.wav$/, '');
        if (id === 'master') {
            seconds = metrics.durationSeconds;
            master = options.bars
                ? { ...summary, bars: metrics.bars.map((b) => ({ bar: b.bar, rmsDbfs: round1(b.rmsDbfs), centroidHz: b.centroidHz })) }
                : summary;
        } else {
            stems[STEM_NAMES[id] ?? id] = summary;
        }
    }
    if (!master) throw new Error('the render returned no master stem');
    const silenced = Array.isArray(render.metadata.silencedTracks) ? (render.metadata.silencedTracks as string[]) : [];
    return {
        seconds,
        master,
        stems,
        silencedTracks: silenced.map((t) => STEM_NAMES[t] ?? t),
        engineIssues: render.engineIssues.map((i) => ({ subsystem: i.subsystem, message: i.message, activeBackend: i.activeBackend })),
        automation: render.report.automation,
    };
}
