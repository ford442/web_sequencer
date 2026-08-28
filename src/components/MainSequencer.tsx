import React, { useMemo, useCallback, useImperativeHandle, forwardRef, memo, useRef, useLayoutEffect, useEffect, useState } from 'react';
import { MelodicSequencerRow, type MelodicSequencerRowHandle } from './MelodicSequencerRow';
import { PhonemePainter } from './PhonemePainter';
import type { Pattern, PartSequence, TrackKey, PhonemeData } from '../types';
import type { AlignmentResult } from '../engines/rubberband/PhonemeAligner';
import { useTimelineZoom } from '../hooks/useTimelineZoom';
import { DEFAULT_ZOOM, ROWS, SEQUENCER_STYLES } from './sequencer/constants';
import { AutomationStep } from './sequencer/AutomationStep';
import { SequencerRow, type SequencerRowHandle } from './sequencer/SequencerRow';
import { SequencerRowWrapper } from './sequencer/SequencerRowWrapper';
import { noop } from '../utils/noop';
import {
    getAdjacentSequencerCell,
    keyToGridDirection,
    sequencerCellKey,
    type SequencerCellCoord,
} from '../utils/sequencerGridKeyboard';
import { RackPanelChrome } from './ui/RackPanelChrome';

export { ROWS };
export { AutomationStep };
export type { SequencerRowHandle };

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
    // Handlers
    onToggle: (rowKey: TrackKey, index: number, e: any) => void;
    onRightMouseDown: (rowKey: TrackKey, index: number, e: React.MouseEvent) => void;
    onEditLength: (rowKey: TrackKey, index: number, len: number) => void;
    onSelectRow: (rowKey: TrackKey) => void;
    onSelectSlot: (rowKey: TrackKey, slotIndex: number) => void;
    onSelectionStart: (rowKey: TrackKey, index: number) => void;
    onSelectionEnter: (rowKey: TrackKey, index: number) => void;
    // Phase 2: Melodic Lyric Mode
    melodicMode?: boolean; // Enable pitch-per-step visualization for sampler
    onPitchChange?: (trackKey: TrackKey, step: number, pitch: number) => void;
    // Automation
    viewMode?: 'notes' | 'automation';
    automationParam?: string;
    onAutomationChange?: (trackKey: TrackKey, step: number, value: number) => void;
    alignment?: AlignmentResult | null;
    // Phase 3: Phoneme Painter
    onPhonemeUpdate?: (trackKey: TrackKey, bankIndex: number, step: number, phonemes: PhonemeData[] | undefined) => void;
    samplerAudioBuffer?: AudioBuffer | null;
    // Zoom: controlled via props (persisted in app state), with gestures handled locally
    zoomLevel?: number;
    onZoomChange?: (z: number) => void;
    // Children are rendered after SVG (e.g. NoteSelector)
    children?: React.ReactNode;
}

export const MainSequencer = memo(forwardRef<MainSequencerHandle, MainSequencerProps>((props, ref) => {
    const { pattern, activeSamplerBank, selectedTrack, activeTrackSlots, trackStorage, selection, onToggle, onRightMouseDown, onEditLength, onSelectRow, onSelectSlot, onSelectionStart, onSelectionEnter, children,
        melodicMode = false, onPitchChange, viewMode = 'notes', automationParam, onAutomationChange, alignment, onPhonemeUpdate, samplerAudioBuffer,
        zoomLevel = DEFAULT_ZOOM, onZoomChange } = props;

    const rowRefs = useRef<(SequencerRowHandle | null)[]>([]);
    const melodicRowRef = useRef<MelodicSequencerRowHandle | null>(null);

    // Zoom state: driven by prop (for persistence), updated via gesture/wheel events.
    const [zoom, setZoom] = useState(zoomLevel);

    const containerRef = useRef<HTMLDivElement>(null);

    // Sync external zoomLevel prop → local state (e.g. when app state loads a saved value).
    const prevZoomLevelRef = useRef(zoomLevel);
    useLayoutEffect(() => {
        if (zoomLevel !== prevZoomLevelRef.current) {
            prevZoomLevelRef.current = zoomLevel;
            setZoom(zoomLevel);
            // Also sync the CSS variable immediately if the external prop changes
            if (containerRef.current) {
                containerRef.current.style.setProperty('--zoom-level', zoomLevel.toString());
            }
        }
    }, [zoomLevel]);

    // Wrap setZoom to also notify parent (persist to app state).
    const handleZoomChange = useCallback((newZoom: number) => {
        setZoom(newZoom);
        onZoomChange?.(newZoom);
    }, [onZoomChange]);


    // Attach Ctrl+wheel and pointer-based pinch-to-zoom.
    const { handleDoubleClick } = useTimelineZoom({
        containerRef: containerRef as React.RefObject<HTMLElement | null>,
        zoom,
        onZoomChange: handleZoomChange,
    });



    // Phase 3: Phoneme Painter state
    const [phonemePainterState, setPhonemePainterState] = useState<{
        isOpen: boolean;
        stepIndex: number;
        note: any | null;
    }>({ isOpen: false, stepIndex: 0, note: null });

    useImperativeHandle(ref, () => ({
        setHighlight: (step: number) => {
            rowRefs.current.forEach(r => r?.setHighlight(step));
            melodicRowRef.current?.setHighlight(step);
        }
    }));

    // Handle Alt+Click on sampler steps to open Phoneme Painter
    // PERFORMANCE: Use a ref to store the latest pattern.sampler to avoid re-creating this callback
    // and causing all SequencerRows (256 steps) to re-render whenever any sampler note changes.
    const patternSamplerRef = useRef(pattern.sampler);
    useLayoutEffect(() => {
        patternSamplerRef.current = pattern.sampler;
    }, [pattern.sampler]);

    const activeSamplerBankRef = useRef(activeSamplerBank);
    useLayoutEffect(() => {
        activeSamplerBankRef.current = activeSamplerBank;
    }, [activeSamplerBank]);

    const handleStepPointerDown = useCallback((rowKey: TrackKey, stepIndex: number, e: React.PointerEvent | React.KeyboardEvent) => {
        // Check for Alt+Click (or Option+Click on Mac)
        if (rowKey === 'sampler' && e.altKey && onPhonemeUpdate) {
            const stepData = patternSamplerRef.current[activeSamplerBankRef.current].steps[stepIndex];
            if (stepData) {
                e.preventDefault();
                e.stopPropagation();
                setPhonemePainterState({
                    isOpen: true,
                    stepIndex,
                    note: stepData
                });
                return;
            }
        }
        // Otherwise pass to normal toggle handler
        onToggle(rowKey, stepIndex, e);
    }, [onToggle, onPhonemeUpdate]);

    // Handle save from Phoneme Painter
    const handlePhonemeSave = useCallback((stepIndex: number, phonemes: PhonemeData[] | undefined) => {
        if (onPhonemeUpdate) {
            onPhonemeUpdate('sampler', activeSamplerBank, stepIndex, phonemes);
        }
    }, [onPhonemeUpdate, activeSamplerBank]);

    // Close phoneme painter
    const handleClosePhonemePainter = useCallback(() => {
        setPhonemePainterState(prev => ({ ...prev, isOpen: false }));
    }, []);

    // PERFORMANCE: Memoize selection range map to prevent object recreation and unnecessary row re-renders
    const selectionRangeMap = useMemo(() => {
        if (!selection) return null;
        return { [selection.trackKey]: { start: selection.startStep, end: selection.endStep } };
    }, [selection]);

    const [focusedCell, setFocusedCell] = useState<SequencerCellCoord>(() => ({
        rowKey: selectedTrack,
        step: 0,
    }));
    const stepFocusRefs = useRef(new Map<string, SVGGElement>());
    const selectionRef = useRef(selection);
    useLayoutEffect(() => {
        selectionRef.current = selection;
    }, [selection]);

    useEffect(() => {
        setFocusedCell((prev) =>
            prev.rowKey === selectedTrack ? prev : { rowKey: selectedTrack, step: prev.step },
        );
    }, [selectedTrack]);

    const focusSequencerCell = useCallback((coord: SequencerCellCoord) => {
        setFocusedCell(coord);
        stepFocusRefs.current.get(sequencerCellKey(coord.rowKey, coord.step))?.focus();
    }, []);

    const handleStepRef = useCallback((rowKey: TrackKey, step: number, el: SVGGElement | null) => {
        const key = sequencerCellKey(rowKey, step);
        if (el) stepFocusRefs.current.set(key, el);
        else stepFocusRefs.current.delete(key);
    }, []);

    const handleStepGridKeyDown = useCallback(
        (rowKey: TrackKey, step: number, e: React.KeyboardEvent) => {
            const direction = keyToGridDirection(e.key);
            if (!direction) return;
            e.preventDefault();
            const next = getAdjacentSequencerCell(rowKey, step, direction);
            if (e.shiftKey) {
                const sel = selectionRef.current;
                if (!sel) onSelectionStart(rowKey, step);
                onSelectionEnter(next.rowKey, next.step);
            }
            focusSequencerCell(next);
        },
        [onSelectionStart, onSelectionEnter, focusSequencerCell],
    );


    const baseWidth = 1050;
    const timelineWidth = 830;

    return (
        <div
            id="main-sequencer"
            className="w-full h-full p-4 hyphon-sequencer-shell relative overflow-x-auto overflow-y-hidden scrollbar-thin hyphon-sequencer-scroll touch-pan-x"
            ref={containerRef}
            onDoubleClick={handleDoubleClick}
            role="grid"
            aria-label="Step sequencer"
            aria-describedby="sequencer-kbd-hint"
            style={{ '--zoom-level': zoom } as React.CSSProperties}
        >
            <p id="sequencer-kbd-hint" className="sr-only">
                Arrow keys move between steps and tracks. Space or Enter toggles a step. Shift plus arrow extends the selection range.
            </p>
            <style>{SEQUENCER_STYLES}</style>
            <div className="absolute inset-0 rounded-xl border-2 border-cyan-900/10 pointer-events-none" aria-hidden="true" />
            <RackPanelChrome stickyScrews />

            {/* Alt+Click hint for sampler */}
            {onPhonemeUpdate && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 text-[10px] text-cyan-500/60 font-mono pointer-events-none" style={{ position: 'sticky', left: '50%' }}>
                    Alt+Click sampler step for Phoneme Painter
                </div>
            )}

            <svg viewBox="0 0 1050 680" style={{ width: 'calc(220px + 830px * var(--zoom-level))', height: '100%', minWidth: '100%' }} preserveAspectRatio="xMinYMid meet" onContextMenu={(e) => e.preventDefault()}>
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
                                    onToggle={handleStepPointerDown}
                                    onPitchChange={onPitchChange || noop}
                                    onEditLength={onEditLength}
                                    onSelectRow={onSelectRow}
                                    onSelectSlot={onSelectSlot}
                                />
                            );
                        }
                        

                        return (
                            <SequencerRowWrapper
                                key={row.key}
                                row={row}
                                rIdx={rIdx}
                                rowRefs={rowRefs}
                                steps={(row.key === 'sampler' ? pattern.sampler[activeSamplerBank].steps : (pattern as any)[row.key].steps)}
                                automation={(row.key === 'sampler' ? pattern.sampler[activeSamplerBank].automation : (pattern as any)[row.key].automation)}
                                isSelected={selectedTrack === row.key}
                                activeSlot={activeTrackSlots[row.key]}
                                trackSlots={trackStorage[row.key]}
                                selectionRange={selectionRangeMap?.[row.key] || null}
                                activeSamplerBank={activeSamplerBank}
                                handleStepPointerDown={handleStepPointerDown}
                                onRightMouseDown={onRightMouseDown}
                                onEditLength={onEditLength}
                                onSelectRow={onSelectRow}
                                onSelectSlot={onSelectSlot}
                                onSelectionStart={onSelectionStart}
                                onSelectionEnter={onSelectionEnter}
                                viewMode={viewMode}
                                automationParam={automationParam}
                                onAutomationChange={onAutomationChange}
                                alignment={row.key === 'sampler' ? alignment : null}
                                focusedCell={focusedCell}
                                onStepRef={handleStepRef}
                                onStepGridKeyDown={handleStepGridKeyDown}
                            />
                        );
                    })}
                </g>
            </svg>
            {children}

            {/* Phoneme Painter Popover */}
            <PhonemePainter
                isOpen={phonemePainterState.isOpen}
                onClose={handleClosePhonemePainter}
                stepIndex={phonemePainterState.stepIndex}
                note={phonemePainterState.note}
                // @ts-expect-error - Auto-generated to fix CI build
                audioBuffer={samplerAudioBuffer}
                alignment={alignment}
                onSave={handlePhonemeSave}
            />
        </div>
    );
}));
