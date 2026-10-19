/**
 * Drive `window.__HYPHON_AGENT__` in a booted Hyphon page and turn what it
 * returns into files + `report.json`. Shared by the CLI
 * (`scripts/ai-song-render.ts`) and `tests/ai-song-render.spec.ts`, so the spec
 * tests exactly what an agent runs.
 */

import type { Page } from '@playwright/test';
import { analyzeAudio, parseWav, stepsPerBar, type AudioMetrics } from '../../src/agent/audioMetrics';
import type { AgentEngine303, AgentImportReport } from '../../src/agent/agentSong';
import type { AgentExportResult, AgentRenderResult } from '../../src/agent/agentApi';

export const RENDER_FORMATS = ['wav', 'rbs', 'mid', 'xm'] as const;
export type RenderFormat = (typeof RENDER_FORMATS)[number];

/** Process exit codes. Anything but `ok` means the song needs another look. */
export const EXIT = {
    ok: 0,
    /** Bad arguments, missing build, the app did not boot. */
    usage: 1,
    /** The song failed validation, or (strict) the importer warned. */
    validation: 2,
    /** A render or an export threw or reported failure. */
    render: 3,
    /** Everything rendered, but the master is silent. */
    silent: 4,
} as const;

export interface RenderOptions {
    formats: readonly RenderFormat[];
    /** Write `stems/*.wav` and their metrics too. */
    stems: boolean;
    strict: boolean;
    engine303?: AgentEngine303;
}

export interface RenderedFile {
    /** Path inside the output directory: `mix.wav`, `stems/partA.wav`, `song.rbs`, … */
    path: string;
    bytes: Uint8Array;
}

export interface FormatReport {
    file: string | null;
    warnings: string[];
    error?: string;
}

export interface AISongRenderReport {
    ok: boolean;
    exitCode: number;
    errors: string[];
    options: { formats: RenderFormat[]; stems: boolean; strict: boolean; engine303: AgentEngine303 | null };
    import: AgentImportReport;
    /** The export modal's report for the mix, plus engines that ran on a fallback. */
    render: null | {
        report: AgentRenderResult['report'];
        totalSteps: unknown;
        measureCount: unknown;
        silencedTracks: unknown;
        engineIssues: Array<{ subsystem: string; message: string; reason: string }>;
    };
    exports: Partial<Record<Exclude<RenderFormat, 'wav'>, FormatReport>>;
    metrics: null | {
        /** Bar grid the per-bar metrics use. */
        grid: { stepSeconds: number; stepsPerBar: number; expectedSeconds: number | null };
        master: AudioMetrics;
        stems: Record<string, AudioMetrics>;
    };
    files: string[];
}

export interface RenderOutcome {
    report: AISongRenderReport;
    files: RenderedFile[];
}

const EXPORT_FILES = { rbs: 'song.rbs', mid: 'song.mid', xm: 'song.xm' } as const;

function decode(base64: string): Uint8Array {
    return new Uint8Array(Buffer.from(base64, 'base64'));
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** `stems/master.wav` → `mix.wav`; the other stems keep their export-modal path. */
function outputPath(stemPath: string): string {
    return stemPath === 'stems/master.wav' ? 'mix.wav' : stemPath;
}

/** Import `songJson`, render what `options` asks for, and measure it. The page must be booted. */
export async function renderAISongInPage(page: Page, songJson: string, options: RenderOptions): Promise<RenderOutcome> {
    const files: RenderedFile[] = [];
    const errors: string[] = [];
    const formats = [...options.formats];

    const imported = await page.evaluate(
        ([song, opts]) => {
            const agent = window.__HYPHON_AGENT__;
            if (!agent) throw new Error('window.__HYPHON_AGENT__ is missing — boot with ?agent=1');
            return agent.importAISong(song, opts);
        },
        [songJson, { strict: options.strict, engine303: options.engine303 }] as const,
    );

    const report: AISongRenderReport = {
        ok: false,
        exitCode: EXIT.ok,
        errors,
        options: { formats, stems: options.stems, strict: options.strict, engine303: options.engine303 ?? null },
        import: imported,
        render: null,
        exports: {},
        metrics: null,
        files: [],
    };
    const fail = (code: number, error: string) => {
        errors.push(error);
        if (report.exitCode === EXIT.ok || code < report.exitCode) report.exitCode = code;
    };

    if (!imported.ok) {
        for (const error of imported.errors) fail(EXIT.validation, error);
        return { report, files };
    }

    if (formats.includes('wav')) {
        try {
            const mix = await page.evaluate(
                (stems) => window.__HYPHON_AGENT__!.renderMix({ stems }),
                options.stems,
            );
            const metadata = mix.metadata;
            report.render = {
                report: mix.report,
                totalSteps: metadata.totalSteps,
                measureCount: metadata.measureCount,
                silencedTracks: metadata.silencedTracks,
                engineIssues: mix.engineIssues.map(({ subsystem, message, reason }) => ({ subsystem, message, reason })),
            };

            const stepSeconds = 15 / (imported.tempo ?? 120);
            const totalSteps = typeof metadata.totalSteps === 'number' ? metadata.totalSteps : null;
            const grid = {
                stepSeconds,
                stepsPerBar: stepsPerBar(imported.timeSignature ?? undefined),
                expectedSeconds: totalSteps === null ? null : totalSteps * stepSeconds,
            };
            let master: AudioMetrics | null = null;
            const stems: Record<string, AudioMetrics> = {};
            for (const file of mix.files) {
                const bytes = decode(file.base64);
                const path = outputPath(file.path);
                files.push({ path, bytes });
                const wav = parseWav(bytes);
                const metrics = analyzeAudio(wav.channels, wav.sampleRate, grid);
                if (path === 'mix.wav') master = metrics;
                else stems[path.replace(/^stems\//, '').replace(/\.wav$/, '')] = metrics;
            }
            if (!master) throw new Error('the render returned no master stem');
            report.metrics = { grid, master, stems };
            if (master.silent) fail(EXIT.silent, `mix.wav is silent (sample peak ${master.peak})`);
        } catch (error) {
            fail(EXIT.render, `wav: ${message(error)}`);
        }
    }

    for (const format of ['rbs', 'mid', 'xm'] as const) {
        if (!formats.includes(format)) continue;
        let result: AgentExportResult;
        try {
            result = await page.evaluate((f) => {
                const agent = window.__HYPHON_AGENT__!;
                return f === 'rbs' ? agent.exportRbs() : f === 'mid' ? agent.exportMidi() : agent.exportXm();
            }, format);
        } catch (error) {
            result = { ok: false, error: message(error), warnings: [] };
        }
        if (result.ok) {
            files.push({ path: EXPORT_FILES[format], bytes: decode(result.base64) });
            report.exports[format] = { file: EXPORT_FILES[format], warnings: result.warnings };
        } else {
            report.exports[format] = { file: null, warnings: result.warnings, error: result.error };
            fail(EXIT.render, `${format}: ${result.error}`);
        }
    }

    report.files = files.map((f) => f.path);
    report.ok = report.exitCode === EXIT.ok;
    return { report, files };
}

export function parseFormats(value: string): RenderFormat[] {
    const formats = value.split(',').map((f) => f.trim()).filter(Boolean);
    const unknown = formats.filter((f) => !(RENDER_FORMATS as readonly string[]).includes(f));
    if (unknown.length > 0) throw new Error(`unknown format(s): ${unknown.join(', ')} (expected ${RENDER_FORMATS.join(', ')})`);
    return formats as RenderFormat[];
}
