import { getNoteColor } from '../../utils/noteColors';

// --- PERFORMANCE STYLES ---
export const SEQUENCER_STYLES = `
    .svg-step.is-current .step-glow { fill: rgba(255, 255, 255, 0.3) !important; }
    .svg-step.is-current .step-cap { stroke: #ffffff !important; stroke-width: 2px !important; }
    .svg-step.is-current .step-led { fill: #ff3333 !important; fill-opacity: 1 !important; }

    /* Focus Styles for Accessibility */
    .svg-step:focus, .track-slot:focus, .track-label:focus { outline: none; }
    .svg-step:focus .step-cap { stroke: var(--focus-color, #22d3ee) !important; stroke-width: 2px !important; stroke-opacity: 1 !important; filter: drop-shadow(0 0 5px var(--focus-color, #22d3ee)); }
    .track-slot:focus rect { stroke: #22d3ee !important; stroke-width: 2px !important; stroke-opacity: 1 !important; filter: drop-shadow(0 0 5px #22d3ee); }
    .track-label:focus text { fill: #22d3ee !important; text-shadow: 0 0 8px rgba(34,211,238,0.8) !important; }
`;

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

export const getPatternColor = (slotIndex: number): string => {
    return getNoteColor(PATTERN_NOTES[slotIndex % PATTERN_NOTES.length]);
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
