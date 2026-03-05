import React, { memo, useCallback, useImperativeHandle, forwardRef, useRef, useLayoutEffect } from 'react';
import { getNoteColor } from '../utils/noteColors';
import { noteToMidi } from '../utils/musicTheory';
import { GridIndicators } from './GridIndicators';
import { MelodicSequencerRow, type MelodicSequencerRowHandle } from './MelodicSequencerRow';
import type { Pattern, PartSequence, TrackKey } from '../types';
import type { AlignmentResult } from '../engines/rubberband/PhonemeAligner';

// --- PERFORMANCE STYLES ---
const SEQUENCER_STYLES = `
    .svg-step.is-current .step-glow { fill: rgba(255, 255, 255, 0.3) !important; }
    .svg-step.is-current .step-cap { stroke: #ffffff !important; stroke-width: 2px !important; }
    .svg-step.is-current .step-led { fill: #ff3333 !important; fill-opacity: 1 !important; }
    .automation-step.is-current rect { fill-opacity: 1 !important; filter: drop-shadow(0 0 4px white); }

    /* Focus Styles for Accessibility */
    .svg-step:focus, .track-slot:focus, .track-label:focus, .automation-step:focus { outline: none; }
    .svg-step:focus .step-cap { stroke: var(--focus-color, #22d3ee) !important; stroke-width: 2px !important; stroke-opacity: 1 !important; filter: drop-shadow(0 0 5px var(--focus-color, #22d3ee)); }
    .track-slot:focus rect { stroke: #22d3ee !important; stroke-width: 2px !important; stroke-opacity: 1 !important; filter: drop-shadow(0 0 5px #22d3ee); }
    .track-label:focus text { fill: #22d3ee !important; text-shadow: 0 0 8px rgba(34,211,238,0.8) !important; }
`;

const TRACK_COLORS: Record<string, string> = {
    partA: '#06b6d4',
    partB: '#d946ef',
    kick: '#f97316',
    snare: '#22c55e',
    closedHat: '#eab308',
    openHat: '#eab308',
    sampler: '#a855f7',
};

export const ROWS = [
    { key: 'partA', label: 'Lead' },
    { key: 'partB', label: 'Bass' },
    { key: 'kick', label: 'Kick' },
    { key: 'snare', label: 'Snare' },
    { key: 'closedHat', label: 'CH' },
    { key: 'openHat', label: 'OH' },
    { key: 'sampler', label: 'SMP' },
] as const;

const PATTERN_NOTES = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const getPatternColor = (slotIndex: number): string => {
    return getNoteColor(PATTERN_NOTES[slotIndex % PATTERN_NOTES.length]);
};

// --- COMPONENTS ---

export const AutomationStep = memo(({
    stepIndex, value, rowKey, rowLabel, onChange, refsArray
}: {
    stepIndex: number, value: number, rowKey: TrackKey, rowLabel: string,
    onChange: (k: TrackKey, i: number, val: number) => void,
    refsArray: React.MutableRefObject<(SVGGElement | null)[]>
}) => {
    const baseWidth = 18;
    const gap = 4;
    const height = 50;
    const x = 220 + stepIndex * (baseWidth + gap);
    const color = TRACK_COLORS[rowKey] || '#22d3ee';

    // Calculate bar height based on value (0-1)
    const barHeight = Math.max(2, value * height);
    const y = height - barHeight;

    const handleKeyDown = (e: React.KeyboardEvent) => {
        let newValue = value;
        let handled = false;
        const smallStep = 0.05;
        const largeStep = 0.2;

        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            newValue = Math.min(1, value + smallStep);
            handled = true;
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            newValue = Math.max(0, value - smallStep);
            handled = true;
        } else if (e.key === 'PageUp') {
            newValue = Math.min(1, value + largeStep);
            handled = true;
        } else if (e.key === 'PageDown') {
            newValue = Math.max(0, value - largeStep);
            handled = true;
        } else if (e.key === 'Home') {
            newValue = 0;
            handled = true;
        } else if (e.key === 'End') {
            newValue = 1;
            handled = true;
        }

        if (handled) {
            e.preventDefault();
            e.stopPropagation();
            onChange(rowKey, stepIndex, newValue);
        }
    };

    const handlePointerDown = (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const target = e.currentTarget as Element;
        target.setPointerCapture(e.pointerId);

        // We need bounding client rect to calculate relative Y
        const rect = target.getBoundingClientRect();

        const updateValue = (clientY: number) => {
            const relativeY = clientY - rect.top;
            // 0 is top, height is bottom
            // We want 1 at top (y=0), 0 at bottom (y=height)
            let val = 1 - (relativeY / rect.height);
            val = Math.max(0, Math.min(1, val));
            onChange(rowKey, stepIndex, val);
        };

        updateValue(e.clientY);

        const handlePointerMove = (ev: PointerEvent) => {
            updateValue(ev.clientY);
        };

        const handlePointerUp = (ev: PointerEvent) => {
            target.removeEventListener('pointermove', handlePointerMove as any);
            target.removeEventListener('pointerup', handlePointerUp as any);
            target.releasePointerCapture(ev.pointerId);
        };

        target.addEventListener('pointermove', handlePointerMove as any);
        target.addEventListener('pointerup', handlePointerUp as any);
    };

    return (
        <g
            transform={`translate(${x}, 0)`}
            ref={(el) => { refsArray.current[stepIndex] = el; }}
            className="automation-step"
            role="slider"
            aria-label={`${rowLabel} automation step ${stepIndex + 1}`}
            aria-valuenow={Math.round(value * 100)}
            aria-valuetext={`${Math.round(value * 100)}%`}
            tabIndex={0}
            cursor="ns-resize"
            onPointerDown={handlePointerDown}
            onKeyDown={handleKeyDown}
        >
            {/* Background container for click area */}
            <rect x={0} y={0} width={baseWidth} height={height} rx={2} fill="#111" fillOpacity={0.8} />

            {/* The Value Bar */}
            <rect
                x={1}
                y={y}
                width={baseWidth - 2}
                height={barHeight}
                rx={1}
                fill={color}
                fillOpacity={0.6}
                stroke={color}
                strokeWidth={1}
            />

            {/* Grid line at 50% */}
            <line x1={0} y1={height/2} x2={baseWidth} y2={height/2} stroke="#333" strokeDasharray="2,2" strokeWidth={1} pointerEvents="none" />
        </g>
    );
});

const SvgStep = memo(({
    stepIndex, active, note, refsArray, rowLabel, rowKey, onToggle, onRightMouseDown, onEditLength, length = 1, isSlide,
    onSelectionStart, onSelectionEnter, isRangeSelected, onDrawEnter, isDrawing, phonemeLabel, retrigger, reverse
}: {
    stepIndex: number, active: boolean, note?: string | null, refsArray: React.MutableRefObject<(SVGGElement | null)[]>,
    rowLabel: string, rowKey: TrackKey, onToggle: (k: TrackKey, i: number, e: any) => void,
    onRightMouseDown: (k: TrackKey, i: number, e: React.MouseEvent) => void,
    onEditLength: (k: TrackKey, i: number, len: number) => void, length?: number, isSlide?: boolean,
    onSelectionStart?: (k: TrackKey, i: number) => void,
    onSelectionEnter?: (k: TrackKey, i: number) => void,
    isRangeSelected?: boolean,
    onDrawEnter?: (k: TrackKey, i: number) => void,
    isDrawing?: boolean,
    phonemeLabel?: string,
    retrigger?: number,
    reverse?: boolean
}) => {
    const baseWidth = 18;
    const gap = 4;
    const height = 50;
    const x = 220 + stepIndex * (baseWidth + gap);
    const totalWidth = (baseWidth * length) + (gap * (length - 1));
    const retriggerCount = retrigger || 1;
    const color = note ? getNoteColor(note, rowKey) : '#06b6d4';
    const focusColor = TRACK_COLORS[rowKey] || '#22d3ee';
    const groupIndex = Math.floor(stepIndex / 4);
    const isAltGroup = groupIndex % 2 === 1;
    const baseFill = active ? '#0d1f15' : (isAltGroup ? '#1c2229' : '#14181c');

    const handlePointerDown = (e: React.PointerEvent) => {
        if (e.button === 2) { onRightMouseDown(rowKey, stepIndex, e); return; }
        if (e.shiftKey) {
            e.preventDefault(); e.stopPropagation();
            if (active) {
                // Length Editing
                const target = e.currentTarget as Element;
                target.setPointerCapture(e.pointerId);
                const startX = e.clientX;
                const startLength = length;
                const sensitivity = 20;
                const handlePointerMove = (ev: PointerEvent) => {
                    const delta = ev.clientX - startX;
                    const stepsToAdd = Math.floor(delta / sensitivity);
                    const newLength = Math.max(1, Math.min(16, startLength + stepsToAdd));
                    if (newLength !== length) { onEditLength(rowKey, stepIndex, newLength); }
                };
                const handlePointerUp = (ev: PointerEvent) => {
                    target.removeEventListener('pointermove', handlePointerMove as any);
                    target.removeEventListener('pointerup', handlePointerUp as any);
                    target.releasePointerCapture(ev.pointerId);
                };
                target.addEventListener('pointermove', handlePointerMove as any);
                target.addEventListener('pointerup', handlePointerUp as any);
            } else if (onSelectionStart) {
                // Range Selection
                onSelectionStart(rowKey, stepIndex);
            }
        } else { onToggle(rowKey, stepIndex, e); }
    };

    const handlePointerEnter = () => {
        if (isDrawing && onDrawEnter) onDrawEnter(rowKey, stepIndex);
        if (onSelectionEnter) onSelectionEnter(rowKey, stepIndex);
    };

    return (
        <g transform={`translate(${x}, 0)`} ref={(el) => { refsArray.current[stepIndex] = el; }} className="svg-step" role="button" tabIndex={0} aria-label={`${rowLabel} step ${stepIndex + 1}`} onPointerDown={handlePointerDown} onPointerEnter={handlePointerEnter} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(rowKey, stepIndex, e); } }} onContextMenu={(e) => e.preventDefault()} cursor="pointer" style={{ transition: 'all 0.1s ease', touchAction: 'none', '--focus-color': focusColor } as React.CSSProperties}>
            {active && <rect className="step-glow" x={-4} y={-4} width={totalWidth + 8} height={height + 8} rx={6} fill={color} fillOpacity={0.4} filter="blur(6px)" />}
            {isRangeSelected && <rect className="step-selection" x={-2} y={-2} width={totalWidth + 4} height={height + 4} rx={4} fill="none" stroke="#ffffff" strokeWidth={2} strokeOpacity={0.8} style={{ pointerEvents: 'none' }} />}
            <rect x={0} y={0} width={totalWidth} height={height} rx={3} fill="#050505" />
            {active && isSlide && <rect x={4} y={height - 8} width={totalWidth - 8} height={3} rx={1} fill="#fbbf24" fillOpacity={1} style={{ mixBlendMode: 'plus-lighter' }} />}
            <rect x={1} y={1} width={totalWidth - 2} height={height - 2} rx={2} fill={baseFill} strokeWidth={0} />

            {/* Retrigger Indicators */}
            {active && retriggerCount > 1 && Array.from({ length: retriggerCount - 1 }).map((_, i) => (
                <rect key={i} x={(totalWidth / retriggerCount) * (i + 1)} y={2} width={1} height={height - 4} fill="rgba(255,255,255,0.3)" />
            ))}

            <path d={`M 2 2 L ${totalWidth - 2} 2 L ${totalWidth - 4} 4 L 4 4 L 4 ${height - 4} L 2 ${height - 2} Z`} fill="rgba(255,255,255,0.2)" />
            <path d={`M ${totalWidth - 2} 2 L ${totalWidth - 2} ${height - 2} L 2 ${height - 2} L 4 ${height - 4} L ${totalWidth - 4} ${height - 4} L ${totalWidth - 4} 4 Z`} fill="rgba(0,0,0,0.5)" />
            <rect className="step-cap" x={3} y={4} width={totalWidth - 6} height={height - 8} rx={1} fill={active ? color : '#1a2026'} fillOpacity={active ? 0.6 : 1} stroke={active ? color : 'none'} strokeWidth={active ? 1 : 0} />
            {phonemeLabel && (
                <text x={totalWidth / 2} y={height / 2 + 4} textAnchor="middle" fontSize={10} fill="#fff" fontWeight="bold" fontFamily="monospace" pointerEvents="none" style={{ textShadow: '0 0 3px #000' }}>{phonemeLabel}</text>
            )}
            {active && reverse && (
                <path d="M 12 25 L 16 21 L 16 29 Z" fill="rgba(255,255,255,0.8)" pointerEvents="none" />
            )}
            {length > 1 && (<g pointerEvents="none"><g opacity={0.3} fill="#000"><rect x={totalWidth / 2 - 2} y={height / 2 - 10} width={4} height={20} rx={1} /><rect x={totalWidth / 2 - 8} y={height / 2 - 10} width={4} height={20} rx={1} /><rect x={totalWidth / 2 + 4} y={height / 2 - 10} width={4} height={20} rx={1} /></g><g transform={`translate(${totalWidth - 25}, 8)`}><rect width={20} height={14} rx={3} fill="#000" fillOpacity={0.6} /><text x={10} y={10} textAnchor="middle" fontSize={9} fill="#fff" fontWeight="bold" fontFamily="monospace">{length}x</text></g></g>)}
            <rect x={4} y={5} width={totalWidth - 8} height={(height - 10) / 2} rx={1} fill="url(#glassGrad)" fillOpacity={0.3} pointerEvents="none" />
            <rect className="step-led" x={5} y={height - 10} width={totalWidth - 10} height={3} rx={1} fill={active ? '#ccffcc' : '#000'} fillOpacity={active ? 0.8 : 0.2} />
        </g>
    )
})

const TrackSlotButton = memo(({ index, isActive, hasData, trackKey, onSelect }: { index: number, isActive: boolean, hasData: boolean, trackKey: TrackKey, onSelect: (k: TrackKey, i: number) => void }) => {
    const patternColor = getPatternColor(index);
    const inactiveColor = hasData ? patternColor : '#0f1812';
    return (
        <g transform={`translate(${index * 22}, 0)`} className="track-slot" onClick={() => onSelect(trackKey, index)} cursor="pointer" role="button" tabIndex={0} aria-label={`Pattern Slot ${index + 1}`} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(trackKey, index); } }} onContextMenu={(e) => e.preventDefault()}>
            <rect width={18} height={18} rx={2} fill={isActive ? patternColor : inactiveColor} fillOpacity={isActive ? 1 : (hasData ? 0.4 : 1)} stroke={isActive ? '#fff' : patternColor} strokeOpacity={isActive ? 1 : 0.6} strokeWidth={1} />
            <text x={9} y={13} textAnchor="middle" fontSize={10} fill={isActive ? '#000' : patternColor} fontFamily="monospace" fontWeight="bold">{index + 1}</text>
        </g>
    );
});

export interface SequencerRowHandle { setHighlight: (step: number) => void; }

const SequencerRow = memo(forwardRef<SequencerRowHandle, {
    rowKey: TrackKey, label: string, rowIndex: number, steps: (any | null)[], isSelected: boolean, activeSlot: number,
    trackSlots: (PartSequence | PartSequence[] | null)[], onToggle: (k: any, i: number, e: any) => void,
    onRightMouseDown: (k: TrackKey, i: number, e: any) => void, onEditLength: (k: TrackKey, i: number, len: number) => void,
    onSelectRow: (k: any) => void, onSelectSlot: (k: TrackKey, slot: number) => void,
    onSelectionStart?: (k: TrackKey, i: number) => void,
    onSelectionEnter?: (k: TrackKey, i: number) => void,
    selectionRange?: { start: number, end: number } | null,
    onDrawEnter?: (k: TrackKey, i: number) => void,
    isDrawing?: boolean,
    // Automation Props
    automation?: { [param: string]: (number | null)[] },
    viewMode?: 'notes' | 'automation',
    automationParam?: string,
    onAutomationChange?: (k: TrackKey, i: number, val: number) => void,
    alignment?: AlignmentResult | null
}>((props, ref) => {
    const { rowKey, label, rowIndex, steps, isSelected, activeSlot, trackSlots, onToggle, onRightMouseDown, onEditLength, onSelectRow, onSelectSlot, onSelectionStart, onSelectionEnter, selectionRange, onDrawEnter, isDrawing,
        automation, viewMode, automationParam, onAutomationChange, alignment } = props;
    const stepRefs = useRef<(SVGGElement | null)[]>([]);
    const lastStepRef = useRef(-1);
    const lastActiveIndexRef = useRef(-1);

    const updateClasses = useCallback((step: number) => {
        let newActiveIndex = -1;
        // Logic differs for automation (always step 1) vs notes (can be longer)
        if (viewMode === 'automation') {
             newActiveIndex = step;
        } else {
            for (let i = step; i >= 0; i--) {
                if (stepRefs.current[i]) {
                    const length = steps[i]?.length || 1;
                    if (i + length > step) { newActiveIndex = i; }
                    break;
                }
            }
        }

        if (newActiveIndex !== lastActiveIndexRef.current) {
            if (lastActiveIndexRef.current !== -1) { stepRefs.current[lastActiveIndexRef.current]?.classList.remove('is-current'); }
            if (newActiveIndex !== -1) { stepRefs.current[newActiveIndex]?.classList.add('is-current'); }
            lastActiveIndexRef.current = newActiveIndex;
        } else {
            if (newActiveIndex !== -1) { stepRefs.current[newActiveIndex]?.classList.add('is-current'); }
        }
    }, [steps, viewMode]);

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

    // Check if we should render automation
    if (viewMode === 'automation' && isSelected && onAutomationChange && automationParam) {
         const values = automation?.[automationParam] || Array(32).fill(null);

         for (let i = 0; i < 32; i++) {
             const val = values[i] ?? 0.5; // Default to center (no shift)
             renderedSteps.push(
                <AutomationStep
                    key={i}
                    stepIndex={i}
                    value={val}
                    rowKey={rowKey}
                    rowLabel={label}
                    onChange={onAutomationChange}
                    refsArray={stepRefs}
                />
             );
         }

    } else if (viewMode === 'automation' && !isSelected) {
        // If automation mode but track not selected, render dimmed notes or nothing?
        // Let's render normal notes but dimmed logic could be applied via CSS if needed.
        // For now, render normal notes to keep context.
        // Or render nothing to focus on the selected track automation?
        // Let's fall back to rendering notes.
        let skipCount = 0;
        for (let i = 0; i < 32; i++) {
            if (skipCount > 0) { skipCount--; continue; }
            const stepData = steps[i];
            const length = stepData?.length || 1;
            renderedSteps.push(<SvgStep key={i} stepIndex={i} active={!!stepData} note={stepData ? stepData.note : null} length={length} isSlide={!!stepData?.slide} refsArray={stepRefs} rowLabel={label} rowKey={rowKey} onToggle={onToggle} onRightMouseDown={onRightMouseDown} onEditLength={onEditLength} onSelectionStart={onSelectionStart} onSelectionEnter={onSelectionEnter} isRangeSelected={false} onDrawEnter={onDrawEnter} isDrawing={isDrawing} reverse={stepData?.reverse} />);
            if (stepData && length > 1) { skipCount = length - 1; }
        }
    } else {
        // Render Notes
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

            renderedSteps.push(<SvgStep key={i} stepIndex={i} active={!!stepData} note={stepData ? stepData.note : null} length={length} isSlide={!!stepData?.slide} refsArray={stepRefs} rowLabel={label} rowKey={rowKey} onToggle={onToggle} onRightMouseDown={onRightMouseDown} onEditLength={onEditLength} onSelectionStart={onSelectionStart} onSelectionEnter={onSelectionEnter} isRangeSelected={isRangeSelected} onDrawEnter={onDrawEnter} isDrawing={isDrawing} phonemeLabel={phonemeLabel} retrigger={stepData?.retrigger} reverse={stepData?.reverse} />);
            if (stepData && length > 1) { skipCount = length - 1; }
        }
    }

    return (
        <g transform={`translate(0, ${rowIndex * 60})`}>
            <g className="track-label" onClick={() => onSelectRow(rowKey)} cursor="pointer" role="button" tabIndex={0} aria-label={`Select ${label} track`} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectRow(rowKey); } }}>
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

export interface MainSequencerHandle {
    setHighlight: (step: number) => void;
}

export interface MainSequencerProps {
    pattern: Pattern;
    activeSamplerBank: number;
    selectedTrack: TrackKey;
    activeTrackSlots: Record<TrackKey, number>;
    trackStorage: Record<TrackKey, (PartSequence | PartSequence[] | null)[]>;
    selection: { trackKey: TrackKey; startStep: number; endStep: number; } | null;
    isDrawing: boolean;
    // Handlers
    onToggle: (rowKey: TrackKey, index: number, e: any) => void;
    onRightMouseDown: (rowKey: TrackKey, index: number, e: React.MouseEvent) => void;
    onEditLength: (rowKey: TrackKey, index: number, len: number) => void;
    onSelectRow: (rowKey: TrackKey) => void;
    onSelectSlot: (rowKey: TrackKey, slotIndex: number) => void;
    onSelectionStart: (rowKey: TrackKey, index: number) => void;
    onSelectionEnter: (rowKey: TrackKey, index: number) => void;
    onDrawEnter: (rowKey: TrackKey, index: number) => void;
    // Phase 2: Melodic Lyric Mode
    melodicMode?: boolean; // Enable pitch-per-step visualization for sampler
    onPitchChange?: (trackKey: TrackKey, step: number, pitch: number) => void;
    // Automation
    viewMode?: 'notes' | 'automation';
    automationParam?: string;
    onAutomationChange?: (trackKey: TrackKey, step: number, value: number) => void;
    alignment?: AlignmentResult | null;
    // Children are rendered after SVG (e.g. NoteSelector)
    children?: React.ReactNode;
}

export const MainSequencer = memo(forwardRef<MainSequencerHandle, MainSequencerProps>((props, ref) => {
    const { pattern, activeSamplerBank, selectedTrack, activeTrackSlots, trackStorage, selection, isDrawing, onToggle, onRightMouseDown, onEditLength, onSelectRow, onSelectSlot, onSelectionStart, onSelectionEnter, onDrawEnter, children,
        melodicMode = false, onPitchChange, viewMode = 'notes', automationParam, onAutomationChange, alignment } = props;

    const rowRefs = useRef<(SequencerRowHandle | null)[]>([]);
    const melodicRowRef = useRef<MelodicSequencerRowHandle | null>(null);

    useImperativeHandle(ref, () => ({
        setHighlight: (step: number) => {
            rowRefs.current.forEach(r => r?.setHighlight(step));
            melodicRowRef.current?.setHighlight(step);
        }
    }));

    return (
        <div className="w-full h-full p-4 bg-[#0a0d10] rounded-xl border-2 border-gray-700 shadow-2xl relative">
            <style>{SEQUENCER_STYLES}</style>
            <div className="absolute inset-0 rounded-xl border-2 border-cyan-900/10 pointer-events-none"></div>
            {/* Screws */}
            <div className="absolute top-3 left-3 w-4 h-4 rounded-full bg-gray-800 flex items-center justify-center border border-gray-600"><div className="w-2.5 h-[1.5px] bg-gray-600 rotate-45"></div></div>
            <div className="absolute top-3 right-3 w-4 h-4 rounded-full bg-gray-800 flex items-center justify-center border border-gray-600"><div className="w-2.5 h-[1.5px] bg-gray-600 rotate-45"></div></div>
            <div className="absolute bottom-3 left-3 w-4 h-4 rounded-full bg-gray-800 flex items-center justify-center border border-gray-600"><div className="w-2.5 h-[1.5px] bg-gray-600 rotate-45"></div></div>
            <div className="absolute bottom-3 right-3 w-4 h-4 rounded-full bg-gray-800 flex items-center justify-center border border-gray-600"><div className="w-2.5 h-[1.5px] bg-gray-600 rotate-45"></div></div>

            <svg viewBox="0 0 1050 500" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" onContextMenu={(e) => e.preventDefault()}>
                <defs><linearGradient id="glassGrad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="white" stopOpacity="0.5" /><stop offset="100%" stopColor="white" stopOpacity="0" /></linearGradient></defs>
                <g transform="translate(100, 40)">
                    {ROWS.map((row, rIdx) => {
                        // Use MelodicSequencerRow for sampler when in melodic mode
                        const isSamplerMelodic = row.key === 'sampler' && melodicMode;
                        
                        if (isSamplerMelodic) {
                            return (
                                <MelodicSequencerRow
                                    key={row.key}
                                    ref={melodicRowRef}
                                    rowKey={row.key}
                                    label={`SMP ${activeSamplerBank + 1}`}
                                    rowIndex={rIdx}
                                    steps={pattern.sampler[activeSamplerBank].steps}
                                    isSelected={selectedTrack === row.key}
                                    activeSlot={activeTrackSlots[row.key]}
                                    trackSlots={trackStorage[row.key]}
                                    onToggle={onToggle}
                                    onPitchChange={onPitchChange || (() => {})}
                                    onEditLength={onEditLength}
                                    onSelectRow={onSelectRow}
                                    onSelectSlot={onSelectSlot}
                                />
                            );
                        }
                        
                        return (
                            <SequencerRow
                                key={row.key} ref={(el) => { rowRefs.current[rIdx] = el; }} rowKey={row.key} label={row.key === 'sampler' ? `SMP ${activeSamplerBank + 1}` : row.label} rowIndex={rIdx}
                                steps={(row.key === 'sampler' ? pattern.sampler[activeSamplerBank].steps : (pattern as any)[row.key].steps)}
                                // Pass Automation Data
                                automation={(row.key === 'sampler' ? pattern.sampler[activeSamplerBank].automation : (pattern as any)[row.key].automation)}

                                isSelected={selectedTrack === row.key} activeSlot={activeTrackSlots[row.key]} trackSlots={trackStorage[row.key]}
                                onToggle={onToggle} onRightMouseDown={onRightMouseDown} onEditLength={onEditLength} onSelectRow={onSelectRow} onSelectSlot={onSelectSlot}
                                onSelectionStart={onSelectionStart} onSelectionEnter={onSelectionEnter}
                                selectionRange={selection && selection.trackKey === row.key ? { start: selection.startStep, end: selection.endStep } : null}
                                onDrawEnter={onDrawEnter} isDrawing={isDrawing}
                                viewMode={viewMode}
                                automationParam={automationParam}
                                onAutomationChange={onAutomationChange}
                                alignment={row.key === 'sampler' ? alignment : null}
                            />
                        );
                    })}
                </g>
            </svg>
            {children}
        </div>
    );
}));
