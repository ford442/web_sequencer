import React, { memo, useLayoutEffect, useRef } from 'react';
import { KNOB_MATERIAL_CHASSIS } from '../knobMaterial';
import { getPrefersReducedMotion } from '../knobMotion';
import { ChassisKnobMaterialContext } from './chassisContext';
import { CHASSIS_MODES, getChassisFootprint, type ChassisMode } from './chassisModes';

const PANEL_ENTER: Keyframe[] = [
    { opacity: 0, transform: 'translateY(10px) scale(0.985)' },
    { opacity: 1, transform: 'none' },
];
const PANEL_ENTER_OPTIONS: KeyframeAnimationOptions = {
    duration: 360,
    easing: 'cubic-bezier(0.22, 0.9, 0.24, 1)',
};

export interface HardwareChassisProps {
    /** Interface the stage is showing; drives the footprint and the LCD badge. */
    mode: ChassisMode;
    /**
     * Identity of the hosted panel. A change replays the entry motion without
     * remounting the stage content (e.g. Synth A → Synth B, both `osc`).
     * @default mode
     */
    panelKey?: string;
    /** Mode keys shown in the head. Omit (or omit `onModeChange`) for no switcher. */
    modes?: readonly ChassisMode[];
    onModeChange?: (mode: ChassisMode) => void;
    /** Extra LCD text after the mode code, e.g. "SYNTH A · JS/TS". */
    badgeDetail?: string;
    /** Small glyph in the LCD badge (e.g. an OscillatorSignatureIcon). */
    badgeIcon?: React.ReactNode;
    /** LCD text colour. @default red LED */
    badgeAccent?: string;
    /** Fixed top anchor — the LED step strip / sequencer well. */
    ledStrip: React.ReactNode;
    /** Fixed bottom anchor — the key bed. */
    keybed?: React.ReactNode;
    /** Stage content for the current mode. */
    children: React.ReactNode;
    compact?: boolean;
    /** Override the mode's stage height (px). */
    stageHeight?: number;
    brand?: string;
    className?: string;
    'aria-label'?: string;
}

/**
 * The transforming white hardware chassis (#1584): one rounded body with a
 * fixed LED strip on top and a key bed at the bottom. Only the stage between
 * them morphs — height and body width transition per mode — so switching
 * between oscillator, sampler, TTS, Voice Designer or PCF panels reads as one
 * instrument reconfiguring itself rather than separate floating panels.
 *
 * Everything inside the stage sees `KNOB_MATERIAL_CHASSIS` through
 * ChassisKnobMaterialContext and `data-chassis="white"` tokens from CSS.
 */
export const HardwareChassis = memo(({
    mode,
    panelKey,
    modes,
    onModeChange,
    badgeDetail,
    badgeIcon,
    badgeAccent,
    ledStrip,
    keybed,
    children,
    compact = false,
    stageHeight,
    brand = 'HYPHON',
    className = '',
    'aria-label': ariaLabel,
}: HardwareChassisProps) => {
    const spec = CHASSIS_MODES[mode];
    const footprint = getChassisFootprint(mode, compact);
    const panelRef = useRef<HTMLDivElement>(null);
    const identity = panelKey ?? mode;
    const lastIdentityRef = useRef(identity);

    // Entry motion on panel change. WAAPI (not a keyed remount) keeps the hosted
    // panel's state and GPU knob slots alive. Reduced motion skips it entirely.
    useLayoutEffect(() => {
        if (lastIdentityRef.current === identity) return;
        lastIdentityRef.current = identity;
        const el = panelRef.current;
        if (!el || typeof el.animate !== 'function' || getPrefersReducedMotion()) return;
        const animation = el.animate(PANEL_ENTER, PANEL_ENTER_OPTIONS);
        return () => animation.cancel();
    }, [identity]);

    const style = {
        '--chassis-stage-h': `${stageHeight ?? footprint.stageHeight}px`,
        '--chassis-max-w': `${footprint.maxWidth}px`,
    } as React.CSSProperties;

    return (
        <section
            data-chassis="white"
            data-chassis-mode={mode}
            className={`hyphon-chassis chassis-body ${className}`}
            style={style}
            aria-label={ariaLabel ?? `${brand} hardware chassis`}
        >
            <header className="hyphon-chassis__head">
                <span className="hyphon-chassis__brand">{brand}</span>
                <span className="chassis-print-rule hyphon-chassis__rule" aria-hidden="true" />
                {modes && onModeChange && (
                    <div className="hyphon-chassis__modes" role="group" aria-label="Chassis panel">
                        {modes.map((m) => (
                            <button
                                key={m}
                                type="button"
                                className="hyphon-chassis__mode-btn"
                                aria-pressed={m === mode}
                                title={CHASSIS_MODES[m].label}
                                data-testid={`chassis-mode-${m}`}
                                onClick={() => onModeChange(m)}
                            >
                                {CHASSIS_MODES[m].code}
                            </button>
                        ))}
                    </div>
                )}
                <span
                    className="hyphon-chassis__badge"
                    role="status"
                    aria-label={`${spec.label}${badgeDetail ? `: ${badgeDetail}` : ''}`}
                    data-testid="chassis-mode-badge"
                    style={badgeAccent ? ({ '--chassis-badge-accent': badgeAccent } as React.CSSProperties) : undefined}
                >
                    {badgeIcon}
                    <span className="hyphon-chassis__badge-code">{spec.code}</span>
                    {badgeDetail && <span>{badgeDetail}</span>}
                </span>
            </header>

            <div className="hyphon-chassis__strip chassis-well">{ledStrip}</div>

            <div className="hyphon-chassis__stage" data-testid="chassis-stage">
                <div ref={panelRef} className="hyphon-chassis__panel">
                    <ChassisKnobMaterialContext.Provider value={KNOB_MATERIAL_CHASSIS}>
                        {children}
                    </ChassisKnobMaterialContext.Provider>
                </div>
            </div>

            {keybed && <div className="hyphon-chassis__keybed chassis-well">{keybed}</div>}
        </section>
    );
});

HardwareChassis.displayName = 'HardwareChassis';
