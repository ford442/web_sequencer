import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    bounceBuffersThroughOfflineGraph,
    compileOfflineGraph,
} from '../compileOfflineGraph';
import { CLASSIC_ELECTRIBE_GRAPH } from '../../graph/defaultElectribeGraph';
import { applyWamSlotsToGraph } from '../../wam/applySlots';
import { SAMPLE_RATE_STORAGE_KEY } from '../../../utils/audioContextPolicy';
import { WAM2_DEFAULT_PERMISSIONS, type Wam2PackageDescriptor } from '../../wam/types';
import type { Wam2SongPayload } from '../../wam/persist';

/**
 * Offline render context stand-in.
 *
 * Every node records what it connects to, so a test can assert routing without
 * a real audio thread. `startRendering` hands back a buffer of the length the
 * context was constructed with, which is all the loudness stage needs.
 */
function createOfflineContextMock(channels: number, length: number, sampleRate: number) {
    const connections: Array<{ from: string; to: string }> = [];
    let counter = 0;

    const makeNode = (kind: string, extra: Record<string, unknown> = {}) => {
        const id = `${kind}_${counter++}`;
        const node = {
            id,
            connect: vi.fn((dest: { id?: string }) => {
                connections.push({ from: id, to: dest?.id ?? 'destination' });
            }),
            disconnect: vi.fn(),
            ...extra,
        };
        return node;
    };

    const audioParam = () => ({ value: 1, setValueAtTime: vi.fn() });

    const context = {
        currentTime: 0,
        sampleRate,
        length,
        destination: { id: 'destination', connect: vi.fn(), disconnect: vi.fn() },
        createGain: vi.fn(() => makeNode('gain', { gain: audioParam() })),
        createOscillator: vi.fn(() =>
            makeNode('osc', {
                frequency: audioParam(),
                detune: audioParam(),
                start: vi.fn(),
                stop: vi.fn(),
            }),
        ),
        createBufferSource: vi.fn(() =>
            makeNode('bufferSource', { buffer: null, start: vi.fn(), stop: vi.fn() }),
        ),
        createWaveShaper: vi.fn(() => makeNode('waveShaper', { curve: null, oversample: 'none' })),
        createBiquadFilter: vi.fn(() =>
            makeNode('biquad', {
                type: 'lowpass',
                frequency: audioParam(),
                Q: audioParam(),
                gain: audioParam(),
            }),
        ),
        createDynamicsCompressor: vi.fn(() =>
            makeNode('compressor', {
                threshold: audioParam(),
                knee: audioParam(),
                ratio: audioParam(),
                attack: audioParam(),
                release: audioParam(),
            }),
        ),
        createStereoPanner: vi.fn(() => makeNode('panner', { pan: audioParam() })),
        createAnalyser: vi.fn(() =>
            makeNode('analyser', { fftSize: 256, smoothingTimeConstant: 0.5 }),
        ),
        createConvolver: vi.fn(() => makeNode('convolver', { buffer: null })),
        createDelay: vi.fn(() => makeNode('delay', { delayTime: audioParam() })),
        createBuffer: (ch: number, len: number, rate: number) => ({
            numberOfChannels: ch,
            length: len,
            sampleRate: rate,
            duration: len / rate,
            getChannelData: () => new Float32Array(len),
        }),
        startRendering: vi.fn(() =>
            Promise.resolve({
                numberOfChannels: channels,
                length,
                sampleRate,
                duration: length / sampleRate,
                getChannelData: () => new Float32Array(length),
            }),
        ),
    };

    return { context: context as unknown as OfflineAudioContext, connections, raw: context };
}

function trackContexts() {
    const created: Array<{ channels: number; length: number; sampleRate: number }> = [];
    const mocks: ReturnType<typeof createOfflineContextMock>[] = [];
    const factory = (channels: number, length: number, sampleRate: number) => {
        created.push({ channels, length, sampleRate });
        const mock = createOfflineContextMock(channels, length, sampleRate);
        mocks.push(mock);
        return mock.context;
    };
    return { created, mocks, factory };
}

function descriptor(overrides: Partial<Wam2PackageDescriptor>): Wam2PackageDescriptor {
    return {
        id: 'hyphon.tone',
        version: '1.0.0',
        kind: 'effect',
        title: 'Test Package',
        vendor: 'Hyphon',
        license: 'MIT',
        origin: 'bundled',
        params: [{ id: 'gain', label: 'Gain', min: 0, max: 1, defaultValue: 0.8 }],
        integrity: { alg: 'fnv1a32', value: 'test' },
        offline: 'native',
        isolation: 'audio-graph-slot',
        permissions: WAM2_DEFAULT_PERMISSIONS,
        ...overrides,
    };
}

function slotPayload(overrides: Partial<Wam2SongPayload['plugins'][number]> = {}): Wam2SongPayload {
    return {
        schema: 1,
        plugins: [
            {
                slotId: 'wam2-slot-1',
                packageId: 'hyphon.gain',
                version: '1.0.0',
                integrity: { alg: 'fnv1a32', value: 'test' },
                placement: 'masterInsert',
                attachToNodeId: 'masterGain',
                paramState: {},
                ...overrides,
            },
        ],
    };
}

describe('compileOfflineGraph', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    describe('sample rate follows the live policy (#1136 export half)', () => {
        it('uses an explicit rate pref verbatim', async () => {
            const { created, factory } = trackContexts();
            const compiled = await compileOfflineGraph({
                durationSeconds: 1,
                patch: CLASSIC_ELECTRIBE_GRAPH,
                wam2: null,
                sampleRatePref: 48000,
                contextFactory: factory,
            });

            expect(created[0].sampleRate).toBe(48000);
            expect(compiled.report.sampleRate).toBe(48000);
        });

        it('resolves `native` to the recorded live AudioContext rate', async () => {
            const { created, factory } = trackContexts();
            const compiled = await compileOfflineGraph({
                durationSeconds: 1,
                patch: CLASSIC_ELECTRIBE_GRAPH,
                wam2: null,
                sampleRatePref: 'native',
                liveSampleRate: 96000,
                contextFactory: factory,
            });

            expect(created[0].sampleRate).toBe(96000);
            expect(compiled.report.liveSampleRate).toBe(96000);
        });

        it('reads the stored pref when the caller passes none', async () => {
            localStorage.setItem(SAMPLE_RATE_STORAGE_KEY, '48000');
            const { created, factory } = trackContexts();
            await compileOfflineGraph({
                durationSeconds: 1,
                patch: CLASSIC_ELECTRIBE_GRAPH,
                wam2: null,
                contextFactory: factory,
            });

            expect(created[0].sampleRate).toBe(48000);
        });

        it('falls back to 44.1 kHz for `native` with no live context', async () => {
            const { created, factory } = trackContexts();
            await compileOfflineGraph({
                durationSeconds: 2,
                patch: CLASSIC_ELECTRIBE_GRAPH,
                wam2: null,
                sampleRatePref: 'native',
                contextFactory: factory,
            });

            expect(created[0].sampleRate).toBe(44100);
            expect(created[0].length).toBe(88200);
        });
    });

    it('compiles the live patch with the shared compiler, not a private graph', async () => {
        const { factory } = trackContexts();
        const compiled = await compileOfflineGraph({
            durationSeconds: 1,
            patch: CLASSIC_ELECTRIBE_GRAPH,
            wam2: null,
            sampleRatePref: 44100,
            contextFactory: factory,
        });

        expect(compiled.report.patchId).toBe(CLASSIC_ELECTRIBE_GRAPH.id);
        // Every node the patch declares exists in the offline graph, including
        // the master chain the live engine resolves by role.
        for (const node of CLASSIC_ELECTRIBE_GRAPH.nodes) {
            if (node.factory === 'masterLimiter') continue; // worklet: DSP runs post-render
            expect(compiled.graph.nodes.has(node.id)).toBe(true);
        }
        expect(compiled.input).toBe(compiled.graph.getNode('masterSaturation'));
    });

    describe('WAM2 slots (ADR 0001)', () => {
        const patchWithSlot = applyWamSlotsToGraph(
            CLASSIC_ELECTRIBE_GRAPH,
            slotPayload().plugins,
        );

        it('bypasses a slot the package cannot render offline and says why', async () => {
            const { factory } = trackContexts();
            const compiled = await compileOfflineGraph({
                durationSeconds: 1,
                patch: patchWithSlot,
                wam2: slotPayload(),
                sampleRatePref: 44100,
                contextFactory: factory,
                resolveDescriptor: () =>
                    Promise.resolve(
                        descriptor({
                            id: 'community.reverb',
                            origin: 'community',
                            offline: 'unsupported',
                        }),
                    ),
            });

            expect(compiled.report.slots).toEqual([
                expect.objectContaining({
                    nodeId: 'wam2-slot-1',
                    status: 'bypassed',
                    reason: 'offline-unsupported',
                    offline: 'unsupported',
                }),
            ]);
            // No substitute: nothing was mounted in its place.
            expect(compiled.slotPlugins.size).toBe(0);
            const ports = compiled.graph.ports.get('wam2-slot-1')?.wamSlot;
            expect(ports?.bypass.gain.value).toBe(1);
            expect(ports?.wet.gain.value).toBe(0);
        });

        it('refuses a community package even if it claims offline support', async () => {
            const { factory } = trackContexts();
            const compiled = await compileOfflineGraph({
                durationSeconds: 1,
                patch: patchWithSlot,
                wam2: slotPayload(),
                sampleRatePref: 44100,
                contextFactory: factory,
                resolveDescriptor: () =>
                    Promise.resolve(
                        descriptor({
                            id: 'community.reverb',
                            origin: 'community',
                            offline: 'native',
                        }),
                    ),
            });

            expect(compiled.report.slots[0].status).toBe('bypassed');
            expect(compiled.slotPlugins.size).toBe(0);
        });

        it('reports a slot whose package is not allowlisted', async () => {
            const { factory } = trackContexts();
            const compiled = await compileOfflineGraph({
                durationSeconds: 1,
                patch: patchWithSlot,
                wam2: slotPayload(),
                sampleRatePref: 44100,
                contextFactory: factory,
                resolveDescriptor: () => Promise.resolve(null),
            });

            expect(compiled.report.slots[0]).toMatchObject({
                status: 'bypassed',
                reason: 'not-allowlisted',
            });
        });

        it('mounts a bundled fixture that declares native offline support', async () => {
            const { factory } = trackContexts();
            const compiled = await compileOfflineGraph({
                durationSeconds: 1,
                patch: patchWithSlot,
                wam2: slotPayload({ packageId: 'hyphon.gain' }),
                sampleRatePref: 44100,
                contextFactory: factory,
                resolveDescriptor: () => Promise.resolve(descriptor({ id: 'hyphon.gain' })),
            });

            expect(compiled.report.slots[0]).toMatchObject({
                status: 'rendered',
                offline: 'native',
            });
            expect(compiled.slotPlugins.get('wam2-slot-1')).toBeDefined();
        });

        it('bypasses an empty slot rather than failing the render', async () => {
            const { factory } = trackContexts();
            const compiled = await compileOfflineGraph({
                durationSeconds: 1,
                patch: patchWithSlot,
                wam2: { schema: 1, plugins: [] },
                sampleRatePref: 44100,
                contextFactory: factory,
            });

            expect(compiled.report.slots[0]).toMatchObject({
                status: 'bypassed',
                reason: 'no-plugin-in-slot',
            });
        });
    });

    describe('master loudness stage (#1095)', () => {
        it('runs the offline limiter over the rendered mix', async () => {
            const { factory } = trackContexts();
            const compiled = await compileOfflineGraph({
                durationSeconds: 0.05,
                patch: CLASSIC_ELECTRIBE_GRAPH,
                wam2: null,
                sampleRatePref: 44100,
                contextFactory: factory,
            });

            await compiled.render();

            expect(compiled.report.loudness).not.toBeNull();
            expect(compiled.report.loudness?.limited).toBe(true);
            expect(compiled.report.loudness?.settings.ceilingDbtp).toBe(-1);
        });

        it('measures without touching samples when the limiter is off', async () => {
            const { factory } = trackContexts();
            const compiled = await compileOfflineGraph({
                durationSeconds: 0.05,
                patch: CLASSIC_ELECTRIBE_GRAPH,
                wam2: null,
                sampleRatePref: 44100,
                contextFactory: factory,
                loudness: { settings: { enabled: false } },
            });

            await compiled.render();
            expect(compiled.report.loudness?.limited).toBe(false);
        });

        it('skips the stage entirely for a dry render', async () => {
            const { factory } = trackContexts();
            const compiled = await compileOfflineGraph({
                durationSeconds: 0.05,
                patch: CLASSIC_ELECTRIBE_GRAPH,
                wam2: null,
                sampleRatePref: 44100,
                contextFactory: factory,
                loudness: { enabled: false },
            });

            await compiled.render();
            expect(compiled.report.loudness).toBeNull();
        });
    });

    it('bounces source buffers into the patch master input', async () => {
        const { mocks, factory } = trackContexts();
        const source = {
            numberOfChannels: 2,
            length: 4410,
            sampleRate: 44100,
            duration: 0.1,
            getChannelData: () => new Float32Array(4410),
        } as unknown as AudioBuffer;

        const result = await bounceBuffersThroughOfflineGraph({
            buffers: [source],
            durationSeconds: 0.1,
            patch: CLASSIC_ELECTRIBE_GRAPH,
            wam2: null,
            sampleRatePref: 44100,
            contextFactory: factory,
        });

        expect(result.buffer.length).toBe(4410);
        expect(mocks[0].raw.createBufferSource).toHaveBeenCalledTimes(1);
        expect(mocks[0].raw.startRendering).toHaveBeenCalledTimes(1);
    });
});
