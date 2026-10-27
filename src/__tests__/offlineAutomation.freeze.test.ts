/**
 * 303 freeze / export renders play the song's automation lanes (#1384).
 *
 * Golden: the full AI fixture's `synthA.filterCutoff` lane rises over bar 1
 * and falls over bar 2. Rendered through `render303FreezeOffline` with the
 * lane resolved into `paramSteps`, each step's brightness (mean squared first
 * difference over energy — a spectral-centroid proxy) follows the lane. The
 * same pattern without lanes stays flat.
 *
 * Every engine family the freeze path supports renders in-process (`sync`),
 * so nothing here needs a worker or WebGPU; `gpu-highfid` without `sync`
 * takes the highfid-cpu fallback, which is the path an automated job uses.
 */
import { describe, expect, it } from 'vitest';
import fullSong from '../../test-fixtures/ai-song/full.json';
import { convertAISong, type AISongData } from '../importers/ai-song';
import { render303FreezeOffline, type Offline303PatternData } from '../audio/OfflineRenderer';
import { resolveOffline303Automation } from '../audio/offline/offlineLaneAutomation';
import { renderOffline303Pattern } from '../audio/offline/OfflineOpen303Engine';
import { renderOfflineHighFid303Pattern } from '../audio/offline/OfflineHighFid303Engine';
import type { UnifiedAutomationLane } from '../types';

const SAMPLE_RATE = 44100;
const STEPS = 32;

function fixtureLanes(): UnifiedAutomationLane[] {
    const converted = convertAISong(fullSong as unknown as AISongData);
    if (!converted.success || !converted.song) throw new Error('fixture failed to convert');
    return converted.song.automationLanes ?? [];
}

/** One plain note per step, so every step starts from the same envelope. */
function pattern(paramSteps?: Offline303PatternData['paramSteps']): Offline303PatternData {
    return {
        steps: Array.from({ length: STEPS }, () => ({ note: 45, velocity: 90 })),
        tempo: 96,
        params: { cutoff: 0.3, resonance: 0.4, envMod: 0.25, decay: 0.6, accent: 0.5, volume: 0.8 },
        ...(paramSteps ? { paramSteps } : {}),
    };
}

function brightnessPerStep(buffer: Float32Array): number[] {
    const frames = Math.floor(buffer.length / STEPS);
    const out: number[] = [];
    for (let s = 0; s < STEPS; s++) {
        let diff = 0;
        let energy = 0;
        // Skip the attack: compare the steady part of each step.
        for (let i = s * frames + Math.floor(frames * 0.2) + 1; i < (s + 1) * frames; i++) {
            const d = buffer[i] - buffer[i - 1];
            diff += d * d;
            energy += buffer[i] * buffer[i];
        }
        out.push(energy > 0 ? diff / energy : 0);
    }
    return out;
}

const VOICES: Array<{ name: string; voice: { model303?: string; engine303?: string }; sync: boolean }> = [
    { name: 'open303', voice: { model303: 'stock-open303' }, sync: true },
    { name: 'jc303', voice: { model303: 'jc303' }, sync: true },
    { name: 'highfid-cpu', voice: { model303: 'highfid-cpu' }, sync: true },
    { name: 'gpu-highfid (cpu fallback)', voice: { model303: 'gpu-highfid' }, sync: false },
];

describe('render303FreezeOffline — automation lanes (#1384)', () => {
    const automation = resolveOffline303Automation(
        fixtureLanes(),
        { totalSteps: STEPS, stepCount: STEPS, songMode: false },
        'synthA',
    );

    it('resolves the fixture cutoff lane into per-step 303 params', () => {
        expect(automation.report.applied).toEqual(['synthA.filterCutoff']);
        expect(automation.paramSteps).toHaveLength(STEPS);
        expect(automation.paramSteps![0]).toEqual({ cutoff: 24 / 127 });
        expect(automation.paramSteps![16]).toEqual({ cutoff: 1 });
    });

    for (const { name, voice, sync } of VOICES) {
        it(`${name}: brightness follows the cutoff lane; the flat render does not move`, async () => {
            const swept = await render303FreezeOffline(voice, pattern(automation.paramSteps), { sync, sampleRate: SAMPLE_RATE });
            const flat = await render303FreezeOffline(voice, pattern(), { sync, sampleRate: SAMPLE_RATE });
            for (const s of swept.buffer) expect(Number.isFinite(s)).toBe(true);

            const b = brightnessPerStep(swept.buffer);
            // Up across bar 1 (lane 24 → 127), down across bar 2 (127 → 25).
            expect(b[15]).toBeGreaterThan(b[0] * 3);
            expect(b[31]).toBeLessThan(b[16] / 3);
            expect(b[8]).toBeGreaterThan(b[2]);
            expect(b[28]).toBeLessThan(b[20]);

            const f = brightnessPerStep(flat.buffer);
            // The oscillator phase is not reset per note, so a flat render
            // wobbles ~10% step to step; the sweep moves it 10–50×.
            const settled = f.slice(1);
            expect(Math.max(...settled) / Math.min(...settled)).toBeLessThan(1.25);
        });
    }

    it('paramSteps is plain data: a job cloned across the worker boundary renders the same samples', () => {
        // Offline303Renderer.worker receives the pattern by postMessage (structured clone).
        const job = pattern(automation.paramSteps);
        const cloned = structuredClone(job);
        expect(cloned.paramSteps).toEqual(job.paramSteps);
        const opts = { sampleRate: SAMPLE_RATE };
        const fromClone = renderOffline303Pattern('stock-open303', cloned, opts);
        expect(fromClone).toEqual(renderOffline303Pattern('stock-open303', job, opts));
        // The clone still carries the automation: it is not the static render.
        expect(fromClone).not.toEqual(renderOffline303Pattern('stock-open303', pattern(), opts));
        expect(renderOfflineHighFid303Pattern(cloned, opts))
            .toEqual(renderOfflineHighFid303Pattern(job, opts));
    });

    it('a lane-free song resolves to no paramSteps (the job is the old static one)', () => {
        const none = resolveOffline303Automation([], { totalSteps: STEPS, stepCount: STEPS, songMode: false }, 'synthA');
        expect(none.paramSteps).toBeUndefined();
        expect(none.report).toEqual({ applied: [], notRendered: [] });
    });

    it('reports 303 lanes the offline engines have no param for', () => {
        const drive: UnifiedAutomationLane = {
            id: 'd', target: 'bass2', parameter: 'drive', name: 'drive',
            points: [{ step: 0, value: 0.2 }, { step: 31, value: 0.9 }],
            interpolation: 'linear', source: 'manual', scope: 'song', enabled: true,
        };
        const result = resolveOffline303Automation(
            [...fixtureLanes(), drive],
            { totalSteps: STEPS, stepCount: STEPS, songMode: false },
            'bass2',
        );
        expect(result.report.applied).toEqual(['bass2.decay']);
        expect(result.report.notRendered).toEqual([
            { lane: 'bass2.drive', reason: expect.stringContaining('no drive stage') as unknown as string },
        ]);
        expect(result.paramSteps![0]).toEqual({ decay: 30 / 127 });
        expect(result.paramSteps![16]).toEqual({ decay: 100 / 127 });
    });
});
