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

import React, { memo, useCallback, useRef, useState, useMemo } from 'react';
import type { UnifiedAutomationLane, AutomationLanePoint, AutomationInterpolation } from '../../types';
import { automationStore } from '../../stores/automationStore';

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
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);

  const drawWidth = width - PAD.left - PAD.right;
  const drawHeight = height - PAD.top - PAD.bottom;
  const xScale = drawWidth / totalSteps;

  const toX = useCallback((step: number) => PAD.left + step * xScale, [xScale]);
  const toY = useCallback((value: number) => PAD.top + drawHeight * (1 - value), [drawHeight]);

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
    const lines: JSX.Element[] = [];
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
    return buildCurvePath(lane.points, lane.interpolation, totalSteps, drawWidth, drawHeight);
  }, [lane, totalSteps, drawWidth, drawHeight]);

  const handleMouseDown = useCallback((e: React.MouseEvent, idx: number) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.button === 2 && lane) {
      // Right-click: remove point
      const newPoints = lane.points.filter((_, i) => i !== idx);
      automationStore.updateLanePoints(lane.id, newPoints);
      return;
    }
    setDraggingIdx(idx);
  }, [readOnly, lane]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, idx: number) => {
    if (readOnly || !lane) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const newPoints = lane.points.filter((_, i) => i !== idx);
      automationStore.updateLanePoints(lane.id, newPoints);
      return;
    }

    const currentPoint = lane.points[idx];
    const TICKS_PER_STEP = 6;
    const stepIncrement = 1 / TICKS_PER_STEP;
    const valueIncrement = 0.01;

    let newStep = currentPoint.step;
    let newValue = currentPoint.value;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      newValue = Math.min(1, newValue + valueIncrement);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      newValue = Math.max(0, newValue - valueIncrement);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      newStep = Math.max(0, newStep - stepIncrement);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      newStep = Math.min(totalSteps, newStep + stepIncrement);
    } else {
      return;
    }

    newStep = Math.round(newStep * TICKS_PER_STEP) / TICKS_PER_STEP;
    newValue = Math.round(newValue * 1000) / 1000;

    const newPoints = [...lane.points];
    newPoints[idx] = {
      ...newPoints[idx],
      step: newStep,
      value: newValue,
    };
    automationStore.updateLanePoints(lane.id, newPoints);
  }, [readOnly, lane, totalSteps]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (draggingIdx === null || !lane || readOnly) return;
    const coords = fromSvgCoords(e.clientX, e.clientY);
    if (!coords) return;
    const newPoints = [...lane.points];
    newPoints[draggingIdx] = {
      ...newPoints[draggingIdx],
      step: coords.step,
      value: coords.value,
    };
    automationStore.updateLanePoints(lane.id, newPoints);
  }, [draggingIdx, lane, readOnly, fromSvgCoords]);

  const handleMouseUp = useCallback(() => {
    setDraggingIdx(null);
  }, []);

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
    automationStore.updateLanePoints(lane.id, [...lane.points, newPoint]);
  }, [readOnly, lane, fromSvgCoords]);

  if (!lane) {
    return (
      <div
        className="flex items-center justify-center text-xs text-gray-500 italic border border-dashed border-gray-700 rounded"
        style={{ width, height }}
      >
        Select a lane to edit its curve
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="bg-[#0d0f12] rounded border border-gray-700 select-none"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleSvgClick}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`Curve editor for ${lane.name}`}
      role="img"
    >
      {/* Grid */}
      {gridLines}

      {/* Curve path */}
      <g transform={`translate(${PAD.left}, ${PAD.top})`}>
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
      {lane.points.map((point, idx) => {
        const cx = toX(point.step);
        const cy = toY(point.value);
        const isSubStep = point.step % 1 !== 0;
        return (
          <g
            key={idx}
            className="curve-point outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded-full"
            onMouseDown={(e) => handleMouseDown(e, idx)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            onFocus={() => setFocusedIdx(idx)}
            onBlur={() => setFocusedIdx(null)}
            tabIndex={readOnly ? -1 : 0}
            role="button"
            aria-label={`Automation point at step ${point.step}, value ${point.value.toFixed(2)}`}
            style={{ cursor: readOnly ? 'default' : 'grab' }}
          >
            {/* Point circle */}
            <circle
              cx={cx}
              cy={cy}
              r={isSubStep ? 3 : 4}
              fill={point.accent ? '#ef4444' : point.slide ? '#22c55e' : '#06b6d4'}
              stroke="#fff"
              strokeWidth={draggingIdx === idx || focusedIdx === idx ? 2 : 1}
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
      {Array.from({ length: Math.min(totalSteps + 1, 33) }, (_, i) => i).filter((i) => i % 4 === 0).map((i) => (
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
      ))}
    </svg>
  );
});
CurveEditor.displayName = 'CurveEditor';
