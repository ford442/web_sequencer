import { memo, forwardRef, useRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo } from 'react';
import { noteToMidi } from '../../utils/musicTheory';
import type { Note, PartSequence, TrackKey } from '../../types';
import type { AlignmentResult } from '../../engines/rubberband/PhonemeAligner';
import type { SequencerCellCoord } from '../../utils/sequencerGridKeyboard';
import { AutomationStep } from './AutomationStep';
import { SvgStep } from './SvgStep';
import { TrackSlotStrip } from './TrackSlotButton';
import { GridIndicators } from '../GridIndicators';

export interface SequencerRowHandle { setHighlight: (step: number) => void; }

interface SequencerRowProps {
    rowKey: TrackKey, label: string, rowIndex: number, steps: (Note | null)[], isSelected: boolean, activeSlot: number,
    trackSlots: (PartSequence | PartSequence[] | null)[], onToggle: (k: TrackKey, i: number, e: React.PointerEvent | React.KeyboardEvent) => void,
    onRightMouseDown: (k: TrackKey, i: number, e: React.MouseEvent) => void, onEditLength: (k: TrackKey, i: number, len: number) => void,
    onSelectRow: (k: TrackKey) => void, onSelectSlot: (k: TrackKey, slot: number) => void,
    onSelectionStart?: (k: TrackKey, i: number) => void,
    onSelectionEnter?: (k: TrackKey, i: number) => void,
    selectionRange?: { start: number, end: number } | null,
    // Automation Props
    automation?: { [param: string]: (number | null)[] },
    viewMode?: 'notes' | 'automation',
    automationParam?: string,
    onAutomationChange?: (k: TrackKey, i: number, val: number) => void,
    alignment?: AlignmentResult | null,
    focusedCell?: SequencerCellCoord | null,
    onStepRef?: (rowKey: TrackKey, step: number, el: SVGGElement | null) => void,
    onStepGridKeyDown?: (rowKey: TrackKey, step: number, e: React.KeyboardEvent) => void,
}

export const SequencerRow = memo(forwardRef<SequencerRowHandle, SequencerRowProps>((props, ref) => {
    const { rowKey, label, rowIndex, steps, isSelected, activeSlot, trackSlots, onToggle, onRightMouseDown, onEditLength, onSelectRow, onSelectSlot, onSelectionStart, onSelectionEnter, selectionRange,
        automation, viewMode, automationParam, onAutomationChange, alignment,
        focusedCell, onStepRef, onStepGridKeyDown } = props;
    const stepRefs = useRef<(SVGGElement | null)[]>([]);
    const lastStepRef = useRef(-1);
    const lastActiveIndexRef = useRef(-1);
    const stepsRef = useRef(steps);
    const viewModeRef = useRef(viewMode);
    const rafRef = useRef<number | null>(null);

    useLayoutEffect(() => {
        stepsRef.current = steps;
        viewModeRef.current = viewMode;
    }, [steps, viewMode]);

    const updateClasses = useCallback((step: number) => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
        }

        rafRef.current = requestAnimationFrame(() => {
            let newActiveIndex = -1;
            // Logic differs for automation (always step 1) vs notes (can be longer)
            if (viewModeRef.current === 'automation') {
                 newActiveIndex = step;
            } else {
                for (let i = step; i >= 0; i--) {
                    if (stepRefs.current[i]) {
                        const length = stepsRef.current[i]?.length || 1;
                        if (i + length > step) { newActiveIndex = i; }
                        break;
                    }
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

    const stepGridProps = useCallback((i: number) => ({
        stepTabIndex: focusedCell?.rowKey === rowKey && focusedCell.step === i ? 0 : -1,
        onStepRef: (el: SVGGElement | null) => onStepRef?.(rowKey, i, el),
        onGridKeyDown: (e: React.KeyboardEvent) => onStepGridKeyDown?.(rowKey, i, e),
    }), [focusedCell, rowKey, onStepRef, onStepGridKeyDown]);

    const renderedSteps = useMemo(() => {
        const stepsArray = [];
        if (viewMode === 'automation' && isSelected && onAutomationChange && automationParam) {
             const values = automation?.[automationParam] || Array(32).fill(null);
             for (let i = 0; i < 32; i++) {
                 const val = values[i] ?? 0.5;
                 stepsArray.push(
                    <AutomationStep
                        key={i} stepIndex={i} value={val} rowKey={rowKey} rowLabel={label}
                        onChange={onAutomationChange} refsArray={stepRefs}
                    />
                 );
             }
        } else if (viewMode === 'automation' && !isSelected) {
            let skipCount = 0;
            for (let i = 0; i < 32; i++) {
                if (skipCount > 0) { skipCount--; continue; }
                const stepData = steps[i];
                const length = stepData?.length || 1;
                stepsArray.push(<SvgStep key={i} stepIndex={i} active={!!stepData} note={stepData ? stepData.note : null} length={length} isSlide={!!stepData?.slide} refsArray={stepRefs} rowLabel={label} rowKey={rowKey} onToggle={onToggle} onRightMouseDown={onRightMouseDown} onEditLength={onEditLength} onSelectionStart={onSelectionStart} onSelectionEnter={onSelectionEnter} isRangeSelected={false} reverse={stepData?.reverse} {...stepGridProps(i)} />);
                if (stepData && length > 1) { skipCount = length - 1; }
            }
        } else {
            let skipCount = 0;
            for (let i = 0; i < 32; i++) {
                if (skipCount > 0) { skipCount--; continue; }
                const stepData = steps[i];
                const length = stepData?.length || 1;
                let isRangeSelected = false;
                if (selectionRange) {
                    const low = Math.min(selectionRange.start, selectionRange.end);
                    const high = Math.max(selectionRange.start, selectionRange.end);
                    if (i >= low && i <= high) isRangeSelected = true;
                }
                let phonemeLabel: string | undefined = undefined;
                if (stepData && rowKey === 'sampler' && alignment) {
                    let sliceIdx = -1;
                    if (stepData.sliceIndex !== undefined) {
                        sliceIdx = stepData.sliceIndex;
                    } else if (stepData.note) {
                        sliceIdx = noteToMidi(stepData.note) - 60;
                    }
                    if (sliceIdx >= 0 && alignment.phonemes[sliceIdx]) {
                        phonemeLabel = alignment.phonemes[sliceIdx].phoneme;
                    }
                }
                stepsArray.push(<SvgStep key={i} stepIndex={i} active={!!stepData} note={stepData ? stepData.note : null} length={length} isSlide={!!stepData?.slide} refsArray={stepRefs} rowLabel={label} rowKey={rowKey} onToggle={onToggle} onRightMouseDown={onRightMouseDown} onEditLength={onEditLength} onSelectionStart={onSelectionStart} onSelectionEnter={onSelectionEnter} isRangeSelected={isRangeSelected} phonemeLabel={phonemeLabel} retrigger={stepData?.retrigger} reverse={stepData?.reverse} {...stepGridProps(i)} />);
                if (stepData && length > 1) { skipCount = length - 1; }
            }
        }
        return stepsArray;
    }, [viewMode, isSelected, onAutomationChange, automationParam, automation, steps, label, rowKey, onToggle, onRightMouseDown, onEditLength, onSelectionStart, onSelectionEnter, selectionRange, alignment, stepGridProps]);


    const handleRowClick = useCallback(() => onSelectRow(rowKey), [onSelectRow, rowKey]);
    const handleRowKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectRow(rowKey);
        }
    }, [onSelectRow, rowKey]);

    const renderedTrackSlots = useMemo(() => (
        <TrackSlotStrip activeSlot={activeSlot} trackSlots={trackSlots} trackKey={rowKey} onSelect={onSelectSlot} isRowSelected={isSelected} />
    ), [activeSlot, trackSlots, rowKey, onSelectSlot, isSelected]);

    return (
        <g role="row" transform={`translate(0, ${rowIndex * 60})`}>
            <g className="track-label" onClick={handleRowClick} cursor="pointer" role="rowheader" tabIndex={0} aria-label={`Select ${label} track, ${isSelected ? "Selected" : "Unselected"}`} aria-description="Left-click to select row. Right-click for options." aria-pressed={isSelected} onKeyDown={handleRowKeyDown}>
                {isSelected && (
                    <rect
                        x={-10}
                        y={8}
                        width={4}
                        height={36}
                        fill={rowKey === 'bass2' ? '#ff0066' : '#3fa34d'}
                        rx={2}
                        style={rowKey === 'bass2' ? { filter: 'drop-shadow(0 0 6px rgba(255,0,102,0.8))' } : undefined}
                    />
                )}
                {/* TB-303 style accent for bass2 when selected */}
                {rowKey === 'bass2' && isSelected && (
                    <rect x={-15} y={6} width={2} height={40} fill="#ff0066" opacity={0.3} rx={1} />
                )}
                <text
                    x={-20}
                    y={30}
                    textAnchor="end"
                    fontFamily="Orbitron, monospace"
                    fontSize={12}
                    fill={rowKey === 'bass2' ? (isSelected ? '#ff0066' : '#9ca3af') : (isSelected ? '#3fa34d' : '#5a6b60')}
                    fontWeight={isSelected ? 'bold' : 'normal'}
                    style={{
                        textShadow: isSelected
                            ? (rowKey === 'bass2' ? '0 0 10px rgba(255,0,102,0.7)' : '0 0 8px rgba(63,163,77,0.5)')
                            : 'none',
                        letterSpacing: rowKey === 'bass2' ? '0.05em' : 'normal'
                    }}
                >
                    {label.toUpperCase()}
                </text>
                {/* TB-303 silver/chrome hint line */}
                {rowKey === 'bass2' && (
                    <line x1={-65} y1={36} x2={-20} y2={36} stroke={isSelected ? '#ff0066' : '#4b5563'} strokeWidth={1} opacity={isSelected ? 0.5 : 0.3} />
                )}
            </g>
            <g transform="translate(30, 16)">
                {renderedTrackSlots}
            </g>
            <g style={{ transform: 'scaleX(var(--zoom-level))', transformOrigin: 'left' }} transform="translate(220, 0)">
                <GridIndicators />
                {renderedSteps}
            </g>
        </g>
    )
}), (prev: SequencerRowProps, next: SequencerRowProps) => {
    return (
        prev.rowKey === next.rowKey &&
        prev.label === next.label &&
        prev.rowIndex === next.rowIndex &&
        prev.isSelected === next.isSelected &&
        prev.activeSlot === next.activeSlot &&
        prev.viewMode === next.viewMode &&
        prev.automationParam === next.automationParam &&
        prev.selectionRange?.start === next.selectionRange?.start &&
        prev.selectionRange?.end === next.selectionRange?.end &&
        // ⚡ Bolt: Relying on reference equality since useAppState performs immutable updates via shallow cloning.
        // This avoids deep arraysEqual checks on 256 items per row per render.
        prev.steps === next.steps &&
        prev.automation === next.automation &&
        prev.trackSlots === next.trackSlots &&
        prev.alignment === next.alignment &&
        prev.focusedCell?.rowKey === next.focusedCell?.rowKey &&
        prev.focusedCell?.step === next.focusedCell?.step
    );
});
