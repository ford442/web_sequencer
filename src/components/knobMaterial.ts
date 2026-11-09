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

/**
 * Physical knob cap (black knurled skirt + brushed-metal top) for the white
 * hardware chassis (#1581). Radii are fractions of the CAP radius unless noted.
 */
export interface KnobCapStyle {
    /** Cap skirt colour (black plastic in the reference). */
    body: Rgb;
    /** Cap radius as a fraction of the knob body radius. @default 0.74 */
    radius?: number;
    /** Brushed-metal top disc radius, fraction of the cap radius. @default 0.62 */
    topRadius?: number;
    topColor?: Rgb;
    /** Number of knurl ridges on the skirt. 0 disables. @default 36 */
    knurlCount?: number;
    /** Skirt bevel width, fraction of the cap radius. @default 0.12 */
    bevel?: number;
}

/** Shared lighting model for the physical cap — read by WGSL and Canvas2D. */
export interface KnobLighting {
    /** Light direction in screen space (x right, y down, z toward viewer); top-left key light. */
    lightDir: [number, number, number];
    /** 0..1 */
    ambient: number;
    /** Blinn-Phong exponent. */
    specularPower: number;
    specularStrength: number;
    /** Contact shadow under the cap onto the panel, in cap-radius units. */
    dropShadow: { offsetY: number; blur: number; opacity: number };
    /** Glow around the lit value arc ("LED ring"); width in body-radius units. */
    ledRing?: { radius: number; width: number; intensity: number };
}

export interface KnobMaterial {
    /** Stable id used to cache GPU pipelines and Canvas2D static layers per material. */
    id?: string;
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
    /**
     * Animation policy for the holographic time uniform.
     * `timeScale` of 0 freezes decorative motion (idle + prefers-reduced-motion).
     * Active interaction uses timeScale 1 unless reduced-motion is on.
     */
    animation?: {
        /** Multiplier applied to wall-clock time. 0 = static frame. @default 1 */
        timeScale?: number;
    };
    /** Physical cap. When set, renderers draw a lit 3D cap instead of the hologram body. */
    cap?: KnobCapStyle;
    /** Lighting for the physical cap. Falls back to `DEFAULT_KNOB_LIGHTING`. */
    lighting?: KnobLighting;
}

/**
 * Locked time uniform for idle / prefers-reduced-motion static frames.
 * Byte-identical path for both policies — see resolveKnobTimeUniform in knobMotion.ts.
 */
export const KNOB_STATIC_TIME = 0;

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

const CHASSIS_ARC_MIN: Rgb = { r: 0.55, g: 0.08, b: 0.1 };   // dim LED red
const CHASSIS_ARC_MAX: Rgb = { r: 1.0, g: 0.23, b: 0.23 };   // --key-led #ff3b3b

/** Studio key light from the top-left; soft contact shadow below the cap. */
const DEFAULT_KNOB_LIGHTING: KnobLighting = {
    lightDir: [-0.45, -0.6, 0.66],
    ambient: 0.25,
    specularPower: 48,
    specularStrength: 0.9,
    dropShadow: { offsetY: 0.12, blur: 0.25, opacity: 0.35 },
    ledRing: { radius: 1.18, width: 0.06, intensity: 1.4 },
};

/**
 * White-chassis knob (#1581): black knurled cap with a brushed-metal top, a red
 * LED value arc printed on the panel and a contact shadow. Opt-in via the
 * `knobMaterial` / `material` props; `KNOB_MATERIAL` stays the default.
 */
export const KNOB_MATERIAL_CHASSIS: KnobMaterial = {
    ...KNOB_MATERIAL,
    id: 'chassis-white',
    palette: {
        ...KNOB_MATERIAL.palette,
        background: { r: 0.93, g: 0.93, b: 0.94 },
        ring: { r: 0.62, g: 0.64, b: 0.67 },          // unlit arc track
        arcMin: CHASSIS_ARC_MIN,
        arcMax: CHASSIS_ARC_MAX,
        needle: { r: 0.95, g: 0.95, b: 0.96 },
        scaleMinor: { r: 0.55, g: 0.57, b: 0.6 },
        scaleMajor: { r: 0.23, g: 0.24, b: 0.27 },
        scaleLabel: { r: 0.34, g: 0.36, b: 0.38 },
        detentShadow: { r: 0.42, g: 0.44, b: 0.47 },
    },
    geometry: {
        ...KNOB_MATERIAL.geometry,
        outerRingRadius: 0.98,
        arcRadius: 0.88,
        needleLength: 0.66,
    },
    scale: { ...KNOB_MATERIAL.scale, showLabels: false, tickRadius: 1.0, tickLength: 0.05, majorTickLength: 0.09 },
    pointer: {
        variant: 'hardware',
        base: { r: 0.93, g: 0.94, b: 0.95 },
        specular: { r: 1.0, g: 1.0, b: 1.0 },
        shadow: { r: 0.02, g: 0.02, b: 0.03 },
    },
    cap: {
        body: { r: 0.06, g: 0.06, b: 0.07 },
        radius: 0.74,
        topColor: { r: 0.72, g: 0.73, b: 0.75 },
        topRadius: 0.62,
        knurlCount: 36,
        bevel: 0.12,
    },
    lighting: DEFAULT_KNOB_LIGHTING,
};

/** Cap with every optional field resolved, or null when the material has none. */
export function resolveKnobCap(material: KnobMaterial): Required<KnobCapStyle> | null {
    const cap = material.cap;
    if (!cap) return null;
    return {
        body: cap.body,
        radius: cap.radius ?? 0.74,
        topRadius: cap.topRadius ?? 0.62,
        topColor: cap.topColor ?? { r: 0.72, g: 0.73, b: 0.75 },
        knurlCount: Math.max(0, Math.round(cap.knurlCount ?? 36)),
        bevel: cap.bevel ?? 0.12,
    };
}

export function resolveKnobLighting(material: KnobMaterial): KnobLighting {
    return material.lighting ?? DEFAULT_KNOB_LIGHTING;
}

/** Screen-space light direction (y down) normalised. */
export function normalizedLightDir(lighting: KnobLighting): [number, number, number] {
    const [x, y, z] = lighting.lightDir;
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
}

/** Linear blend of two colours (t = 0 → a, t = 1 → b). */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

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
