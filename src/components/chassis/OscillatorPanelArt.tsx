import React, { memo, useState } from 'react';
import type { OscillatorType } from '../../types';
import { OSCILLATOR_PANEL_FOCUS, OSCILLATOR_THEMES, oscillatorPanelImageUrl } from '../oscillatorThemes';

interface OscillatorPanelArtProps {
    type: OscillatorType;
    /**
     * `header`: a fixed-height faceplate window above the oscillator controls.
     * `backdrop`: fills the positioned parent (controls sit on top, CppPanel-style).
     * @default 'header'
     */
    variant?: 'header' | 'backdrop';
    /** Header height in px. @default 72 */
    height?: number;
    className?: string;
    children?: React.ReactNode;
}

/**
 * Signature panel artwork from `public/osc/*.webp` (#1583), one per oscillator
 * family via `OSCILLATOR_PANEL_IMAGES`. The `<img>` is keyed by family so a
 * type switch swaps the art with a short fade (no fade under reduced motion).
 * A missing file degrades to the plain themed well instead of a broken image.
 */
export const OscillatorPanelArt = memo(({
    type,
    variant = 'header',
    height = 72,
    className = '',
    children,
}: OscillatorPanelArtProps) => {
    const [failedType, setFailedType] = useState<OscillatorType | null>(null);
    const theme = OSCILLATOR_THEMES[type];
    const failed = failedType === type;
    const isHeader = variant === 'header';

    return (
        <div
            className={`${isHeader ? 'relative w-full rounded-lg shrink-0' : 'absolute inset-0'} overflow-hidden ${className}`}
            style={isHeader ? { height } : { borderRadius: 'inherit' }}
            data-testid="oscillator-panel-art"
            data-osc-type={type}
        >
            <div className={`hyphon-osc-art ${failed ? 'hyphon-osc-art--fallback' : ''}`}>
                {!failed && (
                    <img
                        key={type}
                        src={oscillatorPanelImageUrl(type)}
                        alt={`${theme.label} oscillator panel`}
                        className="hyphon-osc-art__img"
                        style={{ ['--osc-art-focus' as string]: OSCILLATOR_PANEL_FOCUS[type] }}
                        decoding="async"
                        draggable={false}
                        onError={() => setFailedType(type)}
                    />
                )}
                {!isHeader && <div className="hyphon-osc-art__scrim" aria-hidden="true" />}
                <div className="hyphon-osc-art__bezel" aria-hidden="true" />
            </div>
            {failed && isHeader && (
                <span className={`absolute inset-0 flex items-center justify-center font-orbitron text-sm tracking-widest ${theme.text}`}>
                    {theme.label.toUpperCase()}
                </span>
            )}
            {children && <div className="relative h-full">{children}</div>}
        </div>
    );
});

OscillatorPanelArt.displayName = 'OscillatorPanelArt';
