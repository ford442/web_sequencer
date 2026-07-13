/**
 * Single source of truth for the holographic knob's material, geometry, and bloom.
 * Consumed by BOTH the WebGPU WGSL shader (via string interpolation at module init)
 * and the Canvas 2D fallback renderer.
 *
 * Color values are stored as normalized 0..1 RGB so they can be fed directly into
 * WGSL vec3f literals or converted to hex for Canvas2D.
 *
 * Geometry values are stored as fractions of the knob body radius (body = 1.0).
 * The WebGPU renderer maps body radius → 0.5 in its −1..1 UV space.
 * The Canvas 2D renderer maps body radius → min(width,height)/2 pixels.
 *
 * Angle convention in this contract follows the WGSL shader (0 = straight up,
 * positive = clockwise). Canvas 2D converts with `wgslAngleToCanvas()`.
 */

export interface Rgb {
    r: number;
    g: number;
    b: number;
}

export interface KnobScale {
    /**
     * Equally-spaced tick count (clamped to 5–9). Ignored when `tickPositions` is set.
     * @default 7
     */
    tickCount?: number;
    /** Explicit normalized values (0..1) for tick placement along the sweep. */
    tickPositions?: number[];
    /**
     * Normalized values that receive longer major ticks and optional labels.
     * @default [0, 0.5, 1]
     */
    majorValues?: number[];
    /** Draw numeric labels (0 / 50 / 100) at major tick positions. */
    showLabels?: boolean;
    /** Radial center of ticks as a fraction of body radius. Defaults to `geometry.arcRadius`. */
    tickRadius?: number;
    /** Minor tick half-length as a fraction of body radius. */
    tickLength?: number;
    /** Major tick half-length as a fraction of body radius. */
    majorTickLength?: number;
}

/** Hardware detent notches — visual dimples and optional snap targets. */
export interface KnobDetents {
    /**
     * Normalized positions (0..1) along the sweep where detents sit.
     * Defaults to `scale.majorValues` or [0, 0.5, 1].
     */
    positions?: number[];
    /** Normalized snap deadzone radius. @default 0.035 */
    snapThreshold?: number;
    /** Radial dimple depth as a fraction of body radius. @default 0.045 */
    dimpleDepth?: number;
    /** Angular half-width of the dimple notch in radians. @default 0.055 */
    dimpleAngle?: number;
}

export type KnobPointerVariant = 'glow' | 'hardware';

/** Lit needle / pointer styling for holographic + classic renderers. */
export interface KnobPointerStyle {
    /** `glow` = legacy bloom needle; `hardware` = shaded body + specular. */
    variant?: KnobPointerVariant;
    base?: Rgb;
    specular?: Rgb;
    shadow?: Rgb;
}

export interface KnobMaterial {
    palette: {
        background: Rgb;
        ring: Rgb;
        arcMin: Rgb;
        arcMax: Rgb;
        needle: Rgb;
        /** Minor scale tick color. */
        scaleMinor: Rgb;
        /** Major scale tick color. */
        scaleMajor: Rgb;
        /** Numeric label color (Canvas 2D path). */
        scaleLabel: Rgb;
        /** Detent dimple shadow tint. */
        detentShadow?: Rgb;
    };
    geometry: {
        /** Fraction of body radius (body = 1.0). */
        outerRingRadius: number;
        /** Fraction of body radius (body = 1.0). */
        arcRadius: number;
        /** Fraction of body radius (body = 1.0). */
        needleLength: number;
        /** WGSL angle where the sweep starts (0 = up, + = clockwise). */
        sweepStartAngle: number;
        /** Total sweep in radians (270° = 3π/2). */
        sweepTotal: number;
    };
    scale?: KnobScale;
    /** Visual detent notches; functional snap is opt-in per control. */
    detents?: KnobDetents;
    /** Pointer / needle rendering style. */
    pointer?: KnobPointerStyle;
    bloom: {
        /** Final RGB multiplier in the WGSL fragment shader. */
        intensity: number;
    };
}

export const KNOB_MATERIAL: KnobMaterial = {
    palette: {
        background: { r: 0x0d / 0xff, g: 0x0f / 0xff, b: 0x13 / 0xff }, // #0d0f13
        ring: { r: 0x00 / 0xff, g: 0xe5 / 0xff, b: 0xff / 0xff },       // #00e5ff
        arcMin: { r: 0.0, g: 0.6, b: 0.5 },                              // ~#009980
        arcMax: { r: 0.2, g: 1.0, b: 0.8 },                              // ~#33ffcc
        needle: { r: 1.0, g: 1.0, b: 1.0 },                              // #ffffff
        scaleMinor: { r: 0.0, g: 0.75, b: 0.85 },                        // dim cyan
        scaleMajor: { r: 0.2, g: 1.0, b: 1.0 },                          // bright cyan
        scaleLabel: { r: 0.5, g: 0.9, b: 1.0 },                          // label cyan
        detentShadow: { r: 0.0, g: 0.15, b: 0.2 },                       // recessed notch
    },
    geometry: {
        outerRingRadius: 1.1,
        arcRadius: 0.84,
        needleLength: 1.0,
        sweepStartAngle: -(3 * Math.PI) / 4, // −3π/4  (7:30 position in WGSL convention)
        sweepTotal: (3 * Math.PI) / 2,       //  3π/2  (270°)
    },
    scale: {
        tickCount: 7,
        majorValues: [0, 0.5, 1],
        showLabels: true,
        tickLength: 0.06,
        majorTickLength: 0.09,
    },
    detents: {
        positions: [0, 0.5, 1],
        snapThreshold: 0.035,
        dimpleDepth: 0.045,
        dimpleAngle: 0.055,
    },
    pointer: {
        variant: 'hardware',
        base: { r: 0.82, g: 0.86, b: 0.9 },
        specular: { r: 1.0, g: 1.0, b: 1.0 },
        shadow: { r: 0.05, g: 0.08, b: 0.12 },
    },
    bloom: {
        intensity: 1.5,
    },
};

const DEFAULT_MAJOR_VALUES = [0, 0.5, 1];
const DEFAULT_DETENT_POSITIONS = [0, 0.5, 1];

/** Resolved detent positions along the normalized sweep (0..1). */
export function resolveDetentPositions(material: KnobMaterial): number[] {
    if (material.detents?.positions && material.detents.positions.length > 0) {
        return material.detents.positions;
    }
    return resolveMajorValues(material).length > 0
        ? resolveMajorValues(material)
        : DEFAULT_DETENT_POSITIONS;
}

export function isDetentPosition(t: number, material: KnobMaterial): boolean {
    return resolveDetentPositions(material).some((d) => Math.abs(d - t) < 0.001);
}

/** WGSL `array<f32, N>(...)` literal for detent angles. */
export function detentAnglesToWgslArray(material: KnobMaterial): string {
    const positions = resolveDetentPositions(material);
    const angles = positions.map((t) => wgslAngleFromNormalized(t, material.geometry));
    return `array<f32, ${angles.length}>(${angles.map((a) => a.toFixed(6)).join(', ')})`;
}

export function usesHardwarePointer(material: KnobMaterial): boolean {
    return (material.pointer?.variant ?? 'glow') === 'hardware';
}

/** Resolved tick positions along the normalized sweep (0..1). */
export function resolveTickPositions(material: KnobMaterial): number[] {
    const scale = material.scale;
    if (scale?.tickPositions && scale.tickPositions.length > 0) {
        return scale.tickPositions;
    }
    const count = Math.max(5, Math.min(9, scale?.tickCount ?? 7));
    if (count === 1) return [0];
    return Array.from({ length: count }, (_, i) => i / (count - 1));
}

export function resolveMajorValues(material: KnobMaterial): number[] {
    return material.scale?.majorValues ?? DEFAULT_MAJOR_VALUES;
}

export function isMajorTickPosition(t: number, material: KnobMaterial): boolean {
    return resolveMajorValues(material).some((m) => Math.abs(m - t) < 0.001);
}

/** WGSL angle for a normalized tick/value position along the sweep. */
export function wgslAngleFromNormalized(t: number, geometry: KnobMaterial['geometry']): number {
    return geometry.sweepStartAngle + t * geometry.sweepTotal;
}

/** Normalized 0..1 position from a WGSL-space angle, clamped to the sweep. */
export function normalizedFromWgslAngle(angle: number, geometry: KnobMaterial['geometry']): number {
    const t = (angle - geometry.sweepStartAngle) / geometry.sweepTotal;
    return Math.max(0, Math.min(1, t));
}

/** WGSL `array<f32, N>(...)` literal for tick angles, for shader string interpolation. */
export function tickAnglesToWgslArray(material: KnobMaterial): string {
    const positions = resolveTickPositions(material);
    const angles = positions.map((t) => wgslAngleFromNormalized(t, material.geometry));
    return `array<f32, ${angles.length}>(${angles.map((a) => a.toFixed(6)).join(', ')})`;
}

/** WGSL `array<f32, N>(...)` literal — 1.0 for major ticks, 0.0 for minor. */
export function tickMajorFlagsToWgslArray(material: KnobMaterial): string {
    const positions = resolveTickPositions(material);
    const flags = positions.map((t) => (isMajorTickPosition(t, material) ? 1.0 : 0.0));
    return `array<f32, ${flags.length}>(${flags.join(', ')})`;
}

export function formatScaleLabel(t: number): string {
    return String(Math.round(t * 100));
}

/** Convert normalized RGB → "#rrggbb" hex string for Canvas 2D. */
export function rgbToHex(rgb: Rgb): string {
    const byte = (v: number) =>
        Math.round(Math.max(0, Math.min(1, v)) * 255)
            .toString(16)
            .padStart(2, '0');
    return `#${byte(rgb.r)}${byte(rgb.g)}${byte(rgb.b)}`;
}

/** Convert normalized RGB → WGSL vec3f literal for shader string interpolation. */
export function rgbToWgsl(rgb: Rgb): string {
    return `vec3f(${rgb.r.toFixed(4)}, ${rgb.g.toFixed(4)}, ${rgb.b.toFixed(4)})`;
}

/**
 * Convert an angle from the WGSL convention (0 = straight up, + = clockwise)
 * to Canvas 2D `arc()` convention (0 = right, + = clockwise).
 */
export function wgslAngleToCanvas(wgslAngle: number): number {
    return wgslAngle - Math.PI / 2;
}
