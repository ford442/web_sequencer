import { memo, useCallback } from 'react';
import type { Note, PartSequence, TrackKey } from '../../types';
import type { AlignmentResult } from '../../engines/rubberband/PhonemeAligner';
import type { SequencerCellCoord } from '../../utils/sequencerGridKeyboard';
import { SequencerRow, type SequencerRowHandle } from './SequencerRow';

interface SequencerRowWrapperProps {
    row: { key: TrackKey; label: string };
    rIdx: number;
    rowRefs: React.MutableRefObject<(SequencerRowHandle | null)[]>;
    steps: (Note | null)[];
    automation?: { [param: string]: (number | null)[] };
    isSelected: boolean;
    activeSlot: number;
    trackSlots: (PartSequence | PartSequence[] | null)[];
    handleStepPointerDown: (k: TrackKey, i: number, e: React.PointerEvent | React.KeyboardEvent) => void;
    onRightMouseDown: (k: TrackKey, i: number, e: React.MouseEvent) => void;
    onEditLength: (k: TrackKey, i: number, len: number) => void;
    onSelectRow: (k: TrackKey) => void;
    onSelectSlot: (k: TrackKey, slot: number) => void;
    onSelectionStart?: (k: TrackKey, i: number) => void;
    onSelectionEnter?: (k: TrackKey, i: number) => void;
    selectionRange?: { start: number, end: number } | null;
    viewMode?: 'notes' | 'automation';
    automationParam?: string;
    onAutomationChange?: (k: TrackKey, i: number, val: number) => void;
    alignment?: AlignmentResult | null;
    activeSamplerBank: number;
    focusedCell?: SequencerCellCoord | null;
    onStepRef?: (rowKey: TrackKey, step: number, el: SVGGElement | null) => void;
    onStepGridKeyDown?: (rowKey: TrackKey, step: number, e: React.KeyboardEvent) => void;
}

export const SequencerRowWrapper = memo(({
    row, rIdx, rowRefs, steps, automation, isSelected, activeSlot,
    trackSlots, handleStepPointerDown, onRightMouseDown, onEditLength, onSelectRow,
    onSelectSlot, onSelectionStart, onSelectionEnter, selectionRange,
    viewMode, automationParam, onAutomationChange, alignment, activeSamplerBank,
    focusedCell, onStepRef, onStepGridKeyDown,
}: SequencerRowWrapperProps) => {
    // We isolate the ref callback here so it doesn't cause constant re-renders during parent renders
    const setRef = useCallback((el: SequencerRowHandle | null) => {
        if (rowRefs?.current) rowRefs.current[rIdx] = el;
    }, [rowRefs, rIdx]);

    return (
        <SequencerRow
            ref={setRef}
            rowKey={row.key}
            label={row.key === 'sampler' ? `SMP ${activeSamplerBank + 1}` : row.label}
            rowIndex={rIdx}
            steps={steps}
            // Pass Automation Data
            automation={automation}
            isSelected={isSelected}
            activeSlot={activeSlot}
            trackSlots={trackSlots}
            onToggle={handleStepPointerDown}
            onRightMouseDown={onRightMouseDown}
            onEditLength={onEditLength}
            onSelectRow={onSelectRow}
            onSelectSlot={onSelectSlot}
            onSelectionStart={onSelectionStart}
            onSelectionEnter={onSelectionEnter}
            selectionRange={selectionRange}
            viewMode={viewMode}
            automationParam={automationParam}
            onAutomationChange={onAutomationChange}
            alignment={row.key === 'sampler' ? alignment : null}
            focusedCell={focusedCell}
            onStepRef={onStepRef}
            onStepGridKeyDown={onStepGridKeyDown}
        />
    );
}, (prev: SequencerRowWrapperProps, next: SequencerRowWrapperProps) => {
    return (
        prev.row.key === next.row.key &&
        prev.row.label === next.row.label &&
        prev.rIdx === next.rIdx &&
        prev.isSelected === next.isSelected &&
        prev.activeSlot === next.activeSlot &&
        prev.viewMode === next.viewMode &&
        prev.automationParam === next.automationParam &&
        prev.selectionRange?.start === next.selectionRange?.start &&
        prev.selectionRange?.end === next.selectionRange?.end &&
        // ⚡ Bolt: Relying on reference equality since useAppState performs immutable updates via shallow cloning.
        prev.steps === next.steps &&
        prev.automation === next.automation &&
        prev.trackSlots === next.trackSlots &&
        prev.alignment === next.alignment &&
        prev.activeSamplerBank === next.activeSamplerBank &&
        // ⚡ Bolt: Ensure callback props are checked to avoid stale closures inside the row.
        prev.handleStepPointerDown === next.handleStepPointerDown &&
        prev.onRightMouseDown === next.onRightMouseDown &&
        prev.onEditLength === next.onEditLength &&
        prev.onSelectRow === next.onSelectRow &&
        prev.onSelectSlot === next.onSelectSlot &&
        prev.onSelectionStart === next.onSelectionStart &&
        prev.onSelectionEnter === next.onSelectionEnter &&
        prev.onAutomationChange === next.onAutomationChange &&
        prev.focusedCell?.rowKey === next.focusedCell?.rowKey &&
        prev.focusedCell?.step === next.focusedCell?.step &&
        prev.onStepRef === next.onStepRef &&
        prev.onStepGridKeyDown === next.onStepGridKeyDown
    );
});
