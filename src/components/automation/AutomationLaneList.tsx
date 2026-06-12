/**
 * AutomationLaneList — Displays all automation lanes with controls.
 *
 * Features:
 * - Lists all lanes with name, target, parameter, and interpolation mode
 * - Toggle lane enabled/disabled
 * - Select lane for editing in the CurveEditor
 * - Remove lanes
 *
 * @see Issue #669 — Automation Curve Editor UI, Lane List, Per-Bank Sampler Targeting
 */

import React, { memo, useCallback } from 'react';
import { useAutomationStore, automationStore } from '../../stores/automationStore';
import type { UnifiedAutomationLane, AutomationInterpolation } from '../../types';

export interface AutomationLaneListProps {
  /** Currently selected lane ID for editing */
  selectedLaneId?: string;
  /** Callback when a lane is selected for editing */
  onSelectLane?: (laneId: string) => void;
}

const INTERPOLATION_LABELS: Record<AutomationInterpolation, string> = {
  step: 'Step',
  linear: 'Linear',
  smooth: 'Smooth',
};

const LaneRow = memo(({
  lane,
  isSelected,
  onSelect,
  onToggle,
  onRemove,
  onInterpolationChange,
}: {
  lane: UnifiedAutomationLane;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onInterpolationChange: (id: string, interp: AutomationInterpolation) => void;
}) => {
  const pointCount = lane.points.length;
  const hasAccent = lane.points.some((p) => p.accent);
  const hasSlide = lane.points.some((p) => p.slide);
  const hasSubStep = lane.points.some((p) => p.step % 1 !== 0);

  return (
    <div
      role="listitem"
      aria-selected={isSelected}
      tabIndex={0}
      className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1d24] ${
        isSelected ? 'bg-cyan-900/40 border border-cyan-500/50' : 'bg-[#1a1d24] hover:bg-[#22262f]'
      }`}
      onClick={() => onSelect(lane.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(lane.id);
        }
      }}
    >
      {/* Enable/Disable toggle */}
      <button
        aria-label={`${lane.enabled ? 'Disable' : 'Enable'} lane ${lane.name}`}
        className={`w-4 h-4 rounded-sm border flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1d24] ${
          lane.enabled ? 'bg-cyan-500 border-cyan-400' : 'bg-transparent border-gray-500'
        }`}
        onClick={(e) => { e.stopPropagation(); onToggle(lane.id); }}
      />

      {/* Lane info */}
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium text-gray-200">{lane.name}</div>
        <div className="flex gap-1 text-[10px] text-gray-400">
          <span>{lane.target}</span>
          <span>·</span>
          <span>{lane.parameter}</span>
          <span>·</span>
          <span>{pointCount}pts</span>
          {hasSubStep && <span className="text-amber-400" title="Sub-step resolution">⬡</span>}
          {hasAccent && <span className="text-red-400" title="Has accent flags">A</span>}
          {hasSlide && <span className="text-green-400" title="Has slide flags">S</span>}
        </div>
      </div>

      {/* Interpolation selector */}
      <select
        aria-label={`Interpolation mode for ${lane.name}`}
        className="bg-[#2a2d36] text-gray-300 text-[10px] rounded px-1 py-0.5 border border-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1d24]"
        value={lane.interpolation}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onInterpolationChange(lane.id, e.target.value as AutomationInterpolation)}
      >
        {Object.entries(INTERPOLATION_LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>

      {/* Source badge */}
      <span className={`text-[9px] px-1 rounded ${
        lane.source === 'rbs' ? 'bg-purple-900/50 text-purple-300' :
        lane.source === 'recorded' ? 'bg-red-900/50 text-red-300' :
        lane.source === 'ai' ? 'bg-blue-900/50 text-blue-300' :
        'bg-gray-700 text-gray-300'
      }`}>
        {lane.source}
      </span>

      {/* Remove button */}
      <button
        aria-label={`Remove lane ${lane.name}`}
        className="text-gray-500 hover:text-red-400 flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1d24] rounded"
        onClick={(e) => { e.stopPropagation(); onRemove(lane.id); }}
      >
        ✕
      </button>
    </div>
  );
});
LaneRow.displayName = 'LaneRow';

export const AutomationLaneList = memo(({ selectedLaneId, onSelectLane }: AutomationLaneListProps) => {
  const state = useAutomationStore();

  const handleToggle = useCallback((id: string) => {
    automationStore.toggleLaneEnabled(id);
  }, []);

  const handleRemove = useCallback((id: string) => {
    automationStore.removeLane(id);
  }, []);

  const handleInterpolationChange = useCallback((id: string, interp: AutomationInterpolation) => {
    automationStore.updateLaneInterpolation(id, interp);
  }, []);

  const handleSelect = useCallback((id: string) => {
    onSelectLane?.(id);
  }, [onSelectLane]);

  if (state.lanes.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic px-2 py-4 text-center">
        No automation lanes. Record knob movements or import an .rbs file.
      </div>
    );
  }

  return (
    <div role="list" aria-label="Automation Lanes" className="flex flex-col gap-1 p-1 max-h-64 overflow-y-auto">
      {state.lanes.map((lane) => (
        <LaneRow
          key={lane.id}
          lane={lane}
          isSelected={lane.id === selectedLaneId}
          onSelect={handleSelect}
          onToggle={handleToggle}
          onRemove={handleRemove}
          onInterpolationChange={handleInterpolationChange}
        />
      ))}
    </div>
  );
});
AutomationLaneList.displayName = 'AutomationLaneList';
