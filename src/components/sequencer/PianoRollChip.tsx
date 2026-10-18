import { memo, useCallback } from 'react';
import type { TrackKey } from '../../types';
import { isPianoRollTrack, pianoRollStore, usePianoRollStore } from '../../stores/pianoRollStore';
import { samplerBanksStore } from '../../stores/samplerBanksStore';

/**
 * "Open piano roll" chip for a melodic row header (#1345 Phase 1).
 *
 * Sits above the M/S pads and uses the same bevelled-pad idiom. It writes the
 * piano-roll store directly, so nothing threads through MainSequencer; the
 * roll itself is a lazy chunk that loads on first open. The sampler row opens
 * the bank that is active when the chip is pressed.
 */

const WIDTH = 28;
const HEIGHT = 13;
const ENGAGED = '#a855f7';

export interface PianoRollChipProps {
    trackKey: TrackKey;
    /** Row label ("Lead", "SMP 3", …) used to build the accessible name. */
    label: string;
}

export const PianoRollChip = memo(({ trackKey, label }: PianoRollChipProps) => {
    const engaged = usePianoRollStore((s) => s.open?.track === trackKey);

    const activate = useCallback((e: React.PointerEvent | React.KeyboardEvent) => {
        // Row headers select the track on click; a chip press must not do that too.
        e.stopPropagation();
        e.preventDefault();
        if (!isPianoRollTrack(trackKey)) return;
        const bank = trackKey === 'sampler' ? samplerBanksStore.getSnapshot().activeSamplerBank : 0;
        pianoRollStore.toggle(trackKey, bank);
    }, [trackKey]);

    if (!isPianoRollTrack(trackKey)) return null;

    return (
        <g
            className="track-piano-roll"
            role="button"
            tabIndex={0}
            aria-label={engaged ? `Close ${label} piano roll` : `Open ${label} piano roll`}
            aria-pressed={engaged}
            data-testid={`piano-roll-${trackKey}`}
            cursor="pointer"
            onPointerDown={activate}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') activate(e);
            }}
            onContextMenu={(e) => e.preventDefault()}
            style={{ touchAction: 'manipulation' }}
        >
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={2} fill="#050505" />
            <rect
                x={1}
                y={1}
                width={WIDTH - 2}
                height={HEIGHT - 2}
                rx={2}
                fill={engaged ? ENGAGED : '#1a2026'}
                fillOpacity={engaged ? 0.55 : 1}
            />
            {/* Bevel: top-left highlight, bottom-right shadow (same model as SvgStep). */}
            <path
                d={`M 1 1 L ${WIDTH - 1} 1 L ${WIDTH - 2} 2 L 2 2 L 2 ${HEIGHT - 2} L 1 ${HEIGHT - 1} Z`}
                fill="rgba(255,255,255,0.2)"
                pointerEvents="none"
            />
            <path
                d={`M ${WIDTH - 1} 1 L ${WIDTH - 1} ${HEIGHT - 1} L 1 ${HEIGHT - 1} L 2 ${HEIGHT - 2} L ${WIDTH - 2} ${HEIGHT - 2} L ${WIDTH - 2} 2 Z`}
                fill="rgba(0,0,0,0.5)"
                pointerEvents="none"
            />
            {/* Three mini note bars: the roll's own glyph. */}
            {[0, 1, 2].map((i) => (
                <rect
                    key={i}
                    x={5 + i * 6}
                    y={HEIGHT - 4 - i * 2.5}
                    width={6}
                    height={1.6}
                    rx={0.5}
                    fill={engaged ? '#050505' : '#8b7aa8'}
                    pointerEvents="none"
                />
            ))}
        </g>
    );
});
