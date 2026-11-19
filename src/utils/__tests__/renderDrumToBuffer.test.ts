/**
 * A drum export is the kit the user sequenced (#1649): the offline `drumkit_*`
 * voice, or — when the native module is down — the live engine's own Web Audio
 * fallback kit. The Python `generate_kick` / `generate_snare` / `generate_hat`
 * run only for an explicit Python render, however a Pyodide runtime happens to
 * be sitting on the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HatParams, KickParams, SnareParams } from '@/types';
import { DEFAULT_CLOSED_HAT_PARAMS, DEFAULT_KICK_PARAMS, DEFAULT_SNARE_PARAMS } from '@/constants';

const native = vi.hoisted(() => ({ renderDrumkitBuffer: vi.fn() }));
vi.mock('@/audio/offline/OfflineDrumKitEngine', () => native);

interface FakeNode {
    kind: string;
    type?: string;
    connect: (n: unknown) => unknown;
    start: () => void;
    stop: () => void;
    [k: string]: unknown;
}
const created = vi.hoisted(() => ({ nodes: [] as FakeNode[] }));

vi.mock('@/audio/offline/createOfflineContext', () => {
    const param = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });
    const node = (kind: string): FakeNode => {
        const n: FakeNode = {
            kind,
            frequency: param(),
            gain: param(),
            Q: param(),
            connect: (to: unknown) => to,
            start: vi.fn(),
            stop: vi.fn(),
        };
        created.nodes.push(n);
        return n;
    };
    const FAKE_BUFFER = { kind: 'fallback-kit-buffer' };
    return {
        createOfflineContext: () => ({
            destination: {},
            createGain: () => node('gain'),
            createOscillator: () => node('osc'),
            createBufferSource: () => node('src'),
            createBiquadFilter: () => node('filter'),
            createBuffer: (_c: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
            startRendering: () => Promise.resolve(FAKE_BUFFER),
        }),
        createOfflineBuffer: ({ length }: { length: number }) => {
            const data = new Float32Array(length);
            return { length, getChannelData: () => data };
        },
    };
});

vi.mock('../renderAudio', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../renderAudio')>();
    // The XM build also bounces three synths; those are not under test here.
    const synthBuffer = () => {
        const data = new Float32Array(64).fill(0.1);
        return Promise.resolve({ sampleRate: 48_000, length: 64, duration: 64 / 48_000, getChannelData: () => data });
    };
    return { ...actual, renderSynthToBuffer: vi.fn(synthBuffer) };
});

import { renderDrumToBuffer } from '../renderAudio';
import { renderDrumPattern } from '../patternRenderer';
import { buildSongXM } from '../xmExport';
import { instrumentStore } from '@/stores/instrumentStore';

const kick: KickParams = { ...DEFAULT_KICK_PARAMS };
const snare: SnareParams = { ...DEFAULT_SNARE_PARAMS };
const hat: HatParams = { ...DEFAULT_CLOSED_HAT_PARAMS };

function pythonMock() {
    const sample = new Float32Array([0.25, 0.5, 0.25]);
    const proxy = { toJs: () => sample, destroy: vi.fn() };
    const fns = {
        generate_kick: vi.fn(() => proxy),
        generate_snare: vi.fn(() => proxy),
        generate_hat: vi.fn(() => proxy),
        freeze_drum_track: vi.fn(() => proxy),
        freeze_synth_track: vi.fn(() => proxy),
    };
    return { fns, pyodide: { globals: { get: (name: string) => fns[name as keyof typeof fns] } } };
}

function nativeBuffer() {
    return { kind: 'native-kit-buffer', numberOfChannels: 1, length: 8, getChannelData: () => new Float32Array(8), copyToChannel: vi.fn() };
}

beforeEach(() => {
    created.nodes.length = 0;
    native.renderDrumkitBuffer.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    instrumentStore.setDrumKit('808');
});

describe('renderDrumToBuffer — the live kit', () => {
    it('renders a kick through the offline native kit, not Python, with a Pyodide runtime present', async () => {
        const { fns, pyodide } = pythonMock();
        // The runtime a Python load would leave on the page (and what the app hands exporters).
        (globalThis as { hyphonPyodide?: unknown }).hyphonPyodide = pyodide;
        const buffer = nativeBuffer();
        native.renderDrumkitBuffer.mockResolvedValue(buffer);

        const out = await renderDrumToBuffer('kick', kick, 48_000);

        expect(out).toBe(buffer);
        expect(fns.generate_kick).not.toHaveBeenCalled();
        expect(fns.generate_snare).not.toHaveBeenCalled();
        expect(fns.generate_hat).not.toHaveBeenCalled();
        expect(native.renderDrumkitBuffer).toHaveBeenCalledWith(
            expect.objectContaining({
                kit: '808',
                sampleRate: 48_000,
                hits: [{ sound: 'kick', params: kick, startSeconds: 0 }],
            }),
            1,
        );
        (globalThis as { hyphonPyodide?: unknown }).hyphonPyodide = undefined;
    });

    it('sounds in the kit the user selected', async () => {
        instrumentStore.setDrumKit('909');
        native.renderDrumkitBuffer.mockResolvedValue(nativeBuffer());
        await renderDrumToBuffer('snare', snare, 44_100);
        expect(native.renderDrumkitBuffer).toHaveBeenCalledWith(expect.objectContaining({ kit: '909' }), 1);

        await renderDrumToBuffer('closedHat', hat, 44_100, { kit: '808' });
        expect(native.renderDrumkitBuffer).toHaveBeenLastCalledWith(expect.objectContaining({ kit: '808' }), 1);
    });

    it('a pattern export does not use the Python drum freezer either', async () => {
        const { fns, pyodide } = pythonMock();
        native.renderDrumkitBuffer.mockResolvedValue(nativeBuffer());

        await renderDrumPattern('kick', kick, {
            sequence: { steps: [{ note: 'C3' }, null, null, null] } as never,
            tempo: 120,
            sampleRate: 48_000,
            engines: { pyodide },
        });

        expect(fns.freeze_drum_track).not.toHaveBeenCalled();
        expect(fns.generate_kick).not.toHaveBeenCalled();
        expect(native.renderDrumkitBuffer).toHaveBeenCalledTimes(1);
    });

    it('an XM export with a Pyodide runtime in the engines bakes the live kit, not generate_*', async () => {
        const { fns, pyodide } = pythonMock();
        const buffer = {
            sampleRate: 48_000,
            length: 8,
            getChannelData: () => new Float32Array([0, 0.5, -0.5, 0.25, 0, 0, 0, 0]),
        };
        native.renderDrumkitBuffer.mockResolvedValue(buffer);
        const params = {
            synthA: { attack: 0.01, decay: 0.1 }, synthB: { attack: 0.01, decay: 0.1 }, bass2: { decay: 0.3 },
            kick, snare, closedHat: hat, openHat: hat, sampler: [],
        };

        await buildSongXM([], {} as never, params as never, 120, undefined, { pyodide }, undefined, { sampleRatePref: 48_000 } as never);

        expect(native.renderDrumkitBuffer.mock.calls.map(([req]) => (req as { hits: Array<{ sound: string }> }).hits[0].sound))
            .toEqual(['kick', 'snare', 'closedHat', 'openHat']);
        expect(fns.generate_kick).not.toHaveBeenCalled();
        expect(fns.generate_snare).not.toHaveBeenCalled();
        expect(fns.generate_hat).not.toHaveBeenCalled();
    });

    it('falls back to the live engine\'s Web Audio kit when the native kit is unavailable', async () => {
        const { fns } = pythonMock();
        native.renderDrumkitBuffer.mockResolvedValue(null);

        const out = await renderDrumToBuffer('kick', kick, 48_000);

        expect(out).toEqual({ kind: 'fallback-kit-buffer' });
        // DrumKitEngine's 808 kick: a sine sweep, not the old triangle-less approximation.
        expect(created.nodes.some((n) => n.kind === 'osc' && n.type === 'sine')).toBe(true);
        expect(fns.generate_kick).not.toHaveBeenCalled();
    });
});

describe('renderDrumToBuffer — an explicit Python render', () => {
    it('calls the Python generators only when asked', async () => {
        const { fns, pyodide } = pythonMock();

        const kickOut = await renderDrumToBuffer('kick', kick, 48_000, { python: pyodide });
        await renderDrumToBuffer('snare', snare, 48_000, { python: pyodide });
        await renderDrumToBuffer('closedHat', hat, 48_000, { python: pyodide });

        expect(fns.generate_kick).toHaveBeenCalledWith(kick.pitch, kick.decay, kick.tone, kick.volume);
        expect(fns.generate_snare).toHaveBeenCalledTimes(1);
        expect(fns.generate_hat).toHaveBeenCalledTimes(1);
        expect(native.renderDrumkitBuffer).not.toHaveBeenCalled();
        expect(kickOut.getChannelData(0)).toEqual(new Float32Array([0.25, 0.5, 0.25]));
    });

    it('a Python render that fails drops to the live kit', async () => {
        const { fns, pyodide } = pythonMock();
        fns.generate_kick.mockImplementation(() => { throw new Error('python exploded'); });
        const buffer = nativeBuffer();
        native.renderDrumkitBuffer.mockResolvedValue(buffer);

        await expect(renderDrumToBuffer('kick', kick, 48_000, { python: pyodide })).resolves.toBe(buffer);
    });
});
