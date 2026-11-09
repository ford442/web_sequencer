import React, { memo } from 'react';

interface ChassisLedStripProps {
    /** One entry per step; `true` lights the pad. */
    steps: readonly boolean[];
    /** Step under the playhead, if any. */
    playhead?: number | null;
    /** Pad glow colour (any CSS colour). @default cyan accent */
    accent?: string;
    /** Print step numbers under the pads. */
    showNumbers?: boolean;
    'aria-label'?: string;
}

/**
 * Silicone LED step strip for the chassis top anchor (#1589 pad material).
 * Presentational only: lit / playhead state are `data-on` / `data-playhead`
 * attributes so the CSS material owns every visual, and nothing here owns
 * playback timing. The live app puts the real sequencer in this slot instead.
 */
export const ChassisLedStrip = memo(({
    steps,
    playhead = null,
    accent,
    showNumbers = false,
    'aria-label': ariaLabel,
}: ChassisLedStripProps) => {
    const active = steps.reduce((n, on) => n + (on ? 1 : 0), 0);
    const style = {
        '--chassis-led-count': steps.length,
        ...(accent ? { '--pad-color': accent } : {}),
    } as React.CSSProperties;
    return (
        <div>
            <div
                className="chassis-led-strip"
                style={style}
                role="img"
                aria-label={ariaLabel ?? `${steps.length}-step pattern, ${active} steps on`}
            >
                {steps.map((on, i) => (
                    <span
                        // Steps are positional; index is the identity.
                        key={i}
                        className="pad"
                        data-on={on || undefined}
                        data-playhead={i === playhead || undefined}
                    />
                ))}
            </div>
            {showNumbers && (
                <div className="chassis-led-strip__numbers" style={style} aria-hidden="true">
                    {steps.map((_, i) => (
                        <span key={i}>{i % 4 === 0 ? i + 1 : ''}</span>
                    ))}
                </div>
            )}
        </div>
    );
});

ChassisLedStrip.displayName = 'ChassisLedStrip';
