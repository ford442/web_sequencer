import React, { memo, useLayoutEffect, useRef } from 'react';
import { KNOB_MATERIAL_CHASSIS } from '../knobMaterial';
import { getPrefersReducedMotion } from '../knobMotion';
import { ChassisKnobMaterialContext } from './chassisContext';
import {
    CHASSIS_MODES,
    DEFAULT_SIDE_SECONDARY_SHARE,
    getChassisFootprint,
    type ChassisMode,
    type ChassisSecondaryPlacement,
} from './chassisModes';

/** Stage height / body width morph, in ms. Written to `--chassis-morph-duration`. */
export const CHASSIS_MORPH_MS = 420;
/**
 * Contents fade in once the size has settled (#1584: morphing size and content
 * together looks mushy). With the morph's ease-out curve the size is ~99%
 * there at 70% of the duration, so the fade starts at that point instead of
 * waiting for the last few sub-pixel frames.
 */
export const CHASSIS_CONTENT_DELAY_MS = 300;
const CONTENT_FADE_MS = 180;

/** Same-footprint panel change (Synth A → Synth B): a quick entry, no wait. */
const PANEL_ENTER: Keyframe[] = [
    { opacity: 0, transform: 'translateY(10px) scale(0.985)' },
    { opacity: 1, transform: 'none' },
];
const PANEL_ENTER_OPTIONS: KeyframeAnimationOptions = {
    duration: 360,
    easing: 'cubic-bezier(0.22, 0.9, 0.24, 1)',
};

/** Footprint change: hidden while the body morphs, then a short fade. */
const CONTENT_REVEAL: Keyframe[] = [
    { opacity: 0, transform: 'translateY(6px)' },
    { opacity: 1, transform: 'none' },
];
const CONTENT_REVEAL_OPTIONS: KeyframeAnimationOptions = {
    duration: CONTENT_FADE_MS,
    delay: CHASSIS_CONTENT_DELAY_MS,
    easing: 'ease-out',
    fill: 'backwards',
};

/** A secondary panel that just opened slides in a beat after the primary. */
const SECONDARY_REVEAL: Record<ChassisSecondaryPlacement, Keyframe[]> = {
    side: [{ opacity: 0, transform: 'translateX(16px)' }, { opacity: 1, transform: 'none' }],
    below: [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }],
};
const SECONDARY_REVEAL_OPTIONS: KeyframeAnimationOptions = {
    duration: 260,
    delay: CHASSIS_CONTENT_DELAY_MS + 60,
    easing: 'cubic-bezier(0.22, 0.9, 0.24, 1)',
    fill: 'backwards',
};

function px(value: string): number {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Width the stage will have once the body reaches `maxWidth`: the parent's
 * content box, capped at `maxWidth`, minus the body's own padding. Returns 0
 * when it cannot be measured (no layout, e.g. jsdom).
 */
function targetStageWidth(section: HTMLElement, maxWidth: number): number {
    const parent = section.parentElement;
    if (!parent) return 0;
    const ps = getComputedStyle(parent);
    const available = parent.clientWidth - px(ps.paddingLeft) - px(ps.paddingRight);
    const ss = getComputedStyle(section);
    return Math.min(available, maxWidth) - px(ss.paddingLeft) - px(ss.paddingRight);
}

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
    /**
     * Accent colour of the hosted panel (e.g. the active oscillator type's).
     * Exposed as `--chassis-accent`; tints the active mode LED and stage rim.
     */
    accent?: string;
    /** Theme id of the hosted panel, exposed as `data-chassis-theme`. */
    theme?: string;
    /** Fixed top anchor — the LED step strip / sequencer well. */
    ledStrip: React.ReactNode;
    /** Fixed bottom anchor — the key bed. */
    keybed?: React.ReactNode;
    /**
     * Fixed strip under the key bed (e.g. the master loudness / limiter strip,
     * #1586). Like the LED strip and key bed it never morphs.
     */
    footer?: React.ReactNode;
    /** Primary stage content for the current mode. */
    children: React.ReactNode;
    /**
     * Secondary panel, revealed beside or under the primary. Passing content
     * opens it; omitting it (or `null` / `false`) closes it. The primary never
     * remounts when it opens or closes.
     */
    secondary?: React.ReactNode;
    /** Where the secondary opens. @default the mode's `secondary.placement`, else `side` */
    secondaryPlacement?: ChassisSecondaryPlacement;
    /**
     * Share of the stage (0–1) the secondary takes along its split axis.
     * @default the mode's `secondary.share`; `side` falls back to 0.4, `below` to its content height
     */
    secondaryShare?: number;
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
 * them morphs — height and body width transition per mode, and a secondary
 * panel can open beside or under the primary — so switching between
 * oscillator, sampler, TTS, Voice Designer or PCF panels reads as one
 * instrument reconfiguring itself rather than separate floating panels.
 *
 * Jank-free morph: the stage animates its own height / width and clips, while
 * the panel inside is laid out once at the *target* size (`--chassis-stage-h`
 * and a measured `--chassis-stage-w`). Hosted content therefore resizes once
 * per mode change, not on every animation frame, so rack knob canvases (and
 * their ResizeObservers / GPU slots) do a single re-layout. The content is
 * hidden during the morph and fades in once the size settles. During the
 * morph the body carries `data-morphing`, for hosted panels that want to
 * defer heavy work.
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
    accent,
    theme,
    ledStrip,
    keybed,
    footer,
    children,
    secondary,
    secondaryPlacement,
    secondaryShare,
    compact = false,
    stageHeight,
    brand = 'HYPHON',
    className = '',
    'aria-label': ariaLabel,
}: HardwareChassisProps) => {
    const spec = CHASSIS_MODES[mode];
    const footprint = getChassisFootprint(mode, compact);
    const stageH = stageHeight ?? footprint.stageHeight;
    const maxWidth = footprint.maxWidth;
    const sectionRef = useRef<HTMLElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const secondaryRef = useRef<HTMLDivElement>(null);
    const identity = panelKey ?? mode;

    const secondaryOpen = secondary !== undefined && secondary !== null && secondary !== false;
    const placement = secondaryPlacement ?? spec.secondary?.placement ?? 'side';
    const share = secondaryShare ?? spec.secondary?.share
        ?? (placement === 'side' ? DEFAULT_SIDE_SECONDARY_SHARE : undefined);
    const secondarySize = share !== undefined ? `${+(Math.min(Math.max(share, 0), 1) * 100).toFixed(3)}%` : 'auto';
    const footprintKey = `${stageH}|${maxWidth}|${secondaryOpen ? `${placement}:${secondarySize}` : '-'}`;
    const lastRef = useRef({ identity, footprintKey, secondaryOpen });

    // Hold the panel at the width the stage is heading to. Re-measured when the
    // target changes and when the parent resizes (window resize, compact).
    useLayoutEffect(() => {
        const section = sectionRef.current;
        const parent = section?.parentElement;
        if (!section || !parent) return;
        const update = () => {
            const width = targetStageWidth(section, maxWidth);
            const value = width > 0 ? `${width}px` : '';
            if (section.style.getPropertyValue('--chassis-stage-w') === value) return;
            if (value) section.style.setProperty('--chassis-stage-w', value);
            else section.style.removeProperty('--chassis-stage-w');
        };
        update();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(update);
        observer.observe(parent);
        return () => observer.disconnect();
    }, [maxWidth, compact]);

    // Motion on panel / footprint change. WAAPI (not a keyed remount) keeps the
    // hosted panel's state and GPU knob slots alive. Reduced motion skips it.
    useLayoutEffect(() => {
        const last = lastRef.current;
        const footprintChanged = last.footprintKey !== footprintKey;
        const identityChanged = last.identity !== identity;
        const secondaryOpened = secondaryOpen && !last.secondaryOpen;
        lastRef.current = { identity, footprintKey, secondaryOpen };
        if ((!footprintChanged && !identityChanged) || getPrefersReducedMotion()) return;

        const section = sectionRef.current;
        const animations: Animation[] = [];
        let morphTimer: number | undefined;
        if (footprintChanged && section) {
            section.dataset.morphing = 'true';
            morphTimer = window.setTimeout(() => { delete section.dataset.morphing; }, CHASSIS_MORPH_MS);
        }
        const panel = panelRef.current;
        if (panel && typeof panel.animate === 'function') {
            animations.push(footprintChanged
                ? panel.animate(CONTENT_REVEAL, CONTENT_REVEAL_OPTIONS)
                : panel.animate(PANEL_ENTER, PANEL_ENTER_OPTIONS));
        }
        const secondaryEl = secondaryRef.current;
        if (secondaryOpened && secondaryEl && typeof secondaryEl.animate === 'function') {
            animations.push(secondaryEl.animate(SECONDARY_REVEAL[placement], SECONDARY_REVEAL_OPTIONS));
        }
        return () => {
            animations.forEach((a) => a.cancel());
            if (morphTimer !== undefined) {
                window.clearTimeout(morphTimer);
                if (section) delete section.dataset.morphing;
            }
        };
    }, [identity, footprintKey, secondaryOpen, placement]);

    // On narrow screens a side secondary stacks under the primary; the stage
    // grows by its share so the primary keeps the mode's full height.
    const stackedShare = secondaryOpen && placement === 'side' && share !== undefined
        ? Math.min(Math.max(share, 0), 0.8)
        : 0;
    const style = {
        '--chassis-stage-h': `${stageH}px`,
        ...(stackedShare > 0 ? { '--chassis-stage-h-stacked': `${Math.round(stageH / (1 - stackedShare))}px` } : {}),
        '--chassis-max-w': `${maxWidth}px`,
        '--chassis-morph-duration': `${CHASSIS_MORPH_MS}ms`,
        ...(accent ? { '--chassis-accent': accent } : {}),
    } as React.CSSProperties;

    return (
        <section
            ref={sectionRef}
            data-chassis="white"
            data-chassis-mode={mode}
            data-chassis-theme={theme}
            data-secondary={secondaryOpen ? placement : undefined}
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
                <div
                    ref={panelRef}
                    className="hyphon-chassis__panel"
                    data-secondary={secondaryOpen ? placement : undefined}
                    style={secondaryOpen ? ({ '--chassis-secondary-size': secondarySize } as React.CSSProperties) : undefined}
                >
                    <ChassisKnobMaterialContext.Provider value={KNOB_MATERIAL_CHASSIS}>
                        <div className="hyphon-chassis__primary" data-testid="chassis-primary">{children}</div>
                        {secondaryOpen && (
                            <div
                                ref={secondaryRef}
                                className="hyphon-chassis__secondary"
                                data-placement={placement}
                                data-testid="chassis-secondary"
                            >
                                {secondary}
                            </div>
                        )}
                    </ChassisKnobMaterialContext.Provider>
                </div>
            </div>

            {keybed && <div className="hyphon-chassis__keybed chassis-well">{keybed}</div>}
            {footer && <div className="hyphon-chassis__footer chassis-well" data-testid="chassis-footer">{footer}</div>}
        </section>
    );
});

HardwareChassis.displayName = 'HardwareChassis';
