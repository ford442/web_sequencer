import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PcfEffect } from '../../../engines/PcfEffect';
import type { OpenrbLowpassBranch, OpenrbLowpassProvider } from '../../graph/lowpassMode';
import { pcfFilterForSave } from '../masterPcf';
import {
    PCF_NODE_DEFAULTS,
    PCF_OPENRB_BYPASSED,
    PCF_OPENRB_LOWPASS_ONLY,
    PcfInsert,
    applyPcfNodeEdit,
    broadcastPcfTransport,
    createMasterPcfProvider,
    createPcfNodeProvider,
    disposeLivePcfInserts,
    livePcfInserts,
    normalizePcfNodeConfig,
    pcfKnobToHz,
    pcfKnobToQ,
    pcfLaneFanout,
    registerPcfInsert,
} from '../pcfInsert';

interface FakeParam {
    value: number;
    setValueAtTime(value: number): void;
    linearRampToValueAtTime(value: number): void;
    cancelScheduledValues(): void;
}

function param(initial = 1): FakeParam {
    return {
        value: initial,
        setValueAtTime(value) {
            this.value = value;
        },
        linearRampToValueAtTime(value) {
            this.value = value;
        },
        cancelScheduledValues() {},
    };
}

function fakeContext(withWorklet = true): BaseAudioContext {
    const gain = () => ({ gain: param(1), connect: vi.fn(), disconnect: vi.fn() });
    return {
        currentTime: 0,
        createGain: gain,
        ...(withWorklet ? { audioWorklet: { addModule: () => Promise.resolve() } } : {}),
    } as unknown as BaseAudioContext;
}

/** Every message each PCF worklet received, in order. */
let posted: Array<{ type: string; data: unknown }>[] = [];

function stubWorklet() {
    posted = [];
    vi.stubGlobal(
        'AudioWorkletNode',
        class {
            readonly messages: Array<{ type: string; data: unknown }> = [];
            port = { postMessage: (m: { type: string; data: unknown }) => this.messages.push(m) };
            connect = vi.fn();
            disconnect = vi.fn();
            constructor() {
                posted.push(this.messages);
            }
        },
    );
}

function fakeOpenrb() {
    const sets: Array<{ cutoffHz?: number; q?: number }> = [];
    const requests: Array<{ nodeId: string; frequency: number; Q: number }> = [];
    const provider: OpenrbLowpassProvider = (context, request) => {
        requests.push(request);
        const branch: OpenrbLowpassBranch = {
            node: (context as unknown as { createGain(): AudioNode }).createGain(),
            set: (params) => sets.push(params),
            bitExact: () => true,
            dispose: vi.fn(),
        };
        return branch;
    };
    return { provider, sets, requests };
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    stubWorklet();
});

afterEach(() => {
    disposeLivePcfInserts();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('PCF node config', () => {
    it('fills defaults and sanitizes hostile stored values', () => {
        expect(normalizePcfNodeConfig(undefined)).toEqual(PCF_NODE_DEFAULTS);
        const cfg = normalizePcfNodeConfig({
            enabled: 'yes',
            filterType: 'notch',
            cutoff: 900,
            resonance: -4,
            envAmount: Number.NaN,
            pattern: [200, -1, 'x', ...new Array(40).fill(64)],
            followMasterLanes: 1,
            filterMode: 'openrb',
        });
        expect(cfg.enabled).toBe(true);
        expect(cfg.filterType).toBe('lp');
        expect(cfg.cutoff).toBe(127);
        expect(cfg.resonance).toBe(0);
        expect(cfg.envAmount).toBe(PCF_NODE_DEFAULTS.envAmount);
        expect(cfg.pattern).toHaveLength(32);
        expect(cfg.pattern.slice(0, 3)).toEqual([127, 0, 0]);
        expect(cfg.followMasterLanes).toBe(false);
        expect(cfg.filterMode).toBe('openrb');
    });

    it('applies an edit, keeping the pattern when the new one is unusable', () => {
        const cfg = applyPcfNodeEdit({ cutoff: 10 }, { cutoff: 300, pattern: [] });
        expect(cfg.cutoff).toBe(127);
        expect(cfg.pattern).toEqual(PCF_NODE_DEFAULTS.pattern);
    });

    it('maps knobs on the worklet curves', () => {
        expect(pcfKnobToHz(0)).toBeCloseTo(20);
        expect(pcfKnobToHz(127)).toBeCloseTo(20_000);
        expect(pcfKnobToQ(0)).toBeCloseTo(0.5);
        expect(pcfKnobToQ(127)).toBeCloseTo(30);
    });
});

describe('PcfInsert', () => {
    function insert(options: { mode?: 'rbj' | 'openrb'; master?: boolean } = {}) {
        const context = fakeContext();
        const effect = new PcfEffect(context);
        effect.loadSettings({
            ...PCF_NODE_DEFAULTS,
            pattern: [...PCF_NODE_DEFAULTS.pattern],
            target: { tb303A: true, tb303B: true, drums: true },
        });
        const openrb = fakeOpenrb();
        const branch = openrb.provider(context, { nodeId: 'pcf-1', frequency: 1000, Q: 1 });
        const pcf = new PcfInsert(context, effect, { nodeId: 'pcf-1', filterMode: options.mode, master: options.master }, branch);
        return { pcf, effect, openrb };
    }

    it('plays openrb when asked for on an enabled low-pass PCF', () => {
        const { pcf } = insert({ mode: 'openrb' });
        expect(pcf.status()).toMatchObject({ mode: 'openrb', active: 'openrb', openrbAvailable: true });
        expect(pcf.status().held).toBeUndefined();
    });

    it('holds the pattern PCF in band-pass / high-pass, and while it is off', () => {
        const { pcf } = insert({ mode: 'openrb' });
        expect(pcf.edit({ filterType: 'bp' }).mode).toMatchObject({ active: 'rbj', held: PCF_OPENRB_LOWPASS_ONLY });
        expect(pcf.edit({ filterType: 'lp', enabled: false }).mode).toMatchObject({ active: 'rbj', held: PCF_OPENRB_BYPASSED });
        expect(pcf.edit({ enabled: true }).mode).toMatchObject({ active: 'openrb' });
    });

    it('retunes the openrb branch to the knobs, including a song load on the effect', () => {
        const { pcf, effect, openrb } = insert({ mode: 'openrb' });
        pcf.edit({ cutoff: 127, resonance: 0 });
        expect(openrb.sets.at(-1)?.cutoffHz).toBeCloseTo(20_000);
        expect(openrb.sets.at(-1)?.q).toBeCloseTo(0.5);

        // applyPcfFilterToEffect drives the effect directly, not the insert.
        effect.loadSettings({ ...effect.settings, cutoff: 0, filterType: 'hp' });
        expect(openrb.sets.at(-1)?.cutoffHz).toBeCloseTo(20);
        expect(pcf.status().held).toBe(PCF_OPENRB_LOWPASS_ONLY);
    });

    it('switches the mode live and reports the knobs and pattern', () => {
        const { pcf } = insert();
        const state = pcf.edit({ filterMode: 'openrb', pattern: [1, 2, 3], decay: 99 });
        expect(state.mode.active).toBe('openrb');
        expect(state.pattern).toEqual([1, 2, 3]);
        expect(state.knobs.decay).toBe(99);
        expect(state.live).toBe(true);
    });

    it('clears lane overrides when it stops following the master lanes', async () => {
        const { pcf } = insert();
        await pcf.effect.init();
        pcf.setFollowMasterLanes(true);
        const messages = posted.at(-1)!;
        messages.length = 0;
        pcf.setFollowMasterLanes(false);
        expect(messages).toEqual([
            { type: 'set-automation', data: { cutoffHz: -1 } },
            { type: 'set-automation', data: { resonanceMidi: null } },
            { type: 'set-automation', data: { envAmountNorm: null } },
        ]);
    });

    it('leaves the master effect to the engine lifecycle on dispose', () => {
        const { pcf, effect } = insert({ master: true });
        const dispose = vi.spyOn(effect, 'dispose');
        pcf.dispose();
        expect(dispose).not.toHaveBeenCalled();
        const placed = insert();
        const placedDispose = vi.spyOn(placed.effect, 'dispose');
        placed.pcf.dispose();
        expect(placedDispose).toHaveBeenCalled();
    });
});

describe('live registry', () => {
    it('fans master lanes out to the placed PCFs that follow them', () => {
        const provider = createPcfNodeProvider({ register: true });
        const context = fakeContext();
        const following = provider(context, { nodeId: 'a', config: { followMasterLanes: true } })!.pcf!;
        const own = provider(context, { nodeId: 'b', config: {} })!.pcf!;
        const followCut = vi.spyOn(following, 'setAutomationCutoff');
        const ownCut = vi.spyOn(own, 'setAutomationCutoff');
        const master = { setAutomationCutoff: vi.fn(), setAutomationResonance: vi.fn(), setAutomationEnvAmount: vi.fn() };

        const fanout = pcfLaneFanout(master);
        fanout.setAutomationCutoff(440);
        expect(master.setAutomationCutoff).toHaveBeenCalledWith(440);
        expect(followCut).toHaveBeenCalledWith(440);
        expect(ownCut).not.toHaveBeenCalled();

        // Read at call time: a node that starts following is picked up.
        own.setFollowMasterLanes(true);
        fanout.setAutomationCutoff(880);
        expect(ownCut).toHaveBeenCalledWith(880);
    });

    it('steps placed PCFs with the master transport, and late ones join in tempo', () => {
        const provider = createPcfNodeProvider({ register: true });
        const context = fakeContext();
        const early = provider(context, { nodeId: 'a', config: {} })!.pcf!;
        const earlyTransport = vi.spyOn(early, 'setTransport');
        const master = { setTransport: vi.fn() };
        broadcastPcfTransport(master, true, 128, 0);
        expect(master.setTransport).toHaveBeenCalledWith(true, 128, 0);
        expect(earlyTransport).toHaveBeenCalledWith(true, 128, 0);

        const lateEffect = new PcfEffect(context);
        const transport = vi.spyOn(lateEffect, 'setTransport');
        registerPcfInsert(new PcfInsert(context, lateEffect, { nodeId: 'late' }, null));
        expect(transport).toHaveBeenCalledWith(true, 128, 0);
    });

    it('does not send the transport to the master insert (its effect gets it directly)', () => {
        const context = fakeContext();
        const effect = new PcfEffect(context);
        createMasterPcfProvider(effect, { register: true })(context, { nodeId: 'masterPcf', config: {} });
        const transport = vi.spyOn(effect, 'setTransport');
        broadcastPcfTransport(null, true, 120);
        expect(transport).not.toHaveBeenCalled();
    });

    it('disposes every live insert on teardown', () => {
        const provider = createPcfNodeProvider({ register: true });
        provider(fakeContext(), { nodeId: 'a', config: {} });
        expect(livePcfInserts()).toHaveLength(1);
        disposeLivePcfInserts();
        expect(livePcfInserts()).toHaveLength(0);
    });
});

describe('providers', () => {
    it('builds a placed PCF from its config, with the initial state in processorOptions', async () => {
        let options: Record<string, unknown> | undefined;
        vi.stubGlobal(
            'AudioWorkletNode',
            class {
                port = { postMessage: vi.fn() };
                connect = vi.fn();
                disconnect = vi.fn();
                constructor(_c: unknown, _n: string, o: { processorOptions: Record<string, unknown> }) {
                    options = o.processorOptions;
                }
            },
        );
        const pending: Promise<void>[] = [];
        const openrb = fakeOpenrb();
        const provider = createPcfNodeProvider({
            openrb: openrb.provider,
            pending,
            init: () => ({ transport: { playing: true, bpm: 140 } }),
        });
        const ports = provider(fakeContext(), { nodeId: 'pcf-1', config: { cutoff: 127, filterMode: 'openrb' } })!;
        await Promise.all(pending);
        expect(ports.pcf!.effect.isInitialized).toBe(true);
        expect(options).toMatchObject({ enabled: true, transport: { playing: true, bpm: 140 } });
        expect((options?.params as { cutoff: number }).cutoff).toBe(127);
        expect(openrb.requests[0].frequency).toBeCloseTo(20_000);
        expect(ports.pcf!.status().active).toBe('openrb');
        // Not registered unless asked (offline renders).
        expect(livePcfInserts()).toHaveLength(0);
    });

    it('passes audio through when the worklet fails to load', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const context = {
            ...fakeContext(),
            audioWorklet: { addModule: () => Promise.reject(new Error('nope')) },
        } as unknown as BaseAudioContext;
        const pending: Promise<void>[] = [];
        const ports = createPcfNodeProvider({ pending })(context, { nodeId: 'p', config: {} });
        await Promise.all(pending);
        expect(ports?.pcf?.effect.isInitialized).toBe(false);
        expect(warn).toHaveBeenCalled();
    });

    it('returns null without an AudioWorklet, or without a master PCF', async () => {
        expect(createPcfNodeProvider()(fakeContext(false), { nodeId: 'p', config: {} })).toBeNull();
        expect(createMasterPcfProvider(null)(fakeContext(), { nodeId: 'masterPcf', config: {} })).toBeNull();
        await settle();
    });
});

describe('pcfFilterForSave', () => {
    const saved = {
        enabled: true,
        filterType: 'bp' as const,
        cutoff: 1,
        resonance: 2,
        envAmount: 3,
        decay: 4,
        pattern: [5],
        target: { tb303A: true, tb303B: false, drums: false },
    };

    it("keeps the song's own PCF unless the master was edited by hand", () => {
        const effect = new PcfEffect(fakeContext());
        expect(pcfFilterForSave(saved, effect)).toBe(saved);
        expect(pcfFilterForSave(undefined, effect)).toBeUndefined();
        expect(pcfFilterForSave(saved, null)).toBe(saved);
    });

    it('writes the hand-edited master, keeping the song target', () => {
        const effect = new PcfEffect(fakeContext());
        effect.setParams({ enabled: true, cutoff: 99 });
        effect.markEdited();
        expect(pcfFilterForSave(saved, effect)).toMatchObject({ enabled: true, cutoff: 99, target: saved.target });
        expect(pcfFilterForSave(undefined, effect)?.target).toEqual({ tb303A: true, tb303B: true, drums: true });

        // A song load clears the flag.
        effect.reset();
        expect(pcfFilterForSave(saved, effect)).toBe(saved);
    });
});
