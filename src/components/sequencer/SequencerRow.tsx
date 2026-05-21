import { memo, forwardRef, useRef, useCallback, useImperativeHandle, useLayoutEffect } from 'react';
import type { TrackKey, PartSequence } from '../../types';
import { SvgStep } from './SvgStep';
import { TrackSlotButton } from './TrackSlotButton';
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

    const updateClasses = useCallback((step: number) => {
        let newActiveIndex = -1;
        for (let i = step; i >= 0; i--) {
            if (stepRefs.current[i]) {
                const length = steps[i]?.length || 1;
                if (i + length > step) { newActiveIndex = i; }
                break;
            }
        }
        if (newActiveIndex !== lastActiveIndexRef.current) {
            if (lastActiveIndexRef.current !== -1) { stepRefs.current[lastActiveIndexRef.current]?.classList.remove('is-current'); }
            if (newActiveIndex !== -1) { stepRefs.current[newActiveIndex]?.classList.add('is-current'); }
            lastActiveIndexRef.current = newActiveIndex;
        }
    }, [steps]);

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

    const renderedSteps = [];
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

        renderedSteps.push(<SvgStep key={i} stepIndex={i} active={!!stepData} note={stepData ? stepData.note : null} length={length} isSlide={!!stepData?.slide} refsArray={stepRefs} rowLabel={label} rowKey={rowKey} onToggle={onToggle} onRightMouseDown={onRightMouseDown} onEditLength={onEditLength} onSelectionStart={onSelectionStart} onSelectionEnter={onSelectionEnter} isRangeSelected={isRangeSelected} onDrawEnter={onDrawEnter} isDrawing={isDrawing} />);
        if (stepData && length > 1) { skipCount = length - 1; }
    }

    const handleRowClick = useCallback(() => onSelectRow(rowKey), [onSelectRow, rowKey]);
    const handleRowKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectRow(rowKey);
        }
    }, [onSelectRow, rowKey]);

    return (
        <g transform={`translate(0, ${rowIndex * 60})`}>
            <g className="track-label" onClick={handleRowClick} cursor="pointer" role="button" tabIndex={0} aria-label={`Select ${label} track`} aria-pressed={isSelected} onKeyDown={handleRowKeyDown}>
                {isSelected && <rect x={-10} y={8} width={4} height={36} fill="#3fa34d" rx={2} />}
                <text x={-20} y={30} textAnchor="end" fontFamily="Orbitron, monospace" fontSize={12} fill={isSelected ? '#3fa34d' : '#5a6b60'} fontWeight={isSelected ? 'bold' : 'normal'} style={{ textShadow: isSelected ? '0 0 8px rgba(63,163,77,0.5)' : 'none' }}>{label.toUpperCase()}</text>
            </g>
            <g transform="translate(30, 16)">
                {[0, 1, 2, 3, 4, 5, 6, 7].map(slot => (<TrackSlotButton key={slot} index={slot} isActive={activeSlot === slot} hasData={!!trackSlots[slot]} trackKey={rowKey} onSelect={onSelectSlot} />))}
            </g>
            <GridIndicators />
            {renderedSteps}
        </g>
    )
}));
