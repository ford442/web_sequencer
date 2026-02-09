import type { PartSequence } from '../../types';

export type TrackKey = 'partA' | 'partB' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'sampler';

export const TRACK_COLORS: Record<string, string> = {
    partA: '#06b6d4',
    partB: '#d946ef',
    kick: '#f97316',
    snare: '#22c55e',
    closedHat: '#eab308',
    openHat: '#eab308',
    sampler: '#a855f7',
};

export const PATTERN_NOTES = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];

export interface SequencerRowHandle {
    setHighlight: (step: number) => void;
}

export interface SvgStepProps {
    stepIndex: number;
    active: boolean;
    note?: string | null;
    refsArray: React.MutableRefObject<(SVGGElement | null)[]>;
    rowLabel: string;
    rowKey: TrackKey;
    onToggle: (k: TrackKey, i: number, e: unknown) => void;
    onRightMouseDown: (k: TrackKey, i: number, e: React.MouseEvent) => void;
    onEditLength: (k: TrackKey, i: number, len: number) => void;
    length?: number;
    isSlide?: boolean;
    onSelectionStart?: (k: TrackKey, i: number) => void;
    onSelectionEnter?: (k: TrackKey, i: number) => void;
    isRangeSelected?: boolean;
}

export interface TrackSlotButtonProps {
    index: number;
    isActive: boolean;
    hasData: boolean;
    trackKey: TrackKey;
    onSelect: (k: TrackKey, i: number) => void;
}

export interface SequencerRowProps {
    rowKey: TrackKey;
    label: string;
    rowIndex: number;
    steps: (unknown | null)[];
    isSelected: boolean;
    activeSlot: number;
    trackSlots: (PartSequence | PartSequence[] | null)[];
    onToggle: (k: unknown, i: number, e: unknown) => void;
    onRightMouseDown: (k: TrackKey, i: number, e: unknown) => void;
    onEditLength: (k: TrackKey, i: number, len: number) => void;
    onSelectRow: (k: unknown) => void;
    onSelectSlot: (k: TrackKey, slot: number) => void;
    onSelectionStart?: (k: TrackKey, i: number) => void;
    onSelectionEnter?: (k: TrackKey, i: number) => void;
    selectionRange?: { start: number; end: number } | null;
}
