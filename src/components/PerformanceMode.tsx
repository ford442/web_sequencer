// PerformanceMode — full-screen reactive step grid overlay.
//
// Shows a 4×8 grid of large circles (32 steps: 2 rows × 16) with per-track
// color and beat-reactive animations. Intended for live performance where the
// primary need is visual feedback rather than parameter editing.
//
// Architecture:
// - Uses the same imperative DOM-mutation pattern as SequencerRow: the parent
//   calls handle.setStep(step) from the existing onStep callback path,
//   avoiding any React re-renders during playback.
// - Level meter drawn via Canvas, driven by useLevelMeter.
// - Keyboard shortcut: Ctrl/Cmd+Shift+P (managed by the parent calling setOpen).

import React, {
    memo, forwardRef, useImperativeHandle,
    useRef, useEffect, useCallback,
} from 'react';
import { LevelMeter } from './LevelMeter';

// ── Track definitions ─────────────────────────────────────────────────────────

interface TrackDef {
    key: string;
    label: string;
    color: string;
}

const TRACKS: TrackDef[] = [
    { key: 'partA',     label: 'LEAD',  color: '#06b6d4' },
    { key: 'partB',     label: 'BASS',  color: '#d946ef' },
    { key: 'kick',      label: 'KICK',  color: '#f97316' },
    { key: 'snare',     label: 'SNR',   color: '#22c55e' },
    { key: 'closedHat', label: 'CH',    color: '#eab308' },
    { key: 'openHat',   label: 'OH',    color: '#f59e0b' },
    { key: 'sampler',   label: 'SMP',   color: '#a855f7' },
];

const STEPS = 32;

// ── Handle interface ──────────────────────────────────────────────────────────

export interface PerformanceModeHandle {
    /** Called from the step callback path — triggers DOM mutations, no React renders. */
    setStep: (step: number) => void;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface PerformanceModeProps {
    isOpen: boolean;
    onClose: () => void;
    analyserNode?: AnalyserNode | null;
    /** Which steps are active per track key (derived from pattern). */
    activeSteps?: Partial<Record<string, boolean[]>>;
    tempo?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const PerformanceMode = memo(forwardRef<PerformanceModeHandle, PerformanceModeProps>((
    { isOpen, onClose, analyserNode, activeSteps = {}, tempo = 120 },
    ref,
) => {
    const stepCircleRefs = useRef<(HTMLDivElement | null)[][]>(
        TRACKS.map(() => Array(STEPS).fill(null)),
    );
    const beatBarRef = useRef<HTMLDivElement | null>(null);
    const lastStepRef = useRef(-1);

    useImperativeHandle(ref, () => ({
        setStep(step: number) {
            if (!isOpen) return;

            // Remove highlight from previous step across all tracks
            const prev = lastStepRef.current;
            if (prev >= 0) {
                for (let t = 0; t < TRACKS.length; t++) {
                    stepCircleRefs.current[t]?.[prev]?.classList.remove('pm-current');
                }
            }

            // Add highlight to new step
            if (step >= 0) {
                for (let t = 0; t < TRACKS.length; t++) {
                    stepCircleRefs.current[t]?.[step]?.classList.add('pm-current');
                }
            }

            // Animate the beat bar on every beat (steps 0, 4, 8, 12, …)
            if (step % 4 === 0 && beatBarRef.current) {
                beatBarRef.current.classList.remove('pm-beat-flash');
                // Trigger reflow so the animation restarts cleanly.
                void beatBarRef.current.offsetWidth;
                beatBarRef.current.classList.add('pm-beat-flash');
            }

            lastStepRef.current = step;
        },
    }), [isOpen]);

    // Reset highlights when closed.
    useEffect(() => {
        if (!isOpen) {
            for (let t = 0; t < TRACKS.length; t++) {
                for (let s = 0; s < STEPS; s++) {
                    stepCircleRefs.current[t]?.[s]?.classList.remove('pm-current');
                }
            }
            lastStepRef.current = -1;
        }
    }, [isOpen]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
    }, [onClose]);

    if (!isOpen) return null;

    const stepDuration = 60 / (tempo * 4);
    const animDuration = `${(stepDuration * 0.8 * 1000).toFixed(0)}ms`;

    return (
        <div
            className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center gap-6 select-none"
            role="dialog"
            aria-modal="true"
            aria-label="Performance Mode"
            tabIndex={-1}
            onKeyDown={handleKeyDown}
        >
            {/* Beat bar — flashes on every beat */}
            <div
                ref={beatBarRef}
                className="pm-beat-bar w-full h-0.5 absolute top-0 left-0 bg-white/0"
                style={{ '--pm-anim-dur': animDuration } as React.CSSProperties}
            />

            {/* Header */}
            <div className="absolute top-4 right-4 flex items-center gap-4">
                <span className="text-zinc-500 font-mono text-xs uppercase tracking-widest">
                    Performance Mode
                </span>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Exit performance mode"
                    className="text-zinc-500 hover:text-white transition-colors font-mono text-xs border border-zinc-700 hover:border-zinc-400 px-2 py-1 rounded"
                >
                    ESC
                </button>
            </div>

            {/* Level meter */}
            <div className="absolute top-4 left-6 flex items-center gap-2">
                <span className="text-zinc-600 font-mono text-[9px] uppercase tracking-widest">Level</span>
                <LevelMeter
                    analyserNode={analyserNode}
                    segments={16}
                    width={160}
                    height={6}
                />
            </div>

            {/* Track grids */}
            <div className="flex flex-col gap-4 w-full max-w-5xl px-8">
                {TRACKS.map((track, trackIdx) => {
                    const steps = activeSteps[track.key] ?? Array(STEPS).fill(false);
                    return (
                        <div key={track.key} className="flex items-center gap-3">
                            {/* Track label */}
                            <div
                                className="w-14 text-right font-mono text-xs font-bold uppercase tracking-widest"
                                style={{ color: track.color }}
                            >
                                {track.label}
                            </div>

                            {/* Step circles */}
                            <div className="flex gap-1.5 flex-1">
                                {Array.from({ length: STEPS }, (_, stepIdx) => {
                                    const isActive = steps[stepIdx] ?? false;
                                    const isBeat = stepIdx % 4 === 0;
                                    return (
                                        <div
                                            key={stepIdx}
                                            ref={(el) => {
                                                if (!stepCircleRefs.current[trackIdx]) return;
                                                stepCircleRefs.current[trackIdx]![stepIdx] = el;
                                            }}
                                            className="pm-step flex-1 aspect-square rounded-sm transition-none"
                                            data-active={isActive ? 'true' : undefined}
                                            data-beat={isBeat ? 'true' : undefined}
                                            style={{
                                                '--track-color': track.color,
                                                backgroundColor: isActive ? track.color + '60' : isBeat ? '#1a2026' : '#111518',
                                                boxShadow: isActive ? `0 0 4px ${track.color}40` : 'none',
                                            } as React.CSSProperties}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Tempo + position indicator */}
            <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                <span className="text-zinc-700 font-mono text-xs tabular-nums">
                    {tempo} BPM
                </span>
            </div>

            {/* Injected CSS — scoped to this overlay */}
            <style>{`
                @keyframes pm-beat-flash-kf {
                    0%   { background: rgba(255,255,255,0.9); }
                    100% { background: rgba(255,255,255,0); }
                }
                .pm-beat-flash {
                    animation: pm-beat-flash-kf var(--pm-anim-dur, 150ms) ease-out forwards;
                }

                @keyframes pm-step-fire-kf {
                    0%   { opacity: 1; transform: scale(1.15); }
                    60%  { opacity: 0.9; transform: scale(1.05); }
                    100% { opacity: 1; transform: scale(1); }
                }
                .pm-step.pm-current {
                    background-color: var(--track-color) !important;
                    box-shadow: 0 0 12px var(--track-color), 0 0 24px var(--track-color, #fff)40 !important;
                    animation: pm-step-fire-kf 120ms ease-out forwards;
                }
                .pm-step.pm-current[data-active='true'] {
                    box-shadow: 0 0 16px var(--track-color), 0 0 32px var(--track-color) !important;
                }
            `}</style>
        </div>
    );
}));

PerformanceMode.displayName = 'PerformanceMode';
