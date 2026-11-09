/**
 * Canvas 2D layers for the physical knob cap (#1581) — the fallback twin of
 * the WGSL height-field cap in `knobCapShader.ts`. Both read the same
 * `KnobMaterial.cap` / `KnobMaterial.lighting` numbers.
 *
 * Canvas has no cheap per-pixel normals, so the cap is approximated with
 * layered gradients. The layers are split so `renderKnob2D` can cache the
 * part that never moves (track, ticks, contact shadow, skirt shading) per
 * size + material and only redraw what turns with the value (lit arc, knurl,
 * brushed top, pointer) on every change.
 */
import type { Knob2DDimensions, Knob2DDrawCommand } from './knobRender';
import {
    isMajorTickPosition,
    mixRgb,
    normalizedLightDir,
    resolveKnobCap,
    resolveKnobLighting,
    resolveTickPositions,
    rgbToHex,
    wgslAngleFromNormalized,
    wgslAngleToCanvas,
} from './knobMaterial';
import type { KnobMaterial, Rgb } from './knobMaterial';

/** Body radius as a fraction of the canvas half-size (room for shadow + glow). */
export const KNOB_CAP_FRAME = 0.92;

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 1, g: 1, b: 1 };

function rgba(rgb: Rgb, alpha: number): string {
    const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
    return `rgba(${c(rgb.r)}, ${c(rgb.g)}, ${c(rgb.b)}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

export interface KnobCapLayers {
    /** Value-independent: safe to cache per (size, dpr, material). */
    staticLayer: Knob2DDrawCommand[];
    /** Turns with the value: redrawn every change. */
    dynamicLayer: Knob2DDrawCommand[];
}

/** Draw calls for a physical cap, or null when the material has no `cap`. */
export function buildKnobCapLayers(
    material: KnobMaterial,
    value: number,
    dims: Knob2DDimensions,
): KnobCapLayers | null {
    const cap = resolveKnobCap(material);
    if (!cap) return null;

    const lighting = resolveKnobLighting(material);
    const [lx, ly] = normalizedLightDir(lighting);
    const { geometry } = material;
    const v = Math.max(0, Math.min(1, value));

    const cx = dims.w / 2;
    const cy = dims.h / 2;
    const R = (Math.min(dims.w, dims.h) / 2) * KNOB_CAP_FRAME;
    const capR = R * cap.radius;
    const topR = capR * cap.topRadius;
    const arcR = R * geometry.arcRadius;
    const arcW = Math.max(2, R * 0.07);
    const sweepStart = wgslAngleToCanvas(geometry.sweepStartAngle);
    const sweepEnd = sweepStart + geometry.sweepTotal;
    const valueAngle = sweepStart + v * geometry.sweepTotal;

    const staticLayer: Knob2DDrawCommand[] = [
        // Unlit LED track printed on the panel.
        { op: 'save' },
        { op: 'lineCap', value: 'round' },
        { op: 'beginPath' },
        { op: 'arc', args: [cx, cy, arcR, sweepStart, sweepEnd] },
        { op: 'strokeStyle', value: rgbToHex(material.palette.ring) },
        { op: 'lineWidth', value: arcW },
        { op: 'stroke' },
        { op: 'restore' },
    ];

    // Silkscreen scale ticks outside the track.
    const tickR = R * (material.scale?.tickRadius ?? geometry.arcRadius);
    const minorHalf = R * (material.scale?.tickLength ?? 0.06) * 0.5;
    const majorHalf = R * (material.scale?.majorTickLength ?? 0.09) * 0.5;
    for (const t of resolveTickPositions(material)) {
        const a = wgslAngleToCanvas(wgslAngleFromNormalized(t, geometry));
        const major = isMajorTickPosition(t, material);
        const half = major ? majorHalf : minorHalf;
        staticLayer.push(
            { op: 'beginPath' },
            { op: 'moveTo', args: [cx + Math.cos(a) * (tickR - half), cy + Math.sin(a) * (tickR - half)] },
            { op: 'lineTo', args: [cx + Math.cos(a) * (tickR + half), cy + Math.sin(a) * (tickR + half)] },
            { op: 'strokeStyle', value: rgbToHex(major ? material.palette.scaleMajor : material.palette.scaleMinor) },
            { op: 'lineWidth', value: major ? 1.5 : 1 },
            { op: 'stroke' },
        );
    }

    // Contact shadow + skirt shading (radial focus toward the light).
    const shadow = lighting.dropShadow;
    staticLayer.push(
        { op: 'save' },
        {
            op: 'shadow',
            color: rgba(BLACK, shadow.opacity),
            blur: capR * shadow.blur,
            offsetX: 0,
            offsetY: capR * shadow.offsetY,
        },
        {
            op: 'createRadialGradient',
            id: 'capSkirt',
            args: [cx + lx * capR * 0.35, cy + ly * capR * 0.35, 0, cx, cy, capR],
        },
        { op: 'addColorStop', id: 'capSkirt', args: [0, rgbToHex(mixRgb(cap.body, WHITE, 0.22))] },
        { op: 'addColorStop', id: 'capSkirt', args: [0.72, rgbToHex(cap.body)] },
        { op: 'addColorStop', id: 'capSkirt', args: [1, rgbToHex(mixRgb(cap.body, BLACK, 0.6))] },
        { op: 'beginPath' },
        { op: 'arc', args: [cx, cy, capR, 0, Math.PI * 2] },
        { op: 'fillStyleGradient', id: 'capSkirt' },
        { op: 'fill' },
        { op: 'restore' },
        // Bevel rim: lit on the light side, shaded on the far side.
        {
            op: 'createLinearGradient',
            id: 'capRim',
            args: [cx + lx * capR, cy + ly * capR, cx - lx * capR, cy - ly * capR],
        },
        { op: 'addColorStop', id: 'capRim', args: [0, rgba(WHITE, 0.38)] },
        { op: 'addColorStop', id: 'capRim', args: [0.5, rgba(WHITE, 0)] },
        { op: 'addColorStop', id: 'capRim', args: [1, rgba(BLACK, 0.45)] },
        { op: 'beginPath' },
        { op: 'arc', args: [cx, cy, Math.max(0, capR - 0.75), 0, Math.PI * 2] },
        { op: 'strokeStyleGradient', id: 'capRim' },
        { op: 'lineWidth', value: 1.5 },
        { op: 'stroke' },
        // Groove where the metal top sits in the skirt.
        { op: 'beginPath' },
        { op: 'arc', args: [cx, cy, topR + capR * 0.025, 0, Math.PI * 2] },
        { op: 'strokeStyle', value: rgba(BLACK, 0.6) },
        { op: 'lineWidth', value: Math.max(1, capR * 0.045) },
        { op: 'stroke' },
    );

    const dynamicLayer: Knob2DDrawCommand[] = [];

    // Lit value arc with an LED glow.
    if (v > 0.001) {
        const ring = lighting.ledRing;
        const intensity = ring?.intensity ?? 1;
        dynamicLayer.push(
            { op: 'save' },
            { op: 'lineCap', value: 'round' },
            {
                op: 'createLinearGradient',
                id: 'capArc',
                args: [
                    cx + Math.cos(sweepStart) * arcR,
                    cy + Math.sin(sweepStart) * arcR,
                    cx + Math.cos(valueAngle) * arcR,
                    cy + Math.sin(valueAngle) * arcR,
                ],
            },
            { op: 'addColorStop', id: 'capArc', args: [0, rgbToHex(material.palette.arcMin)] },
            { op: 'addColorStop', id: 'capArc', args: [1, rgbToHex(material.palette.arcMax)] },
            {
                op: 'shadow',
                color: rgba(material.palette.arcMax, Math.min(1, 0.55 * intensity)),
                blur: R * (ring?.width ?? 0.06) * 2 * intensity,
                offsetX: 0,
                offsetY: 0,
            },
            { op: 'beginPath' },
            { op: 'arc', args: [cx, cy, arcR, sweepStart, valueAngle] },
            { op: 'strokeStyleGradient', id: 'capArc' },
            { op: 'lineWidth', value: arcW },
            { op: 'stroke' },
            { op: 'restore' },
        );
    }

    // Knurl ridges turn with the value; brightness follows the light.
    if (cap.knurlCount > 0) {
        const inner = topR + capR * 0.07;
        const outer = capR * 0.96;
        const lit: Array<[number, number, number, number]> = [];
        const shade: Array<[number, number, number, number]> = [];
        for (let i = 0; i < cap.knurlCount; i++) {
            const a = valueAngle + (i * Math.PI * 2) / cap.knurlCount;
            const cos = Math.cos(a);
            const sin = Math.sin(a);
            const seg: [number, number, number, number] = [
                cx + cos * inner, cy + sin * inner, cx + cos * outer, cy + sin * outer,
            ];
            (cos * lx + sin * ly > 0 ? lit : shade).push(seg);
        }
        const pushRidges = (segs: Array<[number, number, number, number]>, color: string) => {
            if (segs.length === 0) return;
            dynamicLayer.push({ op: 'beginPath' });
            for (const [x1, y1, x2, y2] of segs) {
                dynamicLayer.push({ op: 'moveTo', args: [x1, y1] }, { op: 'lineTo', args: [x2, y2] });
            }
            dynamicLayer.push(
                { op: 'strokeStyle', value: color },
                { op: 'lineWidth', value: Math.max(0.75, capR * 0.035) },
                { op: 'stroke' },
            );
        };
        pushRidges(lit, rgba(WHITE, 0.22));
        pushRidges(shade, rgba(BLACK, 0.5));
    }

    // Brushed-metal top: the streak gradient rotates with the value.
    const brushAngle = valueAngle + Math.PI / 4;
    const bx = Math.cos(brushAngle) * topR;
    const by = Math.sin(brushAngle) * topR;
    dynamicLayer.push(
        { op: 'createLinearGradient', id: 'capTop', args: [cx - bx, cy - by, cx + bx, cy + by] },
        { op: 'addColorStop', id: 'capTop', args: [0, rgbToHex(mixRgb(cap.topColor, WHITE, 0.3))] },
        { op: 'addColorStop', id: 'capTop', args: [0.35, rgbToHex(cap.topColor)] },
        { op: 'addColorStop', id: 'capTop', args: [0.5, rgbToHex(mixRgb(cap.topColor, BLACK, 0.28))] },
        { op: 'addColorStop', id: 'capTop', args: [0.65, rgbToHex(cap.topColor)] },
        { op: 'addColorStop', id: 'capTop', args: [1, rgbToHex(mixRgb(cap.topColor, WHITE, 0.35))] },
        { op: 'beginPath' },
        { op: 'arc', args: [cx, cy, topR, 0, Math.PI * 2] },
        { op: 'fillStyleGradient', id: 'capTop' },
        { op: 'fill' },
    );

    // Pointer line (with a 1px drop for depth).
    const pointer = material.pointer;
    const pBase = pointer?.base ?? material.palette.needle;
    const pShadow = pointer?.shadow ?? BLACK;
    const dirX = Math.cos(valueAngle);
    const dirY = Math.sin(valueAngle);
    const from = capR * 0.14;
    const to = R * geometry.needleLength;
    const pw = Math.max(1.5, capR * 0.085);
    dynamicLayer.push(
        { op: 'save' },
        { op: 'lineCap', value: 'round' },
        { op: 'beginPath' },
        { op: 'moveTo', args: [cx + dirX * from - lx, cy + dirY * from - ly] },
        { op: 'lineTo', args: [cx + dirX * to - lx, cy + dirY * to - ly] },
        { op: 'strokeStyle', value: rgba(pShadow, 0.7) },
        { op: 'lineWidth', value: pw + 1 },
        { op: 'stroke' },
        { op: 'beginPath' },
        { op: 'moveTo', args: [cx + dirX * from, cy + dirY * from] },
        { op: 'lineTo', args: [cx + dirX * to, cy + dirY * to] },
        { op: 'strokeStyle', value: rgbToHex(pBase) },
        { op: 'lineWidth', value: pw },
        { op: 'stroke' },
        { op: 'restore' },
    );

    // Fixed specular highlight: stays with the light, never rotates.
    const specAlpha = Math.min(0.45, 0.3 * (lighting.specularStrength / 0.9));
    dynamicLayer.push(
        { op: 'fillStyle', value: rgba(WHITE, specAlpha) },
        { op: 'beginPath' },
        {
            op: 'ellipse',
            args: [
                cx + lx * topR * 0.42,
                cy + ly * topR * 0.42,
                topR * 0.46,
                topR * 0.22,
                Math.atan2(ly, lx) + Math.PI / 2,
                0,
                Math.PI * 2,
            ],
        },
        { op: 'fill' },
    );

    return { staticLayer, dynamicLayer };
}
