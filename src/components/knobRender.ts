import {
    KNOB_MATERIAL,
    rgbToHex,
    wgslAngleToCanvas,
    resolveTickPositions,
    resolveDetentPositions,
    isMajorTickPosition,
    wgslAngleFromNormalized,
    formatScaleLabel,
    usesHardwarePointer,
} from './knobMaterial';
import type { KnobMaterial } from './knobMaterial';
import { drawKnobAutomationOverlay, type KnobAutomationOverlayState } from './knobAutomationOverlay';

export interface Knob2DDimensions {
    w: number;
    h: number;
}

export type Knob2DDrawCommand =
    | { op: 'fillStyle'; value: string }
    | { op: 'fillRect'; args: [number, number, number, number] }
    | { op: 'beginPath' }
    | { op: 'arc'; args: [number, number, number, number, number] }
    | { op: 'strokeStyle'; value: string }
    | { op: 'lineWidth'; value: number }
    | { op: 'stroke' }
    | { op: 'moveTo'; args: [number, number] }
    | { op: 'lineTo'; args: [number, number] }
    | { op: 'createLinearGradient'; id: string; args: [number, number, number, number] }
    | { op: 'addColorStop'; id: string; args: [number, string] }
    | { op: 'strokeStyleGradient'; id: string }
    | { op: 'font'; value: string }
    | { op: 'textAlign'; value: CanvasTextAlign }
    | { op: 'textBaseline'; value: CanvasTextBaseline }
    | { op: 'fillText'; args: [string, number, number] }
    | { op: 'fill' }
    | { op: 'ellipse'; args: [number, number, number, number, number, number, number] };

export function buildKnob2DDrawCalls(
    material: KnobMaterial,
    value: number,
    dims: Knob2DDimensions
): Knob2DDrawCommand[] {
    const cx = dims.w / 2;
    const cy = dims.h / 2;
    const bodyRadius = Math.min(dims.w, dims.h) / 2;
    const outerRingRadius = bodyRadius * material.geometry.outerRingRadius;
    const arcRadius = bodyRadius * material.geometry.arcRadius;
    const needleLength = bodyRadius * material.geometry.needleLength;
    const sweepStart = wgslAngleToCanvas(material.geometry.sweepStartAngle);
    const endAngle = sweepStart + value * material.geometry.sweepTotal;
    const gradientId = 'valueArc';

    const drawCalls: Knob2DDrawCommand[] = [
        { op: 'fillStyle', value: rgbToHex(material.palette.background) },
        { op: 'fillRect', args: [0, 0, dims.w, dims.h] },

        { op: 'beginPath' },
        { op: 'arc', args: [cx, cy, outerRingRadius, 0, Math.PI * 2] },
        { op: 'strokeStyle', value: rgbToHex(material.palette.ring) },
        { op: 'lineWidth', value: 2 },
        { op: 'stroke' },
    ];

    const tickRadius = bodyRadius * (material.scale?.tickRadius ?? material.geometry.arcRadius);
    const minorLen = bodyRadius * (material.scale?.tickLength ?? 0.06);
    const majorLen = bodyRadius * (material.scale?.majorTickLength ?? 0.09);
    const tickPositions = resolveTickPositions(material);

    for (const t of tickPositions) {
        const wgslAngle = wgslAngleFromNormalized(t, material.geometry);
        const canvasAngle = wgslAngleToCanvas(wgslAngle);
        const isMajor = isMajorTickPosition(t, material);
        const halfLen = isMajor ? majorLen : minorLen;
        const innerR = tickRadius - halfLen;
        const outerR = tickRadius + halfLen;
        drawCalls.push(
            { op: 'beginPath' },
            {
                op: 'moveTo',
                args: [cx + Math.cos(canvasAngle) * innerR, cy + Math.sin(canvasAngle) * innerR],
            },
            {
                op: 'lineTo',
                args: [cx + Math.cos(canvasAngle) * outerR, cy + Math.sin(canvasAngle) * outerR],
            },
            {
                op: 'strokeStyle',
                value: rgbToHex(isMajor ? material.palette.scaleMajor : material.palette.scaleMinor),
            },
            { op: 'lineWidth', value: isMajor ? 2 : 1 },
            { op: 'stroke' }
        );
    }

    if (material.scale?.showLabels) {
        const labelR = tickRadius + majorLen + bodyRadius * 0.08;
        const fontSize = Math.max(7, Math.round(bodyRadius * 0.18));
        drawCalls.push(
            { op: 'font', value: `bold ${fontSize}px monospace` },
            { op: 'textAlign', value: 'center' },
            { op: 'textBaseline', value: 'middle' },
            { op: 'fillStyle', value: rgbToHex(material.palette.scaleLabel) }
        );
        for (const t of resolveTickPositions(material)) {
            if (!isMajorTickPosition(t, material)) continue;
            const wgslAngle = wgslAngleFromNormalized(t, material.geometry);
            const canvasAngle = wgslAngleToCanvas(wgslAngle);
            drawCalls.push({
                op: 'fillText',
                args: [
                    formatScaleLabel(t),
                    cx + Math.cos(canvasAngle) * labelR,
                    cy + Math.sin(canvasAngle) * labelR,
                ],
            });
        }
    }

    drawCalls.push(
        {
            op: 'createLinearGradient',
            id: gradientId,
            args: [
                cx + Math.cos(sweepStart) * arcRadius,
                cy + Math.sin(sweepStart) * arcRadius,
                cx + Math.cos(endAngle) * arcRadius,
                cy + Math.sin(endAngle) * arcRadius,
            ],
        },
        { op: 'addColorStop', id: gradientId, args: [0, rgbToHex(material.palette.arcMin)] },
        { op: 'addColorStop', id: gradientId, args: [1, rgbToHex(material.palette.arcMax)] },
        { op: 'beginPath' },
        { op: 'arc', args: [cx, cy, arcRadius, sweepStart, endAngle] },
        { op: 'strokeStyleGradient', id: gradientId },
        { op: 'lineWidth', value: 3 },
        { op: 'stroke' }
    );

    if (material.detents) {
        const dimpleDepth = bodyRadius * (material.detents.dimpleDepth ?? 0.045);
        const dimpleR = tickRadius;
        const detentColor = rgbToHex(material.palette.detentShadow ?? { r: 0, g: 0.15, b: 0.2 });
        for (const t of resolveDetentPositions(material)) {
            const canvasAngle = wgslAngleToCanvas(wgslAngleFromNormalized(t, material.geometry));
            const innerR = dimpleR - dimpleDepth;
            const outerR = dimpleR + dimpleDepth * 0.65;
            const mx = cx + Math.cos(canvasAngle) * dimpleR;
            const my = cy + Math.sin(canvasAngle) * dimpleR;
            drawCalls.push(
                { op: 'beginPath' },
                {
                    op: 'moveTo',
                    args: [cx + Math.cos(canvasAngle) * innerR, cy + Math.sin(canvasAngle) * innerR],
                },
                {
                    op: 'lineTo',
                    args: [cx + Math.cos(canvasAngle) * outerR, cy + Math.sin(canvasAngle) * outerR],
                },
                { op: 'strokeStyle', value: detentColor },
                { op: 'lineWidth', value: 3 },
                { op: 'stroke' },
                { op: 'fillStyle', value: detentColor },
                { op: 'beginPath' },
                { op: 'arc', args: [mx, my, dimpleDepth * 0.35, 0, Math.PI * 2] },
                { op: 'fill' }
            );
        }
    }

    const needleTipX = cx + Math.cos(endAngle) * needleLength;
    const needleTipY = cy + Math.sin(endAngle) * needleLength;

    if (usesHardwarePointer(material)) {
        const pointerBase = material.pointer?.base ?? material.palette.needle;
        const pointerSpec = material.pointer?.specular ?? material.palette.needle;
        const pointerShadow = material.pointer?.shadow ?? { r: 0.05, g: 0.08, b: 0.12 };
        const shadowAngle = endAngle + Math.PI;
        const shadowDist = bodyRadius * 0.12;
        drawCalls.push(
            { op: 'fillStyle', value: rgbToHex(pointerShadow) },
            { op: 'beginPath' },
            {
                op: 'ellipse',
                args: [
                    cx + Math.cos(shadowAngle) * shadowDist,
                    cy + Math.sin(shadowAngle) * shadowDist,
                    bodyRadius * 0.08,
                    bodyRadius * 0.04,
                    shadowAngle,
                    0,
                    Math.PI * 2,
                ],
            },
            { op: 'fill' },
            {
                op: 'createLinearGradient',
                id: 'needleBody',
                args: [cx, cy, needleTipX, needleTipY],
            },
            { op: 'addColorStop', id: 'needleBody', args: [0, rgbToHex(pointerShadow)] },
            { op: 'addColorStop', id: 'needleBody', args: [0.55, rgbToHex(pointerBase)] },
            { op: 'addColorStop', id: 'needleBody', args: [1, rgbToHex(pointerSpec)] },
            { op: 'beginPath' },
            { op: 'moveTo', args: [cx, cy] },
            { op: 'lineTo', args: [needleTipX, needleTipY] },
            { op: 'strokeStyleGradient', id: 'needleBody' },
            { op: 'lineWidth', value: 3 },
            { op: 'stroke' }
        );
    } else {
        drawCalls.push(
            { op: 'beginPath' },
            { op: 'moveTo', args: [cx, cy] },
            { op: 'lineTo', args: [needleTipX, needleTipY] },
            { op: 'strokeStyle', value: rgbToHex(material.palette.needle) },
            { op: 'lineWidth', value: 2 },
            { op: 'stroke' }
        );
    }

    return drawCalls;
}

export function replayKnob2DDrawCalls(
    ctx: CanvasRenderingContext2D,
    drawCalls: Knob2DDrawCommand[]
): void {
    const gradients = new Map<string, CanvasGradient>();
    for (const cmd of drawCalls) {
        switch (cmd.op) {
            case 'fillStyle':
                ctx.fillStyle = cmd.value;
                break;
            case 'fillRect':
                ctx.fillRect(...cmd.args);
                break;
            case 'beginPath':
                ctx.beginPath();
                break;
            case 'arc':
                ctx.arc(...cmd.args);
                break;
            case 'strokeStyle':
                ctx.strokeStyle = cmd.value;
                break;
            case 'lineWidth':
                ctx.lineWidth = cmd.value;
                break;
            case 'stroke':
                ctx.stroke();
                break;
            case 'moveTo':
                ctx.moveTo(...cmd.args);
                break;
            case 'lineTo':
                ctx.lineTo(...cmd.args);
                break;
            case 'createLinearGradient':
                gradients.set(cmd.id, ctx.createLinearGradient(...cmd.args));
                break;
            case 'addColorStop': {
                const gradient = gradients.get(cmd.id);
                if (gradient) {
                    gradient.addColorStop(...cmd.args);
                }
                break;
            }
            case 'strokeStyleGradient': {
                const gradient = gradients.get(cmd.id);
                if (gradient) {
                    ctx.strokeStyle = gradient;
                }
                break;
            }
            case 'font':
                ctx.font = cmd.value;
                break;
            case 'textAlign':
                ctx.textAlign = cmd.value;
                break;
            case 'textBaseline':
                ctx.textBaseline = cmd.value;
                break;
            case 'fillText':
                ctx.fillText(...cmd.args);
                break;
            case 'fill':
                ctx.fill();
                break;
            case 'ellipse':
                ctx.ellipse(...cmd.args);
                break;
        }
    }
}

/** Render a holographic knob face on a canvas (2D fallback when WebGPU is unavailable). */
export function renderKnob2D(
    canvas: HTMLCanvasElement,
    value: number,
    material: KnobMaterial = KNOB_MATERIAL,
    automationOverlay?: KnobAutomationOverlayState,
): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const targetW = Math.max(1, Math.floor(rect.width * dpr));
    const targetH = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    replayKnob2DDrawCalls(
        ctx,
        buildKnob2DDrawCalls(material, value, { w: rect.width, h: rect.height })
    );
    if (automationOverlay && (automationOverlay.showCurve || automationOverlay.indicatorValue !== undefined)) {
        drawKnobAutomationOverlay(ctx, rect.width, rect.height, automationOverlay, material);
    }
    ctx.restore();
}

/** Normalize a parameter-space value to 0–1 for holographic canvas rendering. */
export function knobValueToNormalized(value: number, min: number, max: number): number {
    const range = max - min;
    return range > 0 ? (value - min) / range : 0;
}
