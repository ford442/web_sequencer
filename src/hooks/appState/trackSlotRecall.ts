import type { AudioEngine } from '../../types'
import type { TrackKey } from '../../constants/appDefaults'
import { Open303Manager } from '../../engines/Open303Manager'
import { applyTrackParamSlotToEngine, type TrackParamStorage } from '../../importers/rbs/applyImportedEngineState'
import { instrumentStore } from '../../stores/instrumentStore'

/**
 * Switching a 303 track to another pattern slot recalls that slot's knobs
 * (an imported .rbs song's per-slot patches): into the voice, and into the
 * patch the panel shows. Part of the slot click's undo step.
 */
export function recallTrackParamSlot(
    track: TrackKey,
    slotIndex: number,
    audioEngine: AudioEngine | null,
    storage: TrackParamStorage | undefined,
): void {
    if (track !== 'partA' && track !== 'partB' && track !== 'bass2') return;
    if (!storage) return;
    const open303 = audioEngine?.open303Engine instanceof Open303Manager ? audioEngine.open303Engine : null;
    const { refs } = instrumentStore;
    const applied = applyTrackParamSlotToEngine(storage, track, slotIndex, open303, {
        synthA: refs.synthA.current,
        synthB: refs.synthB.current,
        bass2: refs.bass2.current,
    });
    instrumentStore.setMany({ synthA: applied.synthA, synthB: applied.synthB, bass2: applied.bass2 });
}
