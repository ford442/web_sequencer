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

export interface KnobMaterial {
    palette: {
        background: Rgb;
        ring: Rgb;
        arcMin: Rgb;
        arcMax: Rgb;
        needle: Rgb;
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
    },
    geometry: {
        outerRingRadius: 1.1,
        arcRadius: 0.84,
        needleLength: 1.0,
        sweepStartAngle: -(3 * Math.PI) / 4, // −3π/4  (7:30 position in WGSL convention)
        sweepTotal: (3 * Math.PI) / 2,       //  3π/2  (270°)
    },
    bloom: {
        intensity: 1.5,
    },
};

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
 * Convert an angle from the WGSL convention (0 = up, + = clockwise)
 * to Canvas 2D `arc()` convention (0 = right, + = clockwise).
 */
export function wgslAngleToCanvas(wgslAngle: number): number {
    return wgslAngle - Math.PI / 2;
}
