import React, { memo, useRef, useState, useCallback, forwardRef, useImperativeHandle, useEffect } from 'react';
import { getNoteColor } from '../utils/noteColors';
import { PatternSelector } from './PatternSelector';
import { MAX_TRACK_PATTERN_SLOT_INDEX } from '../utils/trackStorageUtils';
import { useCompactLayoutOptional } from '../contexts/CompactLayoutContext';
import { SongModeToolbar } from './songMode/SongModeToolbar';
import type { SongCellCoord, SongModeTrackKey, SongSegmentClipboard, SongStructure } from '../types/songMode';
import {
    SONG_MODE_TRACKS,
    cellId,
    parseCellId,
    selectSingle,
    toggleCellSelection,
    selectTrackRange,
    selectMeasureColumns,
    selectRectangle,
    bulkClear,
    bulkCycle,
    bulkSetPattern,
    swapCells,
    copySegment,
    pasteSegment,
    updateCell,
    getPatternRun,
    duplicateMeasure,
    insertMeasure,
    removeMeasureAt,
    createEmptyMeasure,
} from '../utils/songModeEditing';
import {
    getAdjacentSongCell,
    keyToSongGridDirection,
    songCellDomKey,
} from '../utils/songModeGridKeyboard';

export interface SongModeHandle {
    setHighlight: (step: number) => void;
}

const PATTERN_NOTES = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const getPatternColor = (slotIndex: number): string => {
    return getNoteColor(PATTERN_NOTES[slotIndex % PATTERN_NOTES.length]);
};

interface SongModeProps {
    isVisible: boolean;
    songStructure: SongStructure;
    currentSongStep: number;
    backgroundImage: string;
    onSetBackgroundImage: (url: string) => void;
    onUpdateStep: (stepIndex: number, track: SongModeTrackKey, slotIndex: number | null) => void;
    onEditStructure?: (updater: (prev: SongStructure) => SongStructure) => void;
    onUndoSong?: () => void;
    onRedoSong?: () => void;
    canUndoSong?: boolean;
    canRedoSong?: boolean;
    onToggle: () => void;
    onAddMeasure: () => void;
    onRemoveMeasure: () => void;
    onExportXM: () => Promise<void> | void;
    isSongModeActive: boolean;
    onSetIsSongModeActive: (active: boolean) => void;
}

const CELL_WIDTH = 40;
const CELL_HEIGHT = 30;
const CELL_WIDTH_COMPACT = 48;
const CELL_HEIGHT_COMPACT = 44;
const ROW_HEADER_WIDTH = 80;
const HEADER_HEIGHT = 30;
const DRAG_THRESHOLD = 8;

const SongModeCell = memo(
    forwardRef<
        HTMLDivElement,
        {
            sIdx: number;
            rowKey: SongModeTrackKey;
            rowLabel: string;
            val: number | null;
            cellWidth: number;
            cellHeight: number;
            isSelected: boolean;
            runLength: number | null;
            onPointerDown: (
                e: React.PointerEvent,
                sIdx: number,
                track: SongModeTrackKey,
                currentVal: number | null,
            ) => void;
            onKeyDown: (e: React.KeyboardEvent, sIdx: number, track: SongModeTrackKey, currentVal: number | null) => void;
            onDoubleClick: (sIdx: number, track: SongModeTrackKey, currentVal: number | null) => void;
            tabIndex?: number;
        }
    >(({ sIdx, rowKey, rowLabel, val, cellWidth, cellHeight, isSelected, runLength, onPointerDown, onKeyDown, onDoubleClick, tabIndex = -1 }, ref) => {
        const hasVal = val !== null;
        return (
            <div
                ref={ref}
                data-testid={`cell-${rowKey}-${sIdx}`}
                data-cell-id={cellId(sIdx, rowKey)}
                style={{ width: cellWidth, minHeight: cellHeight }}
                className={`song-mode-cell shrink-0 border-r border-b relative group cursor-pointer transition-colors select-none focus:outline-none focus:ring-1 focus:ring-cyan-500 touch-manipulation
                    ${hasVal ? 'border-gray-800/40 bg-gray-900/20' : 'border-dashed border-gray-700/60 bg-gray-950/30 hover:bg-gray-800/40'}
                    ${isSelected ? 'ring-2 ring-cyan-400/80 ring-inset z-[5]' : ''}
                `}
                role="gridcell"
                tabIndex={tabIndex}
                aria-selected={isSelected}
                aria-label={`${rowLabel} Measure ${sIdx + 1}, ${hasVal ? `Pattern ${val! + 1}` : 'Empty'}${runLength && runLength > 1 ? `, repeats ${runLength} bars` : ''}`}
                onPointerDown={(e) => {
                    if (e.button === 0 || e.pointerType === 'touch') {
                        onPointerDown(e, sIdx, rowKey, val);
                    }
                }}
                onKeyDown={(e) => onKeyDown(e, sIdx, rowKey, val)}
                onDoubleClick={() => onDoubleClick(sIdx, rowKey, val)}
                onContextMenu={(e) => e.preventDefault()}
            >
                {hasVal && (
                    <div
                        className="absolute inset-1 rounded flex items-center justify-center text-[10px] font-bold text-black select-none pointer-events-none song-mode-cell-inner shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
                        style={{ backgroundColor: getPatternColor(val!) }}
                    >
                        {val! + 1}
                        {runLength && runLength > 1 && (
                            <span className="absolute -top-1 -right-1 text-[8px] bg-black/70 text-cyan-300 px-0.5 rounded">
                                ×{runLength}
                            </span>
                        )}
                    </div>
                )}
            </div>
        );
    }),
);

function getPrimarySelectionCoord(selection: Set<string>): SongCellCoord | null {
    const first = selection.values().next().value;
    if (!first) return null;
    return parseCellId(first);
}

export const SongMode = memo(
    forwardRef<SongModeHandle, SongModeProps & { is3D?: boolean }>(
        (
            {
                isVisible,
                songStructure,
                currentSongStep,
                backgroundImage,
                onSetBackgroundImage,
                onUpdateStep,
                onEditStructure,
                onUndoSong,
                onRedoSong,
                canUndoSong = false,
                canRedoSong = false,
                onToggle,
                onAddMeasure,
                onRemoveMeasure,
                onExportXM,
                isSongModeActive,
                onSetIsSongModeActive,
                is3D = false,
            },
            ref,
        ) => {
            const compactLayout = useCompactLayoutOptional();
            const isCompact = compactLayout?.isCompact ?? false;
            const cellWidth = isCompact ? CELL_WIDTH_COMPACT : CELL_WIDTH;
            const cellHeight = isCompact ? CELL_HEIGHT_COMPACT : CELL_HEIGHT;
            const totalWidth = ROW_HEADER_WIDTH + songStructure.length * cellWidth;

            const [menu, setMenu] = useState<{
                x: number;
                y: number;
                sIdx: number;
                track: SongModeTrackKey;
                currentVal: number | null;
            } | null>(null);
            const [isExporting, setIsExporting] = useState(false);
            const [selection, setSelection] = useState<Set<string>>(new Set());
            const [selectionAnchor, setSelectionAnchor] = useState<SongCellCoord | null>(null);
            const [dragGhost, setDragGhost] = useState<{
                track: SongModeTrackKey;
                measure: number;
                value: number | null;
                x: number;
                y: number;
            } | null>(null);
            const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
            const [focusedCell, setFocusedCell] = useState<SongCellCoord>({ measure: 0, track: 'partA' });

            const clipboardRef = useRef<SongSegmentClipboard | null>(null);
            const playheadLineRefs = useRef<(HTMLDivElement | null)[]>([]);
            const headerCellRefs = useRef<(HTMLButtonElement | null)[]>([]);
            const songModeCellRefs = useRef<Map<string, HTMLDivElement>>(new Map());
            const gridRef = useRef<HTMLDivElement | null>(null);
            const lastHighlightedStep = useRef<number>(-1);
            const lastRightClickTimeRef = useRef<number>(0);

            const rightDragRef = useRef<{
                sIdx: number;
                track: SongModeTrackKey;
                startY: number;
                startVal: number | null;
                hasMoved: boolean;
            } | null>(null);

            const leftDragRef = useRef<{
                from: SongCellCoord;
                startX: number;
                startY: number;
                hasMoved: boolean;
                mode: 'swap' | 'marquee';
            } | null>(null);

            const applyStructure = useCallback(
                (updater: (prev: SongStructure) => SongStructure) => {
                    if (onEditStructure) {
                        onEditStructure(updater);
                    } else {
                        const next = updater(songStructure);
                        for (let m = 0; m < next.length; m++) {
                            for (const { key } of SONG_MODE_TRACKS) {
                                const oldVal = songStructure[m]?.[key] ?? null;
                                const newVal = next[m]?.[key] ?? null;
                                if (oldVal !== newVal) onUpdateStep(m, key, newVal);
                            }
                        }
                    }
                },
                [onEditStructure, onUpdateStep, songStructure],
            );

            const setCellValue = useCallback(
                (measure: number, track: SongModeTrackKey, value: number | null) => {
                    if (onEditStructure) {
                        applyStructure((prev) => updateCell(prev, measure, track, value));
                    } else {
                        onUpdateStep(measure, track, value);
                    }
                },
                [applyStructure, onEditStructure, onUpdateStep],
            );

            useImperativeHandle(ref, () => ({
                setHighlight: (step: number) => {
                    if (lastHighlightedStep.current !== -1 && lastHighlightedStep.current !== step) {
                        const prev = lastHighlightedStep.current;
                        const prevHeader = headerCellRefs.current[prev];
                        if (prevHeader) {
                            prevHeader.classList.remove('bg-cyan-900/20', 'text-cyan-400', 'font-bold');
                            prevHeader.classList.add('text-gray-600');
                        }
                        playheadLineRefs.current.forEach((line) => {
                            if (line) line.style.left = `${ROW_HEADER_WIDTH + step * cellWidth}px`;
                        });
                        SONG_MODE_TRACKS.forEach((row) => {
                            const cell = songModeCellRefs.current.get(`${row.key}-${prev}`);
                            if (!cell) return;
                            cell.classList.remove('bg-white/5');
                            const inner = cell.querySelector('.song-mode-cell-inner');
                            if (inner) inner.classList.remove('opacity-100');
                        });
                    }
                    if (step !== -1) {
                        const currentHeader = headerCellRefs.current[step];
                        if (currentHeader) {
                            currentHeader.classList.remove('text-gray-600');
                            currentHeader.classList.add('bg-cyan-900/20', 'text-cyan-400', 'font-bold');
                        }
                        playheadLineRefs.current.forEach((line) => {
                            if (line) line.style.left = `${ROW_HEADER_WIDTH + step * cellWidth}px`;
                        });
                        SONG_MODE_TRACKS.forEach((row) => {
                            const cell = songModeCellRefs.current.get(`${row.key}-${step}`);
                            if (!cell) return;
                            cell.classList.add('bg-white/5');
                            const inner = cell.querySelector('.song-mode-cell-inner');
                            if (inner) inner.classList.add('opacity-100');
                        });
                    }
                    lastHighlightedStep.current = step;
                },
            }));

            const handleRightDragMove = useCallback(
                (e: MouseEvent) => {
                    if (!rightDragRef.current) return;
                    const { sIdx, track, startY, startVal } = rightDragRef.current;
                    const dy = startY - e.clientY;
                    if (!rightDragRef.current.hasMoved && Math.abs(dy) > 5) {
                        rightDragRef.current.hasMoved = true;
                    }
                    if (rightDragRef.current.hasMoved) {
                        const step = Math.round(dy / 15);
                        if (step !== 0) {
                            let newVal: number | null;
                            if (startVal === null) {
                                newVal =
                                    step > 0
                                        ? Math.min(step - 1, MAX_TRACK_PATTERN_SLOT_INDEX)
                                        : Math.max(MAX_TRACK_PATTERN_SLOT_INDEX + step + 1, 0);
                            } else {
                                newVal = startVal + step;
                            }
                            if (newVal !== null) {
                                if (newVal < 0) newVal = null;
                                else if (newVal > MAX_TRACK_PATTERN_SLOT_INDEX) newVal = MAX_TRACK_PATTERN_SLOT_INDEX;
                            }
                            setCellValue(sIdx, track, newVal);
                        }
                    }
                },
                [setCellValue],
            );

            const handleRightDragUp = useCallback(
                (e: MouseEvent) => {
                    if (!rightDragRef.current) return;
                    if (!rightDragRef.current.hasMoved) {
                        const now = Date.now();
                        const diff = now - lastRightClickTimeRef.current;
                        if (diff < 300) {
                            const { sIdx, track, startVal } = rightDragRef.current;
                            setMenu({ x: e.clientX, y: e.clientY, sIdx, track, currentVal: startVal });
                            lastRightClickTimeRef.current = 0;
                        } else {
                            lastRightClickTimeRef.current = now;
                        }
                    }
                    rightDragRef.current = null;
                    document.body.style.cursor = 'default';
                    window.removeEventListener('mousemove', handleRightDragMove);
                    window.removeEventListener('mouseup', handleRightDragUp);
                },
                [handleRightDragMove],
            );

            const finishLeftDrag = useCallback(
                (e: PointerEvent) => {
                    if (!leftDragRef.current) return;
                    const drag = leftDragRef.current;
                    leftDragRef.current = null;
                    setDragGhost(null);
                    setMarquee(null);
                    document.body.style.cursor = 'default';

                    if (drag.mode === 'swap' && drag.hasMoved) {
                        const el = document.elementFromPoint(e.clientX, e.clientY);
                        const cellEl = el?.closest('[data-cell-id]') as HTMLElement | null;
                        const targetId = cellEl?.dataset.cellId;
                        const target = targetId ? parseCellId(targetId) : null;
                        if (target) {
                            applyStructure((prev) => swapCells(prev, drag.from, target));
                        }
                    }
                },
                [applyStructure],
            );

            const handleLeftDragMove = useCallback(
                (e: PointerEvent) => {
                    if (!leftDragRef.current) return;
                    const drag = leftDragRef.current;
                    const dx = e.clientX - drag.startX;
                    const dy = e.clientY - drag.startY;
                    if (!drag.hasMoved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
                        drag.hasMoved = true;
                        document.body.style.cursor = drag.mode === 'swap' ? 'grabbing' : 'crosshair';
                    }
                    if (!drag.hasMoved) return;
                    if (drag.mode === 'swap') {
                        const val = songStructure[drag.from.measure]?.[drag.from.track] ?? null;
                        setDragGhost({ track: drag.from.track, measure: drag.from.measure, value: val, x: e.clientX, y: e.clientY });
                    } else {
                        setMarquee({ x0: drag.startX, y0: drag.startY, x1: e.clientX, y1: e.clientY });
                        const el = document.elementFromPoint(e.clientX, e.clientY);
                        const cellEl = el?.closest('[data-cell-id]') as HTMLElement | null;
                        const targetId = cellEl?.dataset.cellId;
                        const target = targetId ? parseCellId(targetId) : null;
                        if (target && selectionAnchor) {
                            setSelection(selectRectangle(selectionAnchor, target));
                        }
                    }
                },
                [selectionAnchor, songStructure],
            );

            const handleCellPointerDown = useCallback(
                (e: React.PointerEvent, sIdx: number, track: SongModeTrackKey, currentVal: number | null) => {
                    if (e.button === 2) {
                        e.preventDefault();
                        e.stopPropagation();
                        rightDragRef.current = {
                            sIdx,
                            track,
                            startY: e.clientY,
                            startVal: currentVal,
                            hasMoved: false,
                        };
                        document.body.style.cursor = 'ns-resize';
                        window.addEventListener('mousemove', handleRightDragMove);
                        window.addEventListener('mouseup', handleRightDragUp);
                        return;
                    }

                    if (e.button !== 0) return;
                    e.stopPropagation();
                    const coord: SongCellCoord = { measure: sIdx, track };
                    const id = cellId(sIdx, track);

                    if (e.shiftKey && e.altKey) {
                        setSelection(selectMeasureColumns(selectionAnchor?.measure ?? sIdx, sIdx));
                        setSelectionAnchor(coord);
                        return;
                    }

                    if (e.shiftKey && selectionAnchor) {
                        setSelection(selectTrackRange(selectionAnchor, coord));
                        return;
                    }

                    if (e.metaKey || e.ctrlKey) {
                        setSelection((prev) => toggleCellSelection(prev, coord));
                        setSelectionAnchor(coord);
                        return;
                    }

                    if (!selection.has(id)) {
                        setSelection(selectSingle(coord));
                    }
                    setSelectionAnchor(coord);

                    leftDragRef.current = {
                        from: coord,
                        startX: e.clientX,
                        startY: e.clientY,
                        hasMoved: false,
                        mode: e.shiftKey ? 'marquee' : 'swap',
                    };
                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                    const onMove = (ev: PointerEvent) => handleLeftDragMove(ev);
                    const onUp = (ev: PointerEvent) => {
                        finishLeftDrag(ev);
                        window.removeEventListener('pointermove', onMove);
                        window.removeEventListener('pointerup', onUp);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                },
                [
                    finishLeftDrag,
                    handleLeftDragMove,
                    handleRightDragMove,
                    handleRightDragUp,
                    selection,
                    selectionAnchor,
                ],
            );

            const handleCellDoubleClick = useCallback(
                (sIdx: number, track: SongModeTrackKey, currentVal: number | null) => {
                    if (currentVal !== null) setCellValue(sIdx, track, null);
                    else setCellValue(sIdx, track, 0);
                },
                [setCellValue],
            );

            const focusSongCell = useCallback((coord: SongCellCoord) => {
                setFocusedCell(coord);
                const el = songModeCellRefs.current.get(songCellDomKey(coord.track, coord.measure));
                el?.focus();
            }, []);

            const handleCellKeyDown = useCallback(
                (e: React.KeyboardEvent, sIdx: number, track: SongModeTrackKey, currentVal: number | null) => {
                    const coord: SongCellCoord = { measure: sIdx, track };
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (currentVal !== null) setCellValue(sIdx, track, null);
                        else setCellValue(sIdx, track, 0);
                        return;
                    }
                    if (e.key === 'ArrowUp' && !e.shiftKey) {
                        e.preventDefault();
                        const nextVal = currentVal === null ? 0 : Math.min(MAX_TRACK_PATTERN_SLOT_INDEX, currentVal + 1);
                        setCellValue(sIdx, track, nextVal);
                        return;
                    }
                    if (e.key === 'ArrowDown' && !e.shiftKey) {
                        e.preventDefault();
                        const nextVal = currentVal === null ? 0 : Math.max(0, currentVal - 1);
                        setCellValue(sIdx, track, nextVal);
                        return;
                    }
                    const navDir = keyToSongGridDirection(e.key);
                    if (navDir) {
                        e.preventDefault();
                        const next = getAdjacentSongCell(sIdx, track, navDir, songStructure.length);
                        if (e.shiftKey) {
                            const anchor = selectionAnchor ?? coord;
                            if (navDir === 'left' || navDir === 'right') {
                                setSelection(selectTrackRange(anchor, next));
                            } else {
                                setSelection(selectRectangle(anchor, next));
                            }
                            setSelectionAnchor(anchor);
                        }
                        focusSongCell(next);
                        return;
                    }
                    if (e.key === 'Delete' || e.key === 'Backspace') {
                        e.preventDefault();
                        if (selection.size > 1 && selection.has(cellId(sIdx, track))) {
                            applyStructure((prev) => bulkClear(prev, selection));
                        } else {
                            setCellValue(sIdx, track, null);
                        }
                    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
                        e.preventDefault();
                        clipboardRef.current = copySegment(songStructure, selection.size ? selection : selectSingle(coord));
                    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
                        e.preventDefault();
                        const clip = clipboardRef.current;
                        if (!clip) return;
                        const anchor = getPrimarySelectionCoord(selection) ?? coord;
                        applyStructure((prev) => pasteSegment(prev, clip, anchor));
                    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
                        e.preventDefault();
                        onUndoSong?.();
                    } else if (
                        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') ||
                        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y')
                    ) {
                        e.preventDefault();
                        onRedoSong?.();
                    }
                },
                [applyStructure, focusSongCell, onRedoSong, onUndoSong, selection, selectionAnchor, setCellValue, songStructure],
            );

            const handleMeasureHeaderClick = useCallback(
                (measure: number, e: React.MouseEvent) => {
                    if (e.shiftKey) {
                        setSelection(selectMeasureColumns(selectionAnchor?.measure ?? measure, measure));
                    } else {
                        setSelection(selectMeasureColumns(measure, measure));
                    }
                    setSelectionAnchor({ measure, track: 'partA' });
                },
                [selectionAnchor],
            );

            const toolbarActions = {
                onClear: () => applyStructure((prev) => bulkClear(prev, selection)),
                onCycleUp: () => applyStructure((prev) => bulkCycle(prev, selection, 1)),
                onCycleDown: () => applyStructure((prev) => bulkCycle(prev, selection, -1)),
                onCopy: () => {
                    clipboardRef.current = copySegment(songStructure, selection);
                },
                onPaste: () => {
                    const clip = clipboardRef.current;
                    const anchor = getPrimarySelectionCoord(selection) ?? { measure: 0, track: 'partA' };
                    if (clip) applyStructure((prev) => pasteSegment(prev, clip, anchor));
                },
                onUndo: () => onUndoSong?.(),
                onRedo: () => onRedoSong?.(),
                onDuplicateMeasure: () => {
                    const m = getPrimarySelectionCoord(selection)?.measure ?? songStructure.length - 1;
                    applyStructure((prev) => duplicateMeasure(prev, m));
                },
                onInsertMeasure: () => {
                    const m = (getPrimarySelectionCoord(selection)?.measure ?? songStructure.length - 1) + 1;
                    applyStructure((prev) => insertMeasure(prev, m, createEmptyMeasure()));
                },
                onRemoveMeasureAt: () => {
                    const m = getPrimarySelectionCoord(selection)?.measure ?? songStructure.length - 1;
                    const row = songStructure[m];
                    const hasData = row && Object.values(row).some((v) => v !== null);
                    if (hasData && !window.confirm(`Measure ${m + 1} contains patterns. Remove it?`)) return;
                    applyStructure((prev) => removeMeasureAt(prev, m));
                },
            };

            useEffect(() => {
                return () => {
                    window.removeEventListener('mousemove', handleRightDragMove);
                    window.removeEventListener('mouseup', handleRightDragUp);
                };
            }, [handleRightDragMove, handleRightDragUp]);

            const totalHeight = HEADER_HEIGHT + SONG_MODE_TRACKS.length * cellHeight;

            const renderGrid = () => (
                <div ref={gridRef} className="relative" style={{ width: Math.max(totalWidth, 760), height: totalHeight }} role="grid" aria-label="Song arrangement grid" aria-describedby="song-mode-kbd-hint">
                    <p id="song-mode-kbd-hint" className="sr-only">
                        Arrow keys move between cells. Up and down change the pattern number. Space or Enter toggles a cell. Shift plus arrow extends the selection.
                    </p>
                    <div className="absolute left-0 top-0 h-[30px] flex border-b border-gray-800" role="row">
                        <div style={{ width: ROW_HEADER_WIDTH }} className="shrink-0 bg-[#0b0d10] z-10 sticky left-0 border-r border-gray-800" role="columnheader" />
                        {songStructure.map((_, i) => (
                            <button
                                key={i}
                                type="button"
                                ref={(el) => {
                                    headerCellRefs.current[i] = el;
                                }}
                                style={{ width: cellWidth }}
                                className={`shrink-0 flex items-center justify-center text-[10px] font-mono border-r border-gray-800/30 cursor-pointer hover:bg-gray-800/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500 ${
                                    i === currentSongStep ? 'bg-cyan-900/20 text-cyan-400 font-bold' : 'text-gray-600'
                                }`}
                                onClick={(e) => handleMeasureHeaderClick(i, e)}
                                aria-label={`Measure ${i + 1}${i === currentSongStep ? ', current playhead' : ''}`}
                            >
                                {i + 1}
                            </button>
                        ))}
                    </div>
                    <div className="absolute left-0 top-[30px]">
                        {SONG_MODE_TRACKS.map((row) => (
                            <div key={row.key} className="flex" style={{ height: cellHeight }} role="row">
                                <div
                                    style={{ width: ROW_HEADER_WIDTH }}
                                    className="shrink-0 bg-[#0b0d10] border-r border-gray-800 flex items-center px-2 sticky left-0 z-10"
                                    role="rowheader"
                                >
                                    <span className="text-[10px] font-bold tracking-wider" style={{ color: row.color }}>
                                        {row.label}
                                    </span>
                                </div>
                                {songStructure.map((step, sIdx) => {
                                    const val = step[row.key] ?? null;
                                    const run = getPatternRun(songStructure, sIdx, row.key);
                                    const showRun = run && run.start === sIdx && run.length > 1 ? run.length : null;
                                    return (
                                        <SongModeCell
                                            key={`${row.key}-${sIdx}`}
                                            ref={(node) => {
                                                if (node) songModeCellRefs.current.set(`${row.key}-${sIdx}`, node);
                                                else songModeCellRefs.current.delete(`${row.key}-${sIdx}`);
                                            }}
                                            sIdx={sIdx}
                                            rowKey={row.key}
                                            rowLabel={row.label}
                                            val={val}
                                            cellWidth={cellWidth}
                                            cellHeight={cellHeight}
                                            isSelected={selection.has(cellId(sIdx, row.key))}
                                            runLength={showRun}
                                            onPointerDown={handleCellPointerDown}
                                            onKeyDown={handleCellKeyDown}
                                            onDoubleClick={handleCellDoubleClick}
                                            tabIndex={
                                                focusedCell.measure === sIdx && focusedCell.track === row.key ? 0 : -1
                                            }
                                        />
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                    <div
                        ref={(el) => {
                            playheadLineRefs.current[0] = el;
                        }}
                        className="absolute top-0 bottom-0 w-[2px] bg-cyan-500/50 pointer-events-none z-20"
                        style={{ left: ROW_HEADER_WIDTH + currentSongStep * cellWidth }}
                    />
                    {marquee && (
                        <div
                            className="fixed border border-cyan-400/70 bg-cyan-400/10 pointer-events-none z-50"
                            style={{
                                left: Math.min(marquee.x0, marquee.x1),
                                top: Math.min(marquee.y0, marquee.y1),
                                width: Math.abs(marquee.x1 - marquee.x0),
                                height: Math.abs(marquee.y1 - marquee.y0),
                            }}
                        />
                    )}
                </div>
            );

            const headerControls = (
                <>
                    <SongModeToolbar
                        selectionCount={selection.size}
                        canUndo={canUndoSong}
                        canRedo={canRedoSong}
                        compact={isCompact}
                        {...toolbarActions}
                    />
                    {!is3D && (
                        <div className="flex items-center gap-2 mr-2 bg-gray-900/50 p-1 rounded border border-gray-800">
                            <span className="text-[10px] text-gray-500 font-mono" id="bg-img-label">
                                BG IMG:
                            </span>
                            <input
                                type="text"
                                value={backgroundImage}
                                onChange={(e) => onSetBackgroundImage(e.target.value)}
                                placeholder="https://..."
                                aria-labelledby="bg-img-label"
                                className="w-32 bg-transparent text-xs text-cyan-300 focus:outline-none border-b border-gray-700 focus:border-cyan-500 font-mono"
                            />
                            {backgroundImage && (
                                <button
                                    type="button"
                                    onClick={() => onSetBackgroundImage('')}
                                    className="text-gray-500 hover:text-white px-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded"
                                    aria-label="Clear Background Image"
                                >
                                    <span aria-hidden="true">✕</span>
                                </button>
                            )}
                        </div>
                    )}
                    <button type="button" onClick={onRemoveMeasure} aria-label="Remove last measure" title="Remove last measure" className="px-3 py-1.5 bg-gray-800 text-gray-300 text-xs rounded-lg border border-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
                        - BAR
                    </button>
                    <button type="button" onClick={onAddMeasure} aria-label="Add measure" title="Add measure" className="px-3 py-1.5 bg-gray-800 text-cyan-300 text-xs rounded-lg border border-cyan-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
                        + BAR
                    </button>
                    <button
                        type="button"
                        onClick={() => onSetIsSongModeActive(!isSongModeActive)}
                        aria-pressed={isSongModeActive}
                        aria-label={isSongModeActive ? 'Loop Song Mode Active' : 'Loop Pattern Mode Active'}
                        className={`px-3 py-1.5 text-xs rounded-lg border font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${isSongModeActive ? 'bg-purple-600 text-white border-purple-400' : 'bg-gray-800 text-gray-400 border-gray-700'}`}
                    >
                        {isSongModeActive ? 'LOOP SONG' : 'LOOP PATT'}
                    </button>
                </>
            );

            const menuOverlay =
                menu && (
                    <PatternSelector
                        x={menu.x}
                        y={menu.y}
                        currentPattern={menu.currentVal}
                        onSelect={(val) => {
                            if (selection.size > 1) {
                                applyStructure((prev) => bulkSetPattern(prev, selection, val));
                            } else {
                                setCellValue(menu.sIdx, menu.track, val);
                            }
                            setMenu(null);
                        }}
                        onClose={() => setMenu(null)}
                    />
                );

            const dragGhostOverlay =
                dragGhost && (
                    <div
                        className="fixed z-[100] pointer-events-none px-2 py-1 rounded text-[10px] font-bold text-black shadow-lg border border-cyan-400/50"
                        style={{
                            left: dragGhost.x + 12,
                            top: dragGhost.y + 12,
                            backgroundColor: dragGhost.value !== null ? getPatternColor(dragGhost.value) : '#374151',
                        }}
                    >
                        {dragGhost.value !== null ? `P${dragGhost.value + 1}` : '—'}
                    </div>
                );

            if (is3D) {
                return (
                    <div className="w-full h-full flex flex-col bg-[#0a0d10]">
                        {menuOverlay}
                        {dragGhostOverlay}
                        <div className="h-14 bg-gradient-to-r from-[#0b0d10] to-[#0d0f12] border-b-2 border-cyan-900/30 flex items-center justify-between px-4 shrink-0 gap-2 flex-wrap">
                            <h2 className="font-orbitron font-bold text-cyan-400 tracking-widest">SONG ARRANGER</h2>
                            <div className="flex gap-2 items-center flex-wrap justify-end">{headerControls}</div>
                        </div>
                        <div className="flex-1 overflow-auto p-6 custom-scrollbar bg-gradient-to-b from-[#0a0d10] to-[#080a0b]">{renderGrid()}</div>
                    </div>
                );
            }

            return (
                <div
                    className={`fixed z-40 bg-gradient-to-br from-[#0a0d10] to-[#080a0b] border-r-2 border-cyan-900/30 transition-all duration-300 overflow-hidden flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.9)] backdrop-blur-sm touch-pan-x hyphon-song-mode-panel ${
                        isVisible
                            ? isCompact
                                ? 'inset-x-0 top-12 bottom-24 w-full max-w-full opacity-100'
                                : 'left-0 top-16 bottom-[320px] w-[850px] opacity-100'
                            : 'w-0 opacity-0 pointer-events-none'
                    }`}
                >
                    {menuOverlay}
                    {dragGhostOverlay}
                    <div className="absolute top-0 bottom-0 right-0 w-px bg-gradient-to-b from-cyan-500/30 via-transparent to-cyan-500/30 pointer-events-none" />
                    <div className="min-h-14 bg-gradient-to-r from-[#0b0d10] to-[#0d0f12] border-b-2 border-cyan-900/30 flex flex-col gap-2 px-4 py-2 shrink-0 shadow-lg relative">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <h2 className="font-orbitron font-bold text-cyan-400 tracking-widest drop-shadow-[0_0_8px_rgba(6,182,212,0.4)]">SONG ARRANGER</h2>
                            <div className="flex gap-2 items-center flex-wrap justify-end">
                                {headerControls}
                                <button
                                    type="button"
                                    onClick={async () => {
                                        if (isExporting) return;
                                        setIsExporting(true);
                                        try {
                                            await onExportXM();
                                        } finally {
                                            setIsExporting(false);
                                        }
                                    }}
                                    disabled={isExporting}
                                    aria-label="Export as XM file"
                                    className={`px-4 py-1.5 flex items-center justify-center min-w-[100px] bg-gradient-to-r text-cyan-400 text-xs font-bold border border-cyan-700/50 rounded-lg transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${
                                        isExporting ? 'opacity-70 cursor-wait' : 'hover:from-cyan-800/60'
                                    }`}
                                    aria-busy={isExporting}
                                >
                                    {isExporting ? 'EXPORTING...' : 'EXPORT XM'}
                                </button>
                                <button type="button" onClick={onToggle} aria-label="Close Song Mode" className="text-gray-400 hover:text-white text-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded px-1">
                                    <span aria-hidden="true">✕</span>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="flex-1 overflow-auto p-6 custom-scrollbar bg-gradient-to-b from-[#0a0d10] to-[#080a0b]">{renderGrid()}</div>
                </div>
            );
        },
    ),
);
