/**
 * Lazy chunk entry for the piano roll (#1345 Phase 1): connects the
 * props-driven `PianoRollView` to app state. The roll has no store of its
 * own — it reads the open track's `PartSequence.steps` and writes back through
 * `handleReplaceTrackSteps` / `handlePasteTrackSteps`, the same undo history
 * and track storage every grid edit uses.
 */
import { memo, useCallback, useMemo } from 'react';
import type { Note } from '@/types';
import { useAppStateSlice } from '@/contexts/AppStateContext';
import { pianoRollStore, PIANO_ROLL_TRACKS, type PianoRollTarget } from '@/stores/pianoRollStore';
import { useTransportMixStore } from '@/stores/transportMixStore';
import { gridColumns, trackLoopLength } from '@/utils/songMeter';
import { stepsPerBar as meterStepsPerBar, stepsPerBeat as meterStepsPerBeat } from '@/utils/musicTheory';
import { ROWS, TRACK_COLORS } from '../sequencer/constants';
import { PianoRollView, type GhostSource } from './PianoRollView';
import type { Steps } from './model/rollModel';
import { a11yAnnouncerStore } from '@/stores/a11yAnnouncerStore';
import { noteFxStore, useNoteFxChain } from '@/stores/noteFxStore';
import { renderNoteFx } from '@/sequencer/noteFx/chain';
import { freezeNoteFx } from '@/sequencer/noteFx/freeze';
import { noteFxLaneLookup } from '@/sequencer/noteFx/runtime';
import { NOTE_FX_AUTOMATION_PARAMS, noteFxAutomationTarget } from '@/sequencer/noteFx/params';
import { automationStore, generateLaneId } from '@/stores/automationStore';
import { chainIsActive, type NoteFxChain, type NoteFxModuleId } from '@/sequencer/noteFx/types';

const KEYS = [
    'pattern', 'currentScale', 'clipboard', 'setClipboard',
    'handleReplaceTrackSteps', 'handleReplaceManyTrackSteps', 'handlePasteTrackSteps',
] as const;

const NO_FX: readonly { start: number; length: number; pitch: number }[] = [];

const TRACK_LABELS: Record<PianoRollTarget['track'], string> = {
    partA: ROWS.find((r) => r.key === 'partA')!.label,
    partB: ROWS.find((r) => r.key === 'partB')!.label,
    bass2: ROWS.find((r) => r.key === 'bass2')!.label,
    sampler: 'SMP',
};

const EMPTY: Steps = [];

export interface PianoRollPanelProps {
    target: PianoRollTarget;
}

const PianoRollPanel = memo(({ target }: PianoRollPanelProps) => {
    const s = useAppStateSlice(KEYS);
    const stepCount = useTransportMixStore((m) => m.stepCount);
    const trackLengths = useTransportMixStore((m) => m.trackLengths);
    const timeSignature = useTransportMixStore((m) => m.timeSignature);

    const { pattern } = s;
    const steps: Steps = target.track === 'sampler'
        ? pattern.sampler[target.bank]?.steps ?? EMPTY
        : pattern[target.track].steps;

    const ghostSources = useMemo<GhostSource[]>(() => {
        const out: GhostSource[] = [];
        for (const track of PIANO_ROLL_TRACKS) {
            if (track === 'sampler') {
                pattern.sampler.forEach((bank, i) => {
                    if (!(target.track === 'sampler' && target.bank === i)) out.push({ key: `sampler:${i}`, steps: bank.steps });
                });
            } else if (track !== target.track) {
                out.push({ key: track, steps: pattern[track].steps });
            }
        }
        return out;
    }, [pattern, target.track, target.bank]);

    const meter = { stepCount, trackLengths };
    const columns = gridColumns(meter);
    const loopLength = trackLoopLength(meter, target.track);
    const label = target.track === 'sampler' ? `SMP ${target.bank + 1}` : TRACK_LABELS[target.track];

    // Note FX: the chain's first pass over these steps, drawn over the notes.
    const fxChain = useNoteFxChain(target.track);
    const salt = target.track === 'sampler' ? target.bank : 0;
    const fxPreview = useMemo(
        () => (chainIsActive(fxChain)
            ? renderNoteFx(steps, fxChain, { loopLength, iteration: 0, salt, lookup: noteFxLaneLookup(target.track) })
            : NO_FX),
        [steps, fxChain, loopLength, salt, target.track],
    );
    const onFxChange = useCallback(
        <M extends NoteFxModuleId>(module: M, patch: Partial<NoteFxChain[M]>) => noteFxStore.updateModule(target.track, module, patch),
        [target.track],
    );
    const { handleReplaceManyTrackSteps } = s;
    const onFreezeFx = useCallback(() => {
        const chain = noteFxStore.getActiveChain(target.track);
        if (!chain) return;
        const lookup = noteFxLaneLookup(target.track);
        // The sampler chain plays on every bank, so freezing writes them all.
        const sources = target.track === 'sampler'
            ? pattern.sampler.map((bank, bankIndex) => ({ bankIndex, steps: bank.steps }))
            : [{ bankIndex: 0, steps: pattern[target.track].steps }];
        let notes = 0;
        let dropped = 0;
        const edits = sources
            .filter((src) => src.steps.some(Boolean))
            .map((src) => {
                const frozen = freezeNoteFx(src.steps, chain, { loopLength, salt: target.track === 'sampler' ? src.bankIndex : 0, lookup });
                notes += frozen.notes;
                dropped += frozen.dropped;
                return { trackKey: target.track, bankIndex: src.bankIndex, steps: frozen.steps };
            });
        handleReplaceManyTrackSteps(edits);
        noteFxStore.bypass(target.track);
        a11yAnnouncerStore.announce(
            `Froze ${notes} note FX ${notes === 1 ? 'note' : 'notes'} into the pattern` +
            (dropped > 0 ? `; ${dropped} did not fit one note per step` : '') +
            '. Note FX bypassed; undo restores the steps.',
        );
    }, [pattern, target.track, loopLength, handleReplaceManyTrackSteps]);

    // A lane for a chain parameter on the track's own automation target; it
    // starts flat at the current value and is edited in AUTO VIEW like any lane.
    const onAutomateFx = useCallback((parameterId: string) => {
        const param = NOTE_FX_AUTOMATION_PARAMS.find((p) => p.id === parameterId);
        if (!param) return;
        const laneTarget = noteFxAutomationTarget(target.track);
        const exists = automationStore.getState().lanes.some((l) => l.target === laneTarget && l.parameter === parameterId);
        if (exists) {
            a11yAnnouncerStore.announce(`${param.label} is already automated on ${label}`);
            return;
        }
        automationStore.addLane({
            id: generateLaneId(),
            target: laneTarget,
            parameter: parameterId,
            name: `${label} · ${param.label}`,
            points: [{ step: 0, value: param.read(noteFxStore.getChain(target.track)) }],
            interpolation: 'step',
            source: 'manual',
            scope: 'pattern',
            enabled: true,
        });
        a11yAnnouncerStore.announce(`Automation lane added: ${param.label} on ${label}. Edit it in Auto View.`);
    }, [target.track, label]);

    const { handleReplaceTrackSteps, handlePasteTrackSteps, setClipboard } = s;
    const onCommit = useCallback(
        (next: Steps) => handleReplaceTrackSteps(target.track, target.bank, next as (Note | null)[]),
        [handleReplaceTrackSteps, target.track, target.bank],
    );
    const onPaste = useCallback(
        (clip: (Note | null)[], targetStep: number) => handlePasteTrackSteps(target.track, target.bank, clip, targetStep),
        [handlePasteTrackSteps, target.track, target.bank],
    );
    const onCopy = useCallback((clip: (Note | null)[]) => setClipboard(clip), [setClipboard]);
    const onSelectTarget = useCallback((next: PianoRollTarget) => pianoRollStore.open(next.track, next.bank), []);
    const onClose = useCallback(() => pianoRollStore.close(), []);

    return (
        <PianoRollView
            target={target}
            trackLabel={label}
            trackLabels={TRACK_LABELS}
            color={TRACK_COLORS[target.track] ?? '#06b6d4'}
            steps={steps}
            ghostSources={ghostSources}
            columns={columns}
            loopLength={loopLength}
            stepsPerBeat={meterStepsPerBeat(timeSignature)}
            stepsPerBar={meterStepsPerBar(timeSignature) ?? 16}
            scale={s.currentScale}
            clipboard={s.clipboard}
            onCommit={onCommit}
            onCopy={onCopy}
            onPaste={onPaste}
            onSelectTarget={onSelectTarget}
            onClose={onClose}
            fxChain={fxChain}
            fxPreview={fxPreview}
            onFxChange={onFxChange}
            onFreezeFx={onFreezeFx}
            onAutomateFx={onAutomateFx}
        />
    );
});

export default PianoRollPanel;
