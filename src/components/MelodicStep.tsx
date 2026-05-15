import React, { memo, useRef, useCallback, useState } from 'react';
import { getNoteColor } from '../utils/noteColors';
import type { TrackKey } from '../types';

/**
 * MelodicStep - Visual step component for Melodic Lyric Mode
 * 
 * Phase 2 of the Vocal Workstation implementation.
 * Features:
 * - Step height represents pitch (taller = higher note)
 * - Color-coded by note name (C=red, D=orange, etc.)
 * - Drag up/down to change pitch
 * - Displays note name and phoneme index
 */

// MIDI note names
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const midiToNoteName = (midi: number): string => {
  const note = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
};

// Calculate step height based on pitch
// Base height 40px, each semitone adds/subtracts 3px
const calculateStepHeight = (pitch: number): number => {
  // Map pitch 36-96 (C2-C7) to height 40-220px
  const minPitch = 36;
  const maxPitch = 96;
  const minHeight = 40;
  const maxHeight = 220;
  
  const clampedPitch = Math.max(minPitch, Math.min(maxPitch, pitch));
  const normalized = (clampedPitch - minPitch) / (maxPitch - minPitch);
  return minHeight + normalized * (maxHeight - minHeight);
};

interface MelodicStepProps {
  stepIndex: number;
  active: boolean;
  note?: string | null;
  pitch?: number;
  pitchOffset?: number; // Added to interface to fix TS error
  phonemeIndex?: number;
  phonemes?: { id: string; symbol: string; start: number; end: number; pitchBend: number }[]; // Phoneme data for display
  length?: number;
  isSlide?: boolean;
  isCurrent?: boolean;
  rowLabel: string;
  rowKey: TrackKey;
  refsArray: React.MutableRefObject<(SVGGElement | null)[]>;
  onToggle: (rowKey: TrackKey, stepIndex: number, e: React.PointerEvent) => void;
  onPitchChange: (rowKey: TrackKey, stepIndex: number, newPitch: number) => void;
  onEditLength?: (rowKey: TrackKey, stepIndex: number, length: number) => void;
  baseWidth?: number;
  gap?: number;
  x?: number;
  reverse?: boolean;
}

export const MelodicStep = memo(({
  stepIndex,
  active,
  note,
  pitch = 60,
  // pitchOffset - reserved for future microtonal control
  phonemeIndex,
  phonemes,
  length = 1,
  isSlide,
  isCurrent,
  rowLabel,
  rowKey,
  refsArray,
  onToggle,
  onPitchChange,
  onEditLength,
  baseWidth = 18,
  gap = 4,
  x: propX,
  reverse
}: MelodicStepProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartPitch = useRef(60);
  const elementRef = useRef<SVGGElement>(null);
  
  // Calculate position
  const x = propX ?? 220 + stepIndex * (baseWidth + gap);
  const totalWidth = (baseWidth * length) + (gap * (length - 1));
  
  // Calculate visual height based on pitch
  const height = active ? calculateStepHeight(pitch) : 50;
  const y = active ? 50 - height + 40 : 0; // Anchor to bottom
  
  // Get colors
  const noteName = note || midiToNoteName(pitch);
  const color = getNoteColor(noteName, rowKey);
  const borderColor = pitch ? getNoteColor(midiToNoteName(pitch), rowKey) : color;
  
  // Group index for alternating background
  const groupIndex = Math.floor(stepIndex / 4);
  const isAltGroup = groupIndex % 2 === 1;
  const baseFill = active ? '#0d1f15' : (isAltGroup ? '#1c2229' : '#14181c');

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Check for Alt+Click - pass through to onToggle for PhonemePainter
    if (e.altKey && active) {
      onToggle(rowKey, stepIndex, e);
      return;
    }
    
    if (e.button === 2) {
      e.preventDefault();
      // Right click - handle length edit if shift is held
      if (e.shiftKey && onEditLength && active) {
        e.preventDefault();
        const target = e.currentTarget as Element;
        target.setPointerCapture(e.pointerId);
        
        const startX = e.clientX;
        const startLength = length;
        const sensitivity = 20;
        
        const handlePointerMove = (ev: PointerEvent) => {
          const delta = ev.clientX - startX;
          const stepsToAdd = Math.floor(delta / sensitivity);
          const newLength = Math.max(1, Math.min(16, startLength + stepsToAdd));
          if (newLength !== length) {
            onEditLength(rowKey, stepIndex, newLength);
          }
        };
        
        const handlePointerUp = (ev: PointerEvent) => {
          target.removeEventListener('pointermove', handlePointerMove as any);
          target.removeEventListener('pointerup', handlePointerUp as any);
          target.releasePointerCapture(ev.pointerId);
        };
        
        target.addEventListener('pointermove', handlePointerMove as any);
        target.addEventListener('pointerup', handlePointerUp as any);
      }
      return;
    }
    
    if (!active) {
      // Inactive step - just toggle on
      onToggle(rowKey, stepIndex, e);
      return;
    }
    
    // Active step - start pitch drag
    e.preventDefault();
    e.stopPropagation();
    
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);
    
    dragStartY.current = e.clientY;
    dragStartPitch.current = pitch;
    setIsDragging(true);
    
    const handlePointerMove = (ev: PointerEvent) => {
      const deltaY = dragStartY.current - ev.clientY;
      // 8 pixels per semitone
      const semitoneDelta = Math.round(deltaY / 8);
      const newPitch = Math.max(36, Math.min(96, dragStartPitch.current + semitoneDelta));
      
      if (newPitch !== pitch) {
        onPitchChange(rowKey, stepIndex, newPitch);
      }
    };
    
    const handlePointerUp = (ev: PointerEvent) => {
      target.removeEventListener('pointermove', handlePointerMove as any);
      target.removeEventListener('pointerup', handlePointerUp as any);
      target.releasePointerCapture(ev.pointerId);
      setIsDragging(false);
    };
    
    target.addEventListener('pointermove', handlePointerMove as any);
    target.addEventListener('pointerup', handlePointerUp as any);
  }, [active, pitch, length, rowKey, stepIndex, onToggle, onPitchChange, onEditLength]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!active) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle(rowKey, stepIndex, e as unknown as React.PointerEvent);
      }
      return;
    }
    
    let newPitch = pitch;
    let handled = true;
    
    switch (e.key) {
      case 'ArrowUp':
        newPitch = Math.min(96, pitch + 1);
        break;
      case 'ArrowDown':
        newPitch = Math.max(36, pitch - 1);
        break;
      case 'PageUp':
        newPitch = Math.min(96, pitch + 12);
        break;
      case 'PageDown':
        newPitch = Math.max(36, pitch - 12);
        break;
      case 'Home':
        newPitch = 36;
        break;
      case 'End':
        newPitch = 96;
        break;
      default:
        handled = false;
    }
    
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      onPitchChange(rowKey, stepIndex, newPitch);
    }
  }, [active, pitch, rowKey, stepIndex, onToggle, onPitchChange]);

  if (!active) {
    // Render inactive step (standard look)
    return (
      <g
        ref={(el) => {
          // @ts-ignore - TS complains about assigning to read-only ref, but this is a common pattern
          elementRef.current = el;
          if (refsArray && refsArray.current) {
            refsArray.current[stepIndex] = el;
          }
        }}
        transform={`translate(${x}, 0)`}
        className="svg-step melodic-step"
        role="button"
        tabIndex={0}
        aria-label={`${rowLabel} step ${stepIndex + 1}`}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        onContextMenu={(e) => e.preventDefault()}
        cursor="pointer"
        style={{ transition: 'all 0.1s ease', touchAction: 'none' }}
      >
        <rect x={0} y={0} width={baseWidth} height={50} rx={3} fill="#050505" />
        <rect x={1} y={1} width={baseWidth - 2} height={48} rx={2} fill={baseFill} strokeWidth={0} />
        <path d={`M 2 2 L ${baseWidth - 2} 2 L ${baseWidth - 4} 4 L 4 4 L 4 46 L 2 48 Z`} fill="rgba(255,255,255,0.1)" />
        <path d={`M ${baseWidth - 2} 2 L ${baseWidth - 2} 48 L 2 48 L 4 46 L ${baseWidth - 4} 46 L ${baseWidth - 4} 4 Z`} fill="rgba(0,0,0,0.5)" />
      </g>
    );
  }

  return (
    <g
      ref={(el) => {
        // @ts-ignore
        elementRef.current = el;
        if (refsArray && refsArray.current) {
          refsArray.current[stepIndex] = el;
        }
      }}
      transform={`translate(${x}, ${y})`}
      className={`svg-step melodic-step ${isCurrent ? 'is-current' : ''} ${isDragging ? 'is-dragging' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${rowLabel} step ${stepIndex + 1}, pitch ${midiToNoteName(pitch)}`}
      aria-pressed={active}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      cursor={isDragging ? 'ns-resize' : 'pointer'}
      style={{ 
        transition: isDragging ? 'none' : 'all 0.15s ease-out',
        touchAction: 'none',
        filter: isDragging ? 'drop-shadow(0 0 8px rgba(147, 51, 234, 0.8))' : 'none'
      }}
    >
      {/* Glow effect */}
      <rect 
        className="step-glow" 
        x={-4} 
        y={-4} 
        width={totalWidth + 8} 
        height={height + 8} 
        rx={6} 
        fill={color} 
        fillOpacity={isCurrent ? 0.5 : 0.3} 
        filter="blur(6px)" 
      />
      
      {/* Background */}
      <rect 
        x={0} 
        y={0} 
        width={totalWidth} 
        height={height} 
        rx={3} 
        fill="#050505" 
        stroke={borderColor}
        strokeWidth={2}
        strokeOpacity={0.8}
      />
      
      {/* Inner fill */}
      <rect 
        x={2} 
        y={2} 
        width={totalWidth - 4} 
        height={height - 4} 
        rx={2} 
        fill={baseFill}
      />
      
      {/* Top highlight */}
      <path 
        d={`M 2 2 L ${totalWidth - 2} 2 L ${totalWidth - 4} 4 L 4 4 L 4 ${height - 4} L 2 ${height - 2} Z`} 
        fill="rgba(255,255,255,0.15)" 
      />
      
      {/* Bottom shadow */}
      <path 
        d={`M ${totalWidth - 2} 2 L ${totalWidth - 2} ${height - 2} L 2 ${height - 2} L 4 ${height - 4} L ${totalWidth - 4} ${height - 4} L ${totalWidth - 4} 4 Z`} 
        fill="rgba(0,0,0,0.5)" 
      />
      
      {/* Active color cap */}
      <rect 
        className="step-cap" 
        x={3} 
        y={4} 
        width={totalWidth - 6} 
        height={Math.max(20, height - 8)} 
        rx={1} 
        fill={color} 
        fillOpacity={0.5}
        stroke={color}
        strokeWidth={1}
        strokeOpacity={0.8}
      />
      
      {/* Note name label */}
      <text
        x={totalWidth / 2}
        y={Math.min(height - 10, 35)}
        textAnchor="middle"
        fontSize={9}
        fill="white"
        fontWeight="bold"
        fontFamily="monospace"
        style={{ pointerEvents: 'none', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
      >
        {midiToNoteName(pitch)}
      </text>
      
      {/* Phoneme index (if set) */}
      {phonemeIndex !== undefined && (
        <g transform={`translate(${totalWidth - 20}, 8)`}>
          <circle r={8} fill="#000" fillOpacity={0.6} />
          <text
            x={0}
            y={3}
            textAnchor="middle"
            fontSize={8}
            fill="#a855f7"
            fontWeight="bold"
            fontFamily="monospace"
            style={{ pointerEvents: 'none' }}
          >
            {phonemeIndex}
          </text>
        </g>
      )}
      
      {/* Phoneme data indicator (shows 'P' badge when phonemes array exists) */}
      {phonemes && phonemes.length > 0 && (
        <g transform={`translate(${totalWidth - 20}, phonemeIndex !== undefined ? 24 : 8})`}>
          <circle r={8} fill="#06b6d4" fillOpacity={0.8} />
          <text
            x={0}
            y={3}
            textAnchor="middle"
            fontSize={7}
            fill="#000"
            fontWeight="bold"
            fontFamily="monospace"
            style={{ pointerEvents: 'none' }}
          >
            P
          </text>
        </g>
      )}
      
      {/* Reverse indicator */}
      {reverse && (
        <g transform={`translate(${totalWidth / 2 - 8}, ${Math.min(height - 25, 20)})`} style={{ pointerEvents: 'none' }}>
          <path
            d="M 12 4 L 4 10 L 12 16 Z"
            fill="#a855f7"
            fillOpacity={0.8}
            filter="drop-shadow(0px 1px 2px rgba(0,0,0,0.5))"
          />
        </g>
      )}

      {/* Slide indicator */}
      {isSlide && (
        <rect 
          x={4} 
          y={height - 12} 
          width={totalWidth - 8} 
          height={4} 
          rx={1} 
          fill="#fbbf24" 
          fillOpacity={1}
          style={{ mixBlendMode: 'plus-lighter' }}
        />
      )}
      
      {/* LED indicator at bottom */}
      <rect 
        className="step-led" 
        x={5} 
        y={height - 8} 
        width={totalWidth - 10} 
        height={3} 
        rx={1} 
        fill={isCurrent ? '#ccffcc' : color} 
        fillOpacity={isCurrent ? 1 : 0.6}
      />
      
      {/* Length indicator */}
      {length > 1 && (
        <g pointerEvents="none" transform={`translate(${totalWidth - 25}, ${height - 22})`}>
          <rect width={20} height={14} rx={3} fill="#000" fillOpacity={0.6} />
          <text 
            x={10} 
            y={10} 
            textAnchor="middle" 
            fontSize={9} 
            fill="#fff" 
            fontWeight="bold" 
            fontFamily="monospace"
          >
            {length}x
          </text>
        </g>
      )}
    </g>
  );
}, (prev: any, next: any) => {
  return (
    prev.stepIndex === next.stepIndex &&
    prev.active === next.active &&
    prev.note === next.note &&
    prev.pitch === next.pitch &&
    prev.phonemeIndex === next.phonemeIndex &&
    prev.length === next.length &&
    prev.isSlide === next.isSlide &&
    prev.isCurrent === next.isCurrent &&
    prev.reverse === next.reverse &&
    prev.phonemes === next.phonemes
  );
});

export default MelodicStep;
