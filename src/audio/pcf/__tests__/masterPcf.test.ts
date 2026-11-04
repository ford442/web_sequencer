import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    MASTER_PCF_DEGRADATION_ID,
    createMasterPcf,
    createPcfLaneWatcher,
    getMasterPcf,
    masterPcfPorts,
    setMasterPcf,
} from '../masterPcf';
import { PcfEffect } from '../../../engines/PcfEffect';
import { engineDegradationStore } from '../../../stores/engineDegradationStore';

function stubPcf() {
    return {
        setAutomationCutoff: vi.fn(),
        setAutomationResonance: vi.fn(),
        setAutomationEnvAmount: vi.fn(),
    };
}

const lane = (parameter: string, extra: Record<string, unknown> = {}) => ({ target: 'master', parameter, enabled: true, ...extra });

describe('createPcfLaneWatcher', () => {
    it('clears an override once its lane is gone', () => {
        const pcf = stubPcf();
        const watch = createPcfLaneWatcher(pcf);
        watch([lane('pcfCutoff'), lane('pcfResonance')]);
        expect(pcf.setAutomationCutoff).not.toHaveBeenCalled();

        watch([lane('pcfResonance')]);
        expect(pcf.setAutomationCutoff).toHaveBeenCalledWith(undefined);
        expect(pcf.setAutomationResonance).not.toHaveBeenCalled();

        watch([]);
        expect(pcf.setAutomationResonance).toHaveBeenCalledWith(null);
        expect(pcf.setAutomationCutoff).toHaveBeenCalledTimes(1);
    });

    it('treats a disabled lane, or automation playback off, as no lane', () => {
        const pcf = stubPcf();
        const watch = createPcfLaneWatcher(pcf);
        watch([lane('pcfEnvAmount')]);
        watch([lane('pcfEnvAmount', { enabled: false })]);
        expect(pcf.setAutomationEnvAmount).toHaveBeenCalledWith(null);

        watch([lane('pcfCutoff')]);
        watch([lane('pcfCutoff')], false);
        expect(pcf.setAutomationCutoff).toHaveBeenCalledWith(undefined);
    });

    it('treats a cutoff lane parked at 0 as no lane, and clears its override', () => {
        const pcf = stubPcf();
        const watch = createPcfLaneWatcher(pcf);
        const at = (...values: number[]) => values.map((value, step) => ({ step, value }));
        watch([lane('pcfCutoff', { points: at(0.2, 0.8) })]);
        expect(pcf.setAutomationCutoff).not.toHaveBeenCalled();
        // The song's lane gets parked at the bottom: it would be a 20 Hz low-pass of the mix.
        watch([lane('pcfCutoff', { points: at(0, 0, 0) })]);
        expect(pcf.setAutomationCutoff).toHaveBeenCalledWith(undefined);
        // A sweep that only touches 0 is automation.
        watch([lane('pcfCutoff', { points: at(0, 0.5) })]);
        watch([lane('pcfCutoff', { points: at(0, 0.5) })]);
        expect(pcf.setAutomationCutoff).toHaveBeenCalledTimes(1);
        // Only cutoff parks: resonance / env amount at 0 are ordinary values.
        watch([lane('pcfResonance', { points: at(0) }), lane('pcfEnvAmount', { points: at(0) })]);
        watch([lane('pcfResonance', { points: at(0) }), lane('pcfEnvAmount', { points: at(0) })]);
        expect(pcf.setAutomationResonance).not.toHaveBeenCalled();
        expect(pcf.setAutomationEnvAmount).not.toHaveBeenCalled();
    });

    it('ignores lanes on other targets', () => {
        const pcf = stubPcf();
        const watch = createPcfLaneWatcher(pcf);
        watch([{ target: 'synthA', parameter: 'pcfCutoff' }]);
        watch([]);
        expect(pcf.setAutomationCutoff).not.toHaveBeenCalled();
    });
});

describe('createMasterPcf', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        setMasterPcf(null);
    });

    function fakeContext(addModule: () => Promise<void>) {
        const gain = () => ({ connect: vi.fn(), disconnect: vi.fn() });
        return { audioWorklet: { addModule }, createGain: gain } as unknown as BaseAudioContext;
    }

    it('returns null when the context has no AudioWorklet', async () => {
        expect(await createMasterPcf({} as BaseAudioContext)).toBeNull();
    });

    it('returns null (and warns) when the worklet module fails to load', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(await createMasterPcf(fakeContext(() => Promise.reject(new Error('nope'))))).toBeNull();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
        error.mockRestore();
    });

    it('reports a worklet that fails to load to the degradation store, with the reason', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        engineDegradationStore.clear(MASTER_PCF_DEGRADATION_ID);
        try {
            await createMasterPcf(fakeContext(() => Promise.reject(new Error('addModule: 404'))));
            expect(engineDegradationStore.getIssue(MASTER_PCF_DEGRADATION_ID)).toMatchObject({
                subsystem: 'master-pcf',
                category: 'worklet',
                status: 'active',
                reason: 'addModule: 404',
                activeBackend: 'bypass',
            });
        } finally {
            engineDegradationStore.clear(MASTER_PCF_DEGRADATION_ID);
            vi.restoreAllMocks();
        }
    });

    it('reports nothing for a context without AudioWorklet (offline renders without one)', async () => {
        engineDegradationStore.clear(MASTER_PCF_DEGRADATION_ID);
        await createMasterPcf({} as BaseAudioContext);
        expect(engineDegradationStore.getIssue(MASTER_PCF_DEGRADATION_ID)).toBeUndefined();
    });

    it('builds a transparent PCF whose ports the graph wires in', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const posted: unknown[] = [];
        let processorOptions: Record<string, unknown> | undefined;
        vi.stubGlobal('AudioWorkletNode', class {
            port = { postMessage: (m: unknown) => posted.push(m) };
            connect = vi.fn();
            disconnect = vi.fn();
            constructor(_c: unknown, _n: string, o: { processorOptions: Record<string, unknown> }) {
                processorOptions = o.processorOptions;
            }
        });
        const pcf = await createMasterPcf(fakeContext(() => Promise.resolve()));
        expect(pcf).toBeInstanceOf(PcfEffect);
        expect(processorOptions?.enabled).toBe(false);
        expect(masterPcfPorts(pcf)).toEqual({ input: pcf!.input, output: pcf!.output });
        expect(masterPcfPorts(null)).toBeNull();

        setMasterPcf(pcf);
        expect(getMasterPcf()).toBe(pcf);

        posted.length = 0;
        pcf!.reset();
        expect(posted).toEqual([
            { type: 'set-enabled', data: false },
            { type: 'set-automation', data: { cutoffHz: null, resonanceMidi: null, envAmountNorm: null } },
        ]);
        log.mockRestore();
    });
});
