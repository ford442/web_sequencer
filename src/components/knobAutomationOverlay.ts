import { KNOB_MATERIAL, wgslAngleFromNormalized, wgslAngleToCanvas } from './knobMaterial';
import type { KnobMaterial } from './knobMaterial';
import { buildKnobArcSvgPath } from '../utils/knobAutomationCurve';

export interface KnobAutomationOverlayState {
  /** Pre-sampled normalized values along the lane for ghost curve. */
  curveSamples?: number[];
  /** Playhead / live automated position on the arc (0–1). */
  indicatorValue?: number;
  /** Whether to draw the ghost curve. */
  showCurve?: boolean;
}

/** Draw automation ghost curve + playhead tick on a 2D knob canvas (after base knob). */
export function drawKnobAutomationOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  overlay: KnobAutomationOverlayState,
  material: KnobMaterial = KNOB_MATERIAL,
): void {
  const cx = width / 2;
  const cy = height / 2;
  const bodyRadius = Math.min(width, height) / 2;
  const arcRadius = bodyRadius * material.geometry.arcRadius;
  const sweepStart = wgslAngleToCanvas(material.geometry.sweepStartAngle);
  const sweepTotal = material.geometry.sweepTotal;

  if (overlay.showCurve && overlay.curveSamples && overlay.curveSamples.length >= 2) {
    ctx.save();
    ctx.beginPath();
    overlay.curveSamples.forEach((v, i) => {
      const wgsl = wgslAngleFromNormalized(v, material.geometry);
      const angle = wgslAngleToCanvas(wgsl);
      const x = cx + Math.cos(angle) * arcRadius;
      const y = cy + Math.sin(angle) * arcRadius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }

  if (overlay.indicatorValue !== undefined) {
    const wgsl = wgslAngleFromNormalized(overlay.indicatorValue, material.geometry);
    const angle = wgslAngleToCanvas(wgsl);
    const ix = cx + Math.cos(angle) * arcRadius;
    const iy = cy + Math.sin(angle) * arcRadius;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ix, iy, bodyRadius * 0.06, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 229, 255, 0.85)';
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.restore();
  }
}

/** SVG ghost arc for GPU knob slots (static curve; indicator updated via transform). */
export function buildKnobAutomationSvgPath(
  curveSamples: number[],
  viewSize: number,
  material: KnobMaterial = KNOB_MATERIAL,
): string {
  const cx = viewSize / 2;
  const cy = viewSize / 2;
  const arcRadius = (viewSize / 2) * material.geometry.arcRadius;
  const sweepStart = wgslAngleToCanvas(material.geometry.sweepStartAngle);
  return buildKnobArcSvgPath(curveSamples, cx, cy, arcRadius, sweepStart, material.geometry.sweepTotal);
}

export function knobIndicatorPosition(
  value: number,
  viewSize: number,
  material: KnobMaterial = KNOB_MATERIAL,
): { x: number; y: number } {
  const cx = viewSize / 2;
  const cy = viewSize / 2;
  const arcRadius = (viewSize / 2) * material.geometry.arcRadius;
  const wgsl = wgslAngleFromNormalized(value, material.geometry);
  const angle = wgslAngleToCanvas(wgsl);
  return { x: cx + Math.cos(angle) * arcRadius, y: cy + Math.sin(angle) * arcRadius };
}
