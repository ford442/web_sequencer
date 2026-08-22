/**
 * CurveEditor — SVG-based automation curve visualization and editing.
 *
 * Features:
 * - Renders automation points as a curve (step/linear/smooth)
 * - Supports sub-step resolution (fractional step positions for 24-PPQ TRAK events)
 * - Displays accent/slide flags as visual indicators per point
 * - Click to add points, drag to move, right-click to remove
 * - Shows grid lines at integer step boundaries
 * - Playback position indicator
 *
 * @see Issue #669 — Automation Curve Editor UI, Lane List, Per-Bank Sampler Targeting
 */

import React, { memo, useCallback, useRef, useState, useMemo, useEffect } from 'react';
import type { UnifiedAutomationLane, AutomationLanePoint, AutomationInterpolation } from '../../types';
import { automationStore } from '../../stores/automationStore';
import { useWebGPUCurveEditor } from '../../hooks/automation/useWebGPUCurveEditor';

export interface CurveEditorProps {
  /** The lane to display/edit */
  lane: UnifiedAutomationLane | null;
  /** Total number of steps to display (default: 32) */
  totalSteps?: number;
  /** Current playback step position */
  playbackStep?: number;
  /** Editor width in px (default: 600) */
  width?: number;
  /** Editor height in px (default: 150) */
  height?: number;
  /** Whether the editor is read-only */
  readOnly?: boolean;
}

/** Padding around the drawing area */
const PAD = { top: 12, right: 8, bottom: 20, left: 8 };

/**
 * Generate SVG path data for the curve based on interpolation mode.
 */
function buildCurvePath(
  points: AutomationLanePoint[],
  interpolation: AutomationInterpolation,
  totalSteps: number,
  drawWidth: number,
  drawHeight: number
): string {
  if (points.length === 0) return '';

  const xScale = drawWidth / totalSteps;
  const toX = (step: number) => step * xScale;
  const toY = (value: number) => drawHeight * (1 - value);

  const sorted = [...points].sort((a, b) => a.step - b.step);
  const parts: string[] = [];

  parts.push(`M ${toX(sorted[0].step)} ${toY(sorted[0].value)}`);

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const interp = prev.interpolation || interpolation;

    if (interp === 'step') {
      // Step: horizontal then vertical
      parts.push(`L ${toX(curr.step)} ${toY(prev.value)}`);
      parts.push(`L ${toX(curr.step)} ${toY(curr.value)}`);
    } else if (interp === 'smooth') {
      // Smooth: cubic bezier approximation of smoothstep
      const midX = (toX(prev.step) + toX(curr.step)) / 2;
      parts.push(`C ${midX} ${toY(prev.value)}, ${midX} ${toY(curr.value)}, ${toX(curr.step)} ${toY(curr.value)}`);
    } else {
      // Linear
      parts.push(`L ${toX(curr.step)} ${toY(curr.value)}`);
    }
  }

  return parts.join(' ');
}

export const CurveEditor = memo(({
  lane,
  totalSteps = 32,
  playbackStep,
  width = 600,
  height = 150,
  readOnly = false,
}: CurveEditorProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [localPoints, setLocalPoints] = useState<AutomationLanePoint[]>([]);

  // Sync local points with global store when not dragging
  useEffect(() => {
    if (draggingIdx === null && lane) {
      setLocalPoints(lane.points);
    }
  }, [lane?.points, draggingIdx]);

  const drawWidth = width - PAD.left - PAD.right;
  const drawHeight = height - PAD.top - PAD.bottom;
  const xScale = drawWidth / totalSteps;

  const toX = useCallback((step: number) => PAD.left + step * xScale, [xScale]);
  const toY = useCallback((value: number) => PAD.top + drawHeight * (1 - value), [drawHeight]);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useWebGPUCurveEditor(
    canvasRef,
    localPoints,
    lane?.interpolation || 'linear',
    totalSteps,
    drawWidth,
    drawHeight
  );

  const fromSvgCoords = useCallback((clientX: number, clientY: number): { step: number; value: number } | null => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const x = clientX - rect.left - PAD.left;
    const y = clientY - rect.top - PAD.top;
    const step = Math.max(0, Math.min(totalSteps, x / xScale));
    const value = Math.max(0, Math.min(1, 1 - y / drawHeight));
    // Quantize to 1/6 step increments (= 1 tick at 24 PPQ, since 6 ticks = 1 sixteenth-note step)
    const TICKS_PER_STEP = 6;
    return { step: Math.round(step * TICKS_PER_STEP) / TICKS_PER_STEP, value: Math.round(value * 1000) / 1000 };
  }, [totalSteps, xScale, drawHeight]);

  // Grid lines
  const gridLines = useMemo(() => {
    const lines: React.JSX.Element[] = [];
    for (let i = 0; i <= totalSteps; i++) {
      const x = toX(i);
      const isBeat = i % 4 === 0;
      lines.push(
        <line
          key={`v${i}`}
          x1={x} y1={PAD.top} x2={x} y2={PAD.top + drawHeight}
          stroke={isBeat ? '#3a3d46' : '#2a2d36'}
          strokeWidth={isBeat ? 1 : 0.5}
        />
      );
    }
    // Horizontal value lines at 0, 0.25, 0.5, 0.75, 1
    for (let v = 0; v <= 1; v += 0.25) {
      const y = toY(v);
      lines.push(
        <line
          key={`h${v}`}
          x1={PAD.left} y1={y} x2={PAD.left + drawWidth} y2={y}
          stroke="#2a2d36"
          strokeWidth={v === 0 || v === 1 ? 1 : 0.5}
        />
      );
    }
    return lines;
  }, [totalSteps, toX, toY, drawWidth, drawHeight]);

  // Curve path
  const pathData = useMemo(() => {
    if (!lane) return '';
    return buildCurvePath(localPoints, lane.interpolation, totalSteps, drawWidth, drawHeight);
  }, [lane, localPoints, totalSteps, drawWidth, drawHeight]);

  const handlePointerDown = useCallback((e: React.PointerEvent, idx: number) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.button === 2 && lane) {
      // Right-click: remove point
      const newPoints = localPoints.filter((_, i) => i !== idx);
      automationStore.updateLanePoints(lane.id, newPoints);
      return;
    }
    setDraggingIdx(idx);

    // Set pointer capture for robust dragging outside the element
    if (svgRef.current) {
        svgRef.current.setPointerCapture(e.pointerId);
    }
  }, [readOnly, lane, localPoints]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (draggingIdx === null || !lane || readOnly) return;
    const coords = fromSvgCoords(e.clientX, e.clientY);
    if (!coords) return;
    // Update local state for immediate feedback
    const newPoints = [...localPoints];
    newPoints[draggingIdx] = {
      ...newPoints[draggingIdx],
      step: coords.step,
      value: coords.value,
    };
    setLocalPoints(newPoints);
  }, [draggingIdx, lane, readOnly, fromSvgCoords, localPoints]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (draggingIdx !== null && lane) {
        // Flush to global store
        automationStore.updateLanePoints(lane.id, localPoints);
    }
    setDraggingIdx(null);

    // Release pointer capture
    if (svgRef.current && svgRef.current.hasPointerCapture(e.pointerId)) {
        svgRef.current.releasePointerCapture(e.pointerId);
    }
  }, [draggingIdx, lane, localPoints]);

  const handleSvgClick = useCallback((e: React.MouseEvent) => {
    if (readOnly || !lane) return;
    // Only add point if clicking on empty area (not on an existing point)
    if ((e.target as Element).closest('.curve-point')) return;
    const coords = fromSvgCoords(e.clientX, e.clientY);
    if (!coords) return;
    const newPoint: AutomationLanePoint = {
      step: coords.step,
      value: coords.value,
    };
    automationStore.updateLanePoints(lane.id, [...localPoints, newPoint]);
  }, [readOnly, lane, fromSvgCoords, localPoints]);

  if (!lane) {
    return (
      <div
        className="flex flex-col items-center justify-center py-12 px-4 text-center bg-gray-800/20 border border-dashed border-gray-700 rounded-lg"
        style={{ width, height }}
      >
        <div className="w-12 h-12 rounded-full bg-cyan-900/30 flex items-center justify-center mb-4 text-cyan-500" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        </div>
        <h3 className="text-gray-300 font-bold mb-2 text-sm">No Lane Selected</h3>
        <p className="text-gray-500 text-xs mb-6 max-w-[250px]">
          Select an automation lane from the list to edit its curve.
        </p>
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="bg-[#0d0f12] rounded border border-gray-700 select-none"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={handleSvgClick}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`Curve editor for ${lane.name}`}
      role="img"
    >
      {/* Grid */}
      {gridLines}

      {/* WebGPU Canvas for curve */}
      <foreignObject x={PAD.left} y={PAD.top} width={drawWidth} height={drawHeight}>
        <canvas ref={canvasRef} width={drawWidth} height={drawHeight} style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }} />
      </foreignObject>

      {/* Curve path for SVG fallback (hidden via CSS if WebGPU is active, but left here for graceful degradation) */}
      <g transform={`translate(${PAD.left}, ${PAD.top})`} className="webgpu-fallback-svg">
        <path
          d={pathData}
          fill="none"
          stroke="#06b6d4"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </g>

      {/* Playback position */}
      {playbackStep !== undefined && (
        <line
          x1={toX(playbackStep)}
          y1={PAD.top}
          x2={toX(playbackStep)}
          y2={PAD.top + drawHeight}
          stroke="#f59e0b"
          strokeWidth={1}
          opacity={0.7}
        />
      )}

      {/* Points */}
      {localPoints.map((point, idx) => {
        const cx = toX(point.step);
        const cy = toY(point.value);
        const isSubStep = point.step % 1 !== 0;
        return (
          <g
            key={idx}
            className="curve-point outline-none focus:stroke-cyan-200 focus:stroke-[2px]"
            onPointerDown={(e) => handlePointerDown(e, idx)}
            style={{ cursor: readOnly ? 'default' : 'grab' }}
            tabIndex={readOnly ? -1 : 0}
            role="button"
            aria-label={`Automation point ${idx + 1}, step ${point.step.toFixed(2)}, value ${point.value.toFixed(2)}`}
            onKeyDown={(e) => {
              if (readOnly) return;
              if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                const newPoints = localPoints.filter((_, i) => i !== idx);
                automationStore.updateLanePoints(lane.id, newPoints);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const newPoints = [...localPoints]; newPoints[idx] = { ...point, value: Math.min(1, point.value + 0.05) }; automationStore.updateLanePoints(lane.id, newPoints);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                const newPoints = [...localPoints]; newPoints[idx] = { ...point, value: Math.max(0, point.value - 0.05) }; automationStore.updateLanePoints(lane.id, newPoints);
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                const newPoints = [...localPoints]; newPoints[idx] = { ...point, step: Math.max(0, point.step - 0.25) }; automationStore.updateLanePoints(lane.id, newPoints);
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                const newPoints = [...localPoints]; newPoints[idx] = { ...point, step: Math.min(totalSteps || 16, point.step + 0.25) }; automationStore.updateLanePoints(lane.id, newPoints);
              }
            }}
          >
            {/* Point circle */}
            <circle
              cx={cx}
              cy={cy}
              r={isSubStep ? 3 : 4}
              fill={point.accent ? '#ef4444' : point.slide ? '#22c55e' : '#06b6d4'}
              stroke="#fff"
              strokeWidth={draggingIdx === idx ? 2 : 1}
              opacity={0.9}
            />
            {/* Accent indicator (triangle above) */}
            {point.accent && (
              <polygon
                points={`${cx},${cy - 8} ${cx - 3},${cy - 5} ${cx + 3},${cy - 5}`}
                fill="#ef4444"
                opacity={0.8}
              />
            )}
            {/* Slide indicator (arrow to right) */}
            {point.slide && (
              <polygon
                points={`${cx + 6},${cy} ${cx + 3},${cy - 2} ${cx + 3},${cy + 2}`}
                fill="#22c55e"
                opacity={0.8}
              />
            )}
            {/* Sub-step indicator (diamond shape) */}
            {isSubStep && (
              <rect
                x={cx - 2}
                y={cy + 5}
                width={4}
                height={4}
                transform={`rotate(45, ${cx}, ${cy + 7})`}
                fill="#f59e0b"
                opacity={0.6}
              />
            )}
          </g>
        );
      })}

      {/* Step labels */}
      {/* ⚡ Bolt: Replaced Array.from().filter().map() with an IIFE and for loop to prevent array allocations on hot re-render path */}
      {(() => {
        const labels = [];
        const maxStep = Math.min(totalSteps, 32);
        for (let i = 0; i <= maxStep; i += 4) {
          labels.push(
            <text
              key={`label${i}`}
              x={toX(i)}
              y={height - 4}
              textAnchor="middle"
              fontSize={9}
              fill="#6b7280"
            >
              {i}
            </text>
          );
        }
        return labels;
      })()}
    </svg>
  );
});
CurveEditor.displayName = 'CurveEditor';
