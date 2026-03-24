import React, { forwardRef, useImperativeHandle, useRef, useCallback, useLayoutEffect, memo } from 'react';
import { MelodicStep } from './MelodicStep';
import { GridIndicators } from './GridIndicators';
import { noteToMidi } from '../utils/musicTheory';
import type { PartSequence, TrackKey } from '../types';

/**
 * MelodicSequencerRow - Sequencer row for Melodic Lyric Mode
 * 
 * Displays sampler steps with pitch-based height visualization.
 * Each step shows the note pitch and can be dragged to change pitch.
 */

const TRACK_COLORS: Record<string, string> = {
  partA: '#06b6d4',
  partB: '#d946ef',
  kick: '#f97316',
  snare: '#22c55e',
  closedHat: '#eab308',
  openHat: '#eab308',
  sampler: '#a855f7',
};

interface TrackSlotButtonProps {
  index: number;
  isActive: boolean;
  hasData: boolean;
  trackKey: TrackKey;
  onSelect: (k: TrackKey, slot: number) => void;
}

const TrackSlotButton = memo(({ index, isActive, hasData, trackKey, onSelect }: TrackSlotButtonProps) => {
  const patternColor = TRACK_COLORS[trackKey] || '#22d3ee';
  const inactiveColor = hasData ? patternColor : '#0f1812';

  return (
    <g
      transform={`translate(${index * 22}, 0)`}
      className="track-slot"
      onClick={() => onSelect(trackKey, index)}
      cursor="pointer"
      role="button"
      tabIndex={0}
      aria-label={`Pattern Slot ${index + 1}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(trackKey, index);
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <rect
        width={18}
        height={18}
        rx={2}
        fill={isActive ? patternColor : inactiveColor}
        fillOpacity={isActive ? 1 : (hasData ? 0.4 : 1)}
        stroke={isActive ? '#fff' : patternColor}
        strokeOpacity={isActive ? 1 : 0.6}
        strokeWidth={1}
      />
      <text
        x={9}
        y={13}
        textAnchor="middle"
        fontSize={10}
        fill={isActive ? '#000' : patternColor}
        fontFamily="monospace"
        fontWeight="bold"
      >
        {index + 1}
      </text>
    </g>
  );
});

export interface MelodicSequencerRowHandle {
  setHighlight: (step: number) => void;
}

interface MelodicSequencerRowProps {
  rowKey: TrackKey;
  label: string;
  rowIndex: number;
  steps: (any | null)[];
  isSelected: boolean;
  activeSlot: number;
  trackSlots: (PartSequence | PartSequence[] | null)[];
  onToggle: (k: TrackKey, i: number, e: React.PointerEvent) => void;
  onPitchChange: (k: TrackKey, i: number, pitch: number) => void;
  onEditLength: (k: TrackKey, i: number, len: number) => void;
  onSelectRow: (k: TrackKey) => void;
  onSelectSlot: (k: TrackKey, slot: number) => void;
  zoom?: number;
}

export const MelodicSequencerRow = memo(forwardRef<MelodicSequencerRowHandle, MelodicSequencerRowProps>(
  (props, ref) => {
    const {
      rowKey,
      label,
      rowIndex,
      steps,
      isSelected,
      activeSlot,
      trackSlots,
      onToggle,
      onPitchChange,
      onEditLength,
      onSelectRow,
      onSelectSlot,
      zoom = 1
    } = props;

    const stepRefs = useRef<(SVGGElement | null)[]>([]);
    const lastStepRef = useRef(-1);
    const lastActiveIndexRef = useRef(-1);

    const updateClasses = useCallback((step: number) => {
      let newActiveIndex = -1;

      // Find which step should be highlighted based on current sequencer step
      for (let i = step; i >= 0; i--) {
        if (stepRefs.current[i]) {
          const length = steps[i]?.length || 1;
          if (i + length > step) {
            newActiveIndex = i;
          }
          break;
        }
      }

      if (newActiveIndex !== lastActiveIndexRef.current) {
        if (lastActiveIndexRef.current !== -1) {
          stepRefs.current[lastActiveIndexRef.current]?.classList.remove('is-current');
        }
        if (newActiveIndex !== -1) {
          stepRefs.current[newActiveIndex]?.classList.add('is-current');
        }
        lastActiveIndexRef.current = newActiveIndex;
      } else {
        if (newActiveIndex !== -1) {
          stepRefs.current[newActiveIndex]?.classList.add('is-current');
        }
      }
    }, [steps]);

    useImperativeHandle(ref, () => ({
      setHighlight: (step: number) => {
        if (step === -1) {
          if (lastActiveIndexRef.current !== -1) {
            stepRefs.current[lastActiveIndexRef.current]?.classList.remove('is-current');
            lastActiveIndexRef.current = -1;
          }
          lastStepRef.current = -1;
          return;
        }
        lastStepRef.current = step;
        updateClasses(step);
      }
    }));

    useLayoutEffect(() => {
      const currentActive = lastActiveIndexRef.current;
      lastActiveIndexRef.current = -1;
      if (lastStepRef.current !== -1) {
        updateClasses(lastStepRef.current);
      } else {
        lastActiveIndexRef.current = currentActive;
      }
    }, [updateClasses]);

    // Render steps
    const renderedSteps = [];
    let skipCount = 0;

    for (let i = 0; i < 32; i++) {
      if (skipCount > 0) {
        skipCount--;
        continue;
      }

      const stepData = steps[i];
      const length = stepData?.length || 1;
      const isActive = !!stepData;

      // Default pitch for new notes is C4 (60)
      // If note string exists but pitch doesn't, convert
      let pitch = 60;
      if (stepData?.pitch !== undefined) {
          pitch = stepData.pitch;
      } else if (stepData?.note) {
          pitch = noteToMidi(stepData.note);
      }

      const phonemeIndex = stepData?.sliceIndex; // Use sliceIndex as phoneme index
      const phonemes = stepData?.phonemes; // Pass phoneme data for display

      renderedSteps.push(
        <MelodicStep
          key={i}
          stepIndex={i}
          active={isActive}
          note={stepData?.note || null}
          pitch={pitch}
          phonemeIndex={phonemeIndex}
          phonemes={phonemes}
          length={length}
          isSlide={!!stepData?.slide}
          isCurrent={i === lastActiveIndexRef.current}
          rowLabel={label}
          rowKey={rowKey}
          onToggle={onToggle}
          onPitchChange={onPitchChange}
          onEditLength={onEditLength}
          reverse={stepData?.reverse}
        />
      );

      if (stepData && length > 1) {
        skipCount = length - 1;
      }
    }

    return (
      <g transform={`translate(0, ${rowIndex * 80})`}>
        {/* Track label */}
        <g
          className="track-label"
          onClick={() => onSelectRow(rowKey)}
          cursor="pointer"
          role="button"
          tabIndex={0}
          aria-label={`Select ${label} track`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectRow(rowKey);
            }
          }}
        >
          {isSelected && (
            <rect x={-10} y={8} width={4} height={36} fill="#3fa34d" rx={2} />
          )}
          <text
            x={-20}
            y={30}
            textAnchor="end"
            fontFamily="Orbitron, monospace"
            fontSize={12}
            fill={isSelected ? '#3fa34d' : '#5a6b60'}
            fontWeight={isSelected ? 'bold' : 'normal'}
            style={{ textShadow: isSelected ? '0 0 8px rgba(63,163,77,0.5)' : 'none' }}
          >
            {label.toUpperCase()}
          </text>
        </g>

        {/* Pattern slots */}
        <g transform="translate(30, 16)">
          {[0, 1, 2, 3, 4, 5, 6, 7].map(slot => (
            <TrackSlotButton
              key={slot}
              index={slot}
              isActive={activeSlot === slot}
              hasData={!!trackSlots[slot]}
              trackKey={rowKey}
              onSelect={onSelectSlot}
            />
          ))}
        </g>

        {/* Grid indicators and Steps wrapped in zoom scale */}
        <g transform={`translate(220, 0) scale(${zoom}, 1) translate(-220, 0)`}>
            <GridIndicators />
            {renderedSteps}
        </g>
      </g>
    );
  }
));

export default MelodicSequencerRow;
