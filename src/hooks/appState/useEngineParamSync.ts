import { useEffect, useRef, type MutableRefObject } from 'react'
import type { AudioEngine, Bass2Params, SynthParams } from '../../types'
import { AutomationScheduler } from '../../audio/automation/AutomationScheduler'
import { getWamHost } from '../../audio/wam'
import type { PcfEffect } from '../../engines/PcfEffect'
import { resolveRealtimeTB303Model } from '../../engines/TB303Models'
import { Open303Manager } from '../../engines/Open303Manager'
import { macroEngineForWaveform } from '../../engines/MacroParams'
import type { useAudioEngine } from '../useAudioEngine'

type Engine = ReturnType<typeof useAudioEngine>

/**
 * Patch changes the engines hear outside the step clock: macro parts, the
 * 303 model and its extras, and the automation scheduler's targets. Moved
 * out of `useAppState()` unchanged (#1597 P2 split).
 */
export function useEngineParamSync(deps: {
    audioEngine: AudioEngine | null;
    isReady: boolean;
    synthA: SynthParams;
    synthB: SynthParams;
    bass2: Bass2Params;
    macroManagerRef: Engine['macroManagerRef'];
    prophecyManagerRef: Engine['prophecyManagerRef'];
}): MutableRefObject<AutomationScheduler | null> {
    const { audioEngine, isReady, synthA, synthB, bass2, macroManagerRef, prophecyManagerRef } = deps;

    // A macro part hears its panel at once: knob moves and model switches are
    // pushed now (changed values only), overriding whatever the next notes
    // already queued. Notes still apply their own patch on their frame.
    useEffect(() => {
        const engine = macroEngineForWaveform(synthA.waveform);
        const mgr = macroManagerRef?.current;
        if (engine && mgr?.canPlay('partA', engine)) mgr.applyParamsNow('partA', synthA, engine);
    }, [synthA, macroManagerRef, isReady]);
    useEffect(() => {
        const engine = macroEngineForWaveform(synthB.waveform);
        const mgr = macroManagerRef?.current;
        if (engine && mgr?.canPlay('partB', engine)) mgr.applyParamsNow('partB', synthB, engine);
    }, [synthB, macroManagerRef, isReady]);

    const automationSchedulerRef = useRef<AutomationScheduler | null>(null);
    useEffect(() => {
        const ctx = audioEngine?.context;
        const open303Engine = audioEngine?.open303Engine;
        const mgr = open303Engine instanceof Open303Manager ? open303Engine : null;
        const pcf: PcfEffect | null = audioEngine?.pcfEffect ?? null;
        if (ctx) {
            if (!automationSchedulerRef.current) {
                automationSchedulerRef.current = new AutomationScheduler(ctx, mgr ?? null, { ppq: 192 });
            } else {
                automationSchedulerRef.current.setOpen303Manager(mgr ?? null);
            }
            automationSchedulerRef.current.setPcfEffect(pcf);
            if (prophecyManagerRef) {
                automationSchedulerRef.current.setProphecyManager(prophecyManagerRef.current ?? null);
            }
            automationSchedulerRef.current.setMacroManager(macroManagerRef?.current ?? null);
            automationSchedulerRef.current.setWamHost(getWamHost());
        }
    }, [audioEngine, prophecyManagerRef, macroManagerRef]);

    useEffect(() => {
        const mgr = audioEngine?.open303Engine;
        if (!(mgr instanceof Open303Manager)) return;
        // normalize + realtime resolve: persist high-fid ids in song state, but
        // AudioWorklet always gets a realtime-safe voice (stock for offline-only).
        if (typeof mgr.syncModel303Settings === 'function') {
            mgr.syncModel303Settings({
                lead: resolveRealtimeTB303Model(synthA.model303, synthA.engine303, {
                    reportFallback: true,
                    subsystem: 'synthA-model303',
                }),
                bass1: resolveRealtimeTB303Model(synthB.model303, synthB.engine303, {
                    reportFallback: true,
                    subsystem: 'synthB-model303',
                }),
                bass2: resolveRealtimeTB303Model(bass2.model303, bass2.engine303, {
                    reportFallback: true,
                    subsystem: 'bass2-model303',
                }),
            });
        } else if (typeof mgr.syncEngine303Settings === 'function') {
            mgr.syncEngine303Settings({
                lead: synthA.engine303 ?? 'open303',
                bass1: synthB.engine303 ?? 'open303',
                bass2: bass2.engine303 ?? 'open303',
            });
        }
    }, [audioEngine, synthA.engine303, synthB.engine303, bass2.engine303, synthA.model303, synthB.model303, bass2.model303]);

    // Live high-fid A/B + diode-ladder coefficients (L2/L3). Runs after the
    // model sync above so A/B engages against the voice that was just set.
    useEffect(() => {
        const mgr = audioEngine?.open303Engine;
        if (!(mgr instanceof Open303Manager) || typeof mgr.syncModel303Extras !== 'function') return;
        mgr.syncModel303Extras({
            lead: synthA.model303Extra,
            bass1: synthB.model303Extra,
            bass2: bass2.model303Extra,
        });
    }, [audioEngine, synthA.model303Extra, synthB.model303Extra, bass2.model303Extra, synthA.model303, synthB.model303, bass2.model303]);

    return automationSchedulerRef;
}
