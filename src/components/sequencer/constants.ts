import { getNoteColor } from '../../utils/noteColors';

// --- ZOOM CONSTANTS ---
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4.0;
export const DEFAULT_ZOOM = 1.0;
export const ZOOM_STEP = 0.1;

// --- PERFORMANCE STYLES ---
export const SEQUENCER_STYLES = `
    /*
     * Playhead. Only the note-fire flash on the glow animates. The cap stroke and
     * the LED used to pulse too, but they exist on every step and animate non-
     * compositable properties (stroke / fill), so while playing the whole 256-step
     * SVG was re-recorded and repainted on nearly every frame (~90% of main-thread
     * paint time in a playback trace). They now jump straight to their settled look.
     */
    @keyframes step-fire {
        0%   { fill: rgba(255,255,255,0.75); }
        40%  { fill: rgba(255,255,255,0.40); }
        100% { fill: rgba(255,255,255,0.18); }
    }

    .svg-step.is-current .step-glow {
        fill: rgba(255,255,255,0.18) !important;
        animation: step-fire 120ms ease-out forwards;
    }
    .svg-step.is-current .step-cap {
        stroke: #ffffff !important;
        stroke-width: 2px !important;
        stroke-opacity: 0.9 !important;
    }
    .svg-step.is-current .step-led {
        fill: #cc0000;
        fill-opacity: 1;
    }
    .svg-step[aria-pressed="true"].is-current .step-glow {
        fill: rgba(255,255,255,0.4) !important;
    }
    .automation-step.is-current rect { fill-opacity: 1 !important; filter: drop-shadow(0 0 4px white); }

    /* Focus Styles for Accessibility */
    .svg-step:focus, .track-slot:focus, .track-label:focus, .automation-step:focus { outline: none; }
    .svg-step:focus .step-cap { stroke: var(--focus-color, #22d3ee) !important; stroke-width: 2px !important; stroke-opacity: 1 !important; filter: drop-shadow(0 0 5px var(--focus-color, #22d3ee)); }
    .track-slot:focus rect { stroke: #22d3ee !important; stroke-width: 2px !important; stroke-opacity: 1 !important; filter: drop-shadow(0 0 5px #22d3ee); }
    .track-label:focus text { fill: #22d3ee !important; text-shadow: 0 0 8px rgba(34,211,238,0.8) !important; }
    .track-piano-roll:focus { outline: none; }
    .track-piano-roll:focus rect:first-child { stroke: #22d3ee; stroke-width: 2px; filter: drop-shadow(0 0 5px #22d3ee); }
`;

export const TRACK_COLORS: Record<string, string> = {
    partA: '#06b6d4',
    partB: '#d946ef',
    bass2: '#ff0066', // Hot pink for TB-303 style
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
    { key: 'bass2', label: 'Bass2' },
    { key: 'kick', label: 'Kick' },
    { key: 'snare', label: 'Snare' },
    { key: 'closedHat', label: 'CH' },
    { key: 'openHat', label: 'OH' },
    { key: 'sampler', label: 'SMP' },
] as const;
