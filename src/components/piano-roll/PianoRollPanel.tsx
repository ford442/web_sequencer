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

const KEYS = [
    'pattern', 'currentScale', 'clipboard', 'setClipboard',
    'handleReplaceTrackSteps', 'handlePasteTrackSteps',
] as const;

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
    const label = target.track === 'sampler' ? `SMP ${target.bank + 1}` : TRACK_LABELS[target.track];

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
            loopLength={trackLoopLength(meter, target.track)}
            stepsPerBeat={meterStepsPerBeat(timeSignature)}
            stepsPerBar={meterStepsPerBar(timeSignature) ?? 16}
            scale={s.currentScale}
            clipboard={s.clipboard}
            onCommit={onCommit}
            onCopy={onCopy}
            onPaste={onPaste}
            onSelectTarget={onSelectTarget}
            onClose={onClose}
        />
    );
});

export default PianoRollPanel;
