import { memo, forwardRef, useRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo } from 'react';
import type { TrackKey, PartSequence } from '../../types';
import { SvgStep } from './SvgStep';
import { TrackSlotStrip } from './TrackSlotButton';
import { GridIndicators } from '../GridIndicators';

export interface SequencerRowHandle { setHighlight: (step: number) => void; }

interface SequencerRowProps {
    rowKey: TrackKey;
    label: string;
    rowIndex: number;
    steps: (any | null)[];
    isSelected: boolean;
    activeSlot: number;
    trackSlots: (PartSequence | PartSequence[] | null)[];
    onToggle: (k: TrackKey, i: number, e: any) => void;
    onRightMouseDown: (k: TrackKey, i: number, e: any) => void;
    onEditLength: (k: TrackKey, i: number, len: number) => void;
    onSelectRow: (k: TrackKey) => void;
    onSelectSlot: (k: TrackKey, slot: number) => void;
    onSelectionStart?: (k: TrackKey, i: number) => void;
    onSelectionEnter?: (k: TrackKey, i: number) => void;
    selectionRange?: { start: number, end: number } | null;
    onDrawEnter?: (k: TrackKey, i: number) => void;
    isDrawing?: boolean;
}

export const SequencerRow = memo(forwardRef<SequencerRowHandle, SequencerRowProps>((props, ref) => {
    const { rowKey, label, rowIndex, steps, isSelected, activeSlot, trackSlots, onToggle, onRightMouseDown, onEditLength, onSelectRow, onSelectSlot, onSelectionStart, onSelectionEnter, selectionRange, onDrawEnter, isDrawing } = props;
    const stepRefs = useRef<(SVGGElement | null)[]>([]);
    const lastStepRef = useRef(-1);
    const lastActiveIndexRef = useRef(-1);
    const stepsRef = useRef(steps);
    const rafRef = useRef<number | null>(null);

    useLayoutEffect(() => {
        stepsRef.current = steps;
    }, [steps]);

    const updateClasses = useCallback((step: number) => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
        }

        rafRef.current = requestAnimationFrame(() => {
            let newActiveIndex = -1;
            for (let i = step; i >= 0; i--) {
                if (stepRefs.current[i]) {
                    const length = stepsRef.current[i]?.length || 1;
                    if (i + length > step) { newActiveIndex = i; }
                    break;
                }
            }
            if (newActiveIndex !== lastActiveIndexRef.current) {
                if (lastActiveIndexRef.current !== -1) { stepRefs.current[lastActiveIndexRef.current]?.classList.remove('is-current'); }
                if (newActiveIndex !== -1) { stepRefs.current[newActiveIndex]?.classList.add('is-current'); }
                lastActiveIndexRef.current = newActiveIndex;
            }
        });
    }, []);

    useLayoutEffect(() => {
        return () => {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
            }
        };
    }, []);

    useImperativeHandle(ref, () => ({
        setHighlight: (step: number) => {
            if (step === -1) {
                if (lastActiveIndexRef.current !== -1) { stepRefs.current[lastActiveIndexRef.current]?.classList.remove('is-current'); lastActiveIndexRef.current = -1; }
                lastStepRef.current = -1;
                return;
            }
            lastStepRef.current = step;
            updateClasses(step);
        }
    }));

    useLayoutEffect(() => {
        const currentActive = lastActiveIndexRef.current;
        lastActiveIndexRef.current = -1;
        if (lastStepRef.current !== -1) { updateClasses(lastStepRef.current); } else { lastActiveIndexRef.current = currentActive; }
    }, [updateClasses]);

    const renderedSteps = useMemo(() => {
        const stepsArray = [];
        let skipCount = 0;
        for (let i = 0; i < 32; i++) {
            if (skipCount > 0) { skipCount--; continue; }
            const stepData = steps[i];
            const length = stepData?.length || 1;

            let isRangeSelected = false;
            if (selectionRange) {
                const low = Math.min(selectionRange.start, selectionRange.end);
                const high = Math.max(selectionRange.start, selectionRange.end);
                // Check if step is within range
                if (i >= low && i <= high) isRangeSelected = true;
            }

            stepsArray.push(<SvgStep key={i} stepIndex={i} active={!!stepData} note={stepData ? stepData.note : null} length={length} isSlide={!!stepData?.slide} refsArray={stepRefs} rowLabel={label} rowKey={rowKey} onToggle={onToggle} onRightMouseDown={onRightMouseDown} onEditLength={onEditLength} onSelectionStart={onSelectionStart} onSelectionEnter={onSelectionEnter} isRangeSelected={isRangeSelected} onDrawEnter={onDrawEnter} isDrawing={isDrawing} />);
            if (stepData && length > 1) { skipCount = length - 1; }
        }
        return stepsArray;
    }, [steps, label, rowKey, onToggle, onRightMouseDown, onEditLength, onSelectionStart, onSelectionEnter, selectionRange, onDrawEnter, isDrawing]);

    const handleRowClick = useCallback(() => onSelectRow(rowKey), [onSelectRow, rowKey]);
    const handleRowKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectRow(rowKey);
        }
    }, [onSelectRow, rowKey]);

    const renderedTrackSlots = useMemo(() => (
        <TrackSlotStrip activeSlot={activeSlot} trackSlots={trackSlots} trackKey={rowKey} onSelect={onSelectSlot} />
    ), [activeSlot, trackSlots, rowKey, onSelectSlot]);

    return (
        <g transform={`translate(0, ${rowIndex * 60})`}>
            <g className="track-label" onClick={handleRowClick} cursor="pointer" role="button" tabIndex={0} aria-label={`Select ${label} track`} aria-description="Left-click to select row. Right-click for options." aria-pressed={isSelected} onKeyDown={handleRowKeyDown}>
                {isSelected && <rect x={-10} y={8} width={4} height={36} fill="#3fa34d" rx={2} />}
                <text x={-20} y={30} textAnchor="end" fontFamily="Orbitron, monospace" fontSize={12} fill={isSelected ? '#3fa34d' : '#5a6b60'} fontWeight={isSelected ? 'bold' : 'normal'} style={{ textShadow: isSelected ? '0 0 8px rgba(63,163,77,0.5)' : 'none' }}>{label.toUpperCase()}</text>
            </g>
            <g transform="translate(30, 16)">
                {renderedTrackSlots}
            </g>
            <GridIndicators />
            {renderedSteps}
        </g>
    )
}), (prev: SequencerRowProps, next: SequencerRowProps) => {
    // Note: We need activeSamplerBank for sampler tracks, but it is not a direct prop of SequencerRow right now.
    // Given the props currently provided, we use the following comparison. If activeSamplerBank needs to trigger
    // a row re-render, it is either passed implicitly via 'steps' changing (since `pattern.sampler[activeBank].steps`
    // is passed in the parent), or the parent needs to be updated. Since the steps prop is derived from the active bank
    // in `Sequencer.tsx`, changing the bank gives us a completely new `steps` array reference, correctly busting the memo.
    return (
        prev.rowKey === next.rowKey &&
        prev.label === next.label &&
        prev.rowIndex === next.rowIndex &&
        prev.isSelected === next.isSelected &&
        prev.activeSlot === next.activeSlot &&
        // ⚡ Bolt: Relying on reference equality from useAppState immutable updates
        prev.steps === next.steps &&
        prev.trackSlots === next.trackSlots &&
        prev.selectionRange?.start === next.selectionRange?.start &&
        prev.selectionRange?.end === next.selectionRange?.end &&
        prev.isDrawing === next.isDrawing
    );
});
