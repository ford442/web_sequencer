import { memo, forwardRef, useRef, useImperativeHandle } from 'react';
import type { ReactNode } from 'react';
import type { Pattern, TrackKey, PartSequence } from '../../types';
import { SequencerRow } from './SequencerRow';
import type { SequencerRowHandle } from './SequencerRow';
import { ROWS } from './constants';

export interface SequencerHandle {
    setHighlight: (step: number) => void;
}

interface SequencerProps {
    pattern: Pattern;
    activeSamplerBank: number;
    selectedTrack: TrackKey;
    activeTrackSlots: Record<TrackKey, number>;
    trackStorage: Record<TrackKey, (PartSequence | PartSequence[] | null)[]>;
    selection: { trackKey: TrackKey; startStep: number; endStep: number; } | null;
    isDrawing: boolean;

    onToggle: (k: TrackKey, i: number, e: any) => void;
    onRightMouseDown: (k: TrackKey, i: number, e: any) => void;
    onEditLength: (k: TrackKey, i: number, len: number) => void;
    onSelectRow: (k: TrackKey) => void;
    onSelectSlot: (k: TrackKey, slot: number) => void;
    onSelectionStart: (k: TrackKey, i: number) => void;
    onSelectionEnter: (k: TrackKey, i: number) => void;
    onDrawEnter: (k: TrackKey, i: number) => void;

    children?: ReactNode;
}

export const Sequencer = memo(forwardRef<SequencerHandle, SequencerProps>((props, ref) => {
    const {
        pattern, activeSamplerBank, selectedTrack, activeTrackSlots, trackStorage, selection, isDrawing,
        onToggle, onRightMouseDown, onEditLength, onSelectRow, onSelectSlot, onSelectionStart, onSelectionEnter, onDrawEnter,
        children
    } = props;

    const rowRefs = useRef<(SequencerRowHandle | null)[]>([]);

    useImperativeHandle(ref, () => ({
        setHighlight: (step: number) => {
            rowRefs.current.forEach(r => r?.setHighlight(step));
        }
    }));

    return (
        <div className="w-full h-full p-4 bg-[#0a0d10] rounded-xl border-2 border-gray-700 shadow-2xl relative">
            <div className="absolute inset-0 rounded-xl border-2 border-cyan-900/10 pointer-events-none"></div>
            {/* Screws */}
            <div className="absolute top-3 left-3 w-4 h-4 rounded-full bg-gray-800 flex items-center justify-center border border-gray-600"><div className="w-2.5 h-[1.5px] bg-gray-600 rotate-45"></div></div>
            <div className="absolute top-3 right-3 w-4 h-4 rounded-full bg-gray-800 flex items-center justify-center border border-gray-600"><div className="w-2.5 h-[1.5px] bg-gray-600 rotate-45"></div></div>
            <div className="absolute bottom-3 left-3 w-4 h-4 rounded-full bg-gray-800 flex items-center justify-center border border-gray-600"><div className="w-2.5 h-[1.5px] bg-gray-600 rotate-45"></div></div>
            <div className="absolute bottom-3 right-3 w-4 h-4 rounded-full bg-gray-800 flex items-center justify-center border border-gray-600"><div className="w-2.5 h-[1.5px] bg-gray-600 rotate-45"></div></div>

            <svg aria-hidden="true" viewBox="0 0 1050 420" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" onContextMenu={(e) => e.preventDefault()}>
                <defs><linearGradient id="glassGrad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="white" stopOpacity="0.5" /><stop offset="100%" stopColor="white" stopOpacity="0" /></linearGradient></defs>
                <g transform="translate(100, 40)">
                    {ROWS.map((row, rIdx) => (
                        <SequencerRow
                            key={row.key}
                            ref={(el) => { rowRefs.current[rIdx] = el; }}
                            rowKey={row.key}
                            label={row.key === 'sampler' ? `SMP ${activeSamplerBank + 1}` : row.label}
                            rowIndex={rIdx}
                            steps={(row.key === 'sampler' ? pattern.sampler[activeSamplerBank].steps : (pattern as any)[row.key].steps)}
                            isSelected={selectedTrack === row.key}
                            activeSlot={activeTrackSlots[row.key]}
                            trackSlots={trackStorage[row.key]}
                            onToggle={onToggle}
                            onRightMouseDown={onRightMouseDown}
                            onEditLength={onEditLength}
                            onSelectRow={onSelectRow}
                            onSelectSlot={onSelectSlot}
                            onSelectionStart={onSelectionStart}
                            onSelectionEnter={onSelectionEnter}
                            selectionRange={selection && selection.trackKey === row.key ? { start: selection.startStep, end: selection.endStep } : null}
                            onDrawEnter={onDrawEnter}
                            isDrawing={isDrawing}
                        />
                    ))}
                </g>
            </svg>
            {children}
        </div>
    );
}));
