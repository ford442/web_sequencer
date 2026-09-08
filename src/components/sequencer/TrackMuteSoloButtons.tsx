import { memo, useCallback } from 'react';
import type { TrackKey } from '../../types';
import { trackMuteSoloStore, useTrackMuteSolo } from '../../stores/trackMuteSoloStore';

/**
 * M / S pads for a sequencer row header.
 *
 * These live inside the row's SVG, so they follow the in-SVG hardware idiom of
 * `SvgStep` (dark body, top-left highlight + bottom-right shadow bevel, LED bar)
 * rather than the DOM `LedIndicator` from `ui/PanelChrome.tsx`. Lighting matches
 * the rest of the panel: light from top-left.
 *
 * The component reads the store directly, so no mute/solo props thread through
 * MainSequencer → SequencerRowWrapper → SequencerRow.
 */

const PAD = 13;
const GAP = 2;

/** Amber matches the slide indicator in SvgStep; cyan is --hyphon-accent. */
const MUTE_ON = '#fbbf24';
const SOLO_ON = '#06b6d4';

interface PadProps {
    x: number;
    letter: 'M' | 'S';
    color: string;
    engaged: boolean;
    label: string;
    testId: string;
    onToggle: () => void;
}

const Pad = memo(({ x, letter, color, engaged, label, testId, onToggle }: PadProps) => {
    const activate = useCallback(
        (e: React.PointerEvent | React.KeyboardEvent) => {
            // Row headers select the track on click; a pad press must not do that too.
            e.stopPropagation();
            e.preventDefault();
            onToggle();
        },
        [onToggle],
    );

    return (
        <g
            transform={`translate(${x}, 0)`}
            className="track-mute-solo"
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-pressed={engaged}
            data-testid={testId}
            cursor="pointer"
            onPointerDown={activate}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') activate(e);
            }}
            onContextMenu={(e) => e.preventDefault()}
            style={{ touchAction: 'manipulation' }}
        >
            {engaged && (
                <rect
                    className="pad-glow"
                    x={-3}
                    y={-3}
                    width={PAD + 6}
                    height={PAD + 6}
                    rx={5}
                    fill={color}
                    fillOpacity={0.35}
                    filter="blur(4px)"
                    pointerEvents="none"
                />
            )}
            <rect x={0} y={0} width={PAD} height={PAD} rx={2} fill="#050505" />
            <rect
                x={1}
                y={1}
                width={PAD - 2}
                height={PAD - 2}
                rx={2}
                fill={engaged ? color : '#1a2026'}
                fillOpacity={engaged ? 0.55 : 1}
            />
            {/* Bevel: top-left highlight, bottom-right shadow (same model as SvgStep). */}
            <path
                d={`M 1 1 L ${PAD - 1} 1 L ${PAD - 2} 2 L 2 2 L 2 ${PAD - 2} L 1 ${PAD - 1} Z`}
                fill="rgba(255,255,255,0.2)"
                pointerEvents="none"
            />
            <path
                d={`M ${PAD - 1} 1 L ${PAD - 1} ${PAD - 1} L 1 ${PAD - 1} L 2 ${PAD - 2} L ${PAD - 2} ${PAD - 2} L ${PAD - 2} 2 Z`}
                fill="rgba(0,0,0,0.5)"
                pointerEvents="none"
            />
            <text
                x={PAD / 2}
                y={PAD / 2 + 1.5}
                textAnchor="middle"
                fontSize={7}
                fontFamily="monospace"
                fontWeight="bold"
                fill={engaged ? '#050505' : '#5a6b60'}
                pointerEvents="none"
            >
                {letter}
            </text>
            {/* LED bar, mirroring the .step-led treatment. */}
            <rect
                className="pad-led"
                x={2}
                y={PAD - 2.5}
                width={PAD - 4}
                height={1.5}
                rx={0.75}
                fill={engaged ? color : '#000'}
                fillOpacity={engaged ? 0.9 : 0.2}
                pointerEvents="none"
            />
        </g>
    );
});

export interface TrackMuteSoloButtonsProps {
    trackKey: TrackKey;
    /** Row label ("Lead", "Kick", …) used to build the accessible names. */
    label: string;
}

export const TrackMuteSoloButtons = memo(({ trackKey, label }: TrackMuteSoloButtonsProps) => {
    const { muted, soloed, anySoloed } = useTrackMuteSolo();
    const isMuted = muted.includes(trackKey);
    const isSoloed = soloed.includes(trackKey);

    const toggleMute = useCallback(() => trackMuteSoloStore.toggleMute(trackKey), [trackKey]);
    const toggleSolo = useCallback(() => trackMuteSoloStore.toggleSolo(trackKey), [trackKey]);

    // A muted track that is not audible only because something else is soloed
    // reads as "silenced by solo" to a screen reader, not as muted.
    const silencedBySolo = anySoloed && !isSoloed;

    return (
        <g className="track-mute-solo-group">
            <Pad
                x={0}
                letter="M"
                color={MUTE_ON}
                engaged={isMuted}
                label={`Mute ${label} track`}
                testId={`mute-${trackKey}`}
                onToggle={toggleMute}
            />
            <Pad
                x={PAD + GAP}
                letter="S"
                color={SOLO_ON}
                engaged={isSoloed}
                label={`Solo ${label} track`}
                testId={`solo-${trackKey}`}
                onToggle={toggleSolo}
            />
            {silencedBySolo && (
                <title>{`${label} is silenced while another track is soloed`}</title>
            )}
        </g>
    );
});
