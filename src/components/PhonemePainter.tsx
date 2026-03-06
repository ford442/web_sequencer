/**
 * PhonemePainter - Live Phoneme Painter Popover Component
 * 
 * Phase 3 of the Vocal Workstation implementation.
 * A popover/modal interface for editing phonemes on melodic sampler steps.
 * 
 * Features:
 * - Draggable phoneme blocks with timing offset
 * - Resize handles for duration adjustment
 * - Per-phoneme pitch bend controls
 * - Waveform visualization
 * - Auto-Align using PhonemeAligner
 * - Add/Delete phonemes
 * - Holographic/faux-plastic aesthetic
 */

import React, { useState, useRef, useCallback, useEffect, useMemo, memo } from 'react';
import type { PhonemeData, Note } from '../types';
import { PhonemeAligner, type AlignmentResult, type PhonemeSegment } from '../engines/rubberband/PhonemeAligner';

// ARPABET phoneme to readable name
const PHONEME_NAMES: Record<string, string> = {
  'AA': 'a', 'AE': 'æ', 'AH': 'ʌ', 'AO': 'ɔ', 'AW': 'aw',
  'AY': 'ay', 'EH': 'e', 'ER': 'er', 'EY': 'ey', 'IH': 'i',
  'IY': 'ee', 'OW': 'ow', 'OY': 'oy', 'UH': 'uh', 'UW': 'oo',
  'P': 'p', 'B': 'b', 'T': 't', 'D': 'd', 'K': 'k', 'G': 'g',
  'CH': 'ch', 'JH': 'j', 'F': 'f', 'V': 'v', 'TH': 'th',
  'DH': 'dh', 'S': 's', 'Z': 'z', 'SH': 'sh', 'ZH': 'zh',
  'HH': 'h', 'M': 'm', 'N': 'n', 'NG': 'ng', 'L': 'l',
  'R': 'r', 'W': 'w', 'Y': 'y'
};

// Common phonemes for quick add
const COMMON_PHONEMES = [
  { cat: 'Vowels', phones: ['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'] },
  { cat: 'Plosives', phones: ['P', 'B', 'T', 'D', 'K', 'G'] },
  { cat: 'Fricatives', phones: ['F', 'V', 'TH', 'S', 'Z', 'SH', 'HH'] },
  { cat: 'Nasals', phones: ['M', 'N', 'NG'] },
  { cat: 'Liquids', phones: ['L', 'R', 'W', 'Y'] },
  { cat: 'Affricates', phones: ['CH', 'JH'] }
];

// Get phoneme color based on category
const getPhonemeColor = (phoneme: string): string => {
  const ph = phoneme.toUpperCase();
  // Vowels - Purple
  if (['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'].includes(ph)) 
    return '#a855f7';
  // Plosives - Red
  if (['P', 'B', 'T', 'D', 'K', 'G'].includes(ph)) return '#ef4444';
  // Fricatives - Green
  if (['F', 'V', 'TH', 'DH', 'S', 'Z', 'SH', 'ZH', 'HH'].includes(ph)) return '#22c55e';
  // Affricates - Orange
  if (['CH', 'JH'].includes(ph)) return '#f97316';
  // Nasals - Blue
  if (['M', 'N', 'NG'].includes(ph)) return '#3b82f6';
  // Liquids/Glides - Cyan
  if (['L', 'R', 'W', 'Y'].includes(ph)) return '#06b6d4';
  return '#6b7280';
};

// Generate unique ID
const generateId = () => `ph_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// --- SUB-COMPONENTS ---

interface PhonemeBlockProps {
  phoneme: PhonemeData;
  index: number;
  isSelected: boolean;
  pixelsPerUnit: number;
  timelineWidth: number;
  onDrag: (id: string, deltaX: number) => void;
  onResizeStart: (id: string, side: 'left' | 'right') => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onPitchBendChange: (id: string, bend: number) => void;
}

const PhonemeBlock = memo(({
  phoneme,
  index,
  isSelected,
  pixelsPerUnit,
  timelineWidth,
  onDrag,
  onResizeStart,
  onSelect,
  onDelete,
  onPitchBendChange
}: PhonemeBlockProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartLeft = useRef(0);
  const color = getPhonemeColor(phoneme.symbol);
  const displayName = PHONEME_NAMES[phoneme.symbol.toUpperCase()] || phoneme.symbol;
  
  // Calculate position
  const left = phoneme.start * timelineWidth;
  const width = Math.max(24, (phoneme.end - phoneme.start) * timelineWidth);
  const pitchPercent = 50 - (phoneme.pitchBend / 200) * 50; // Map -100..+100 to 100%..0%

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);
    
    dragStartX.current = e.clientX;
    dragStartLeft.current = phoneme.start;
    setIsDragging(true);
    onSelect(phoneme.id);
    
    const handlePointerMove = (ev: PointerEvent) => {
      const deltaX = ev.clientX - dragStartX.current;
      onDrag(phoneme.id, deltaX);
    };
    
    const handlePointerUp = (ev: PointerEvent) => {
      target.removeEventListener('pointermove', handlePointerMove as any);
      target.removeEventListener('pointerup', handlePointerUp as any);
      target.releasePointerCapture(ev.pointerId);
      setIsDragging(false);
    };
    
    target.addEventListener('pointermove', handlePointerMove as any);
    target.addEventListener('pointerup', handlePointerUp as any);
  }, [phoneme.id, phoneme.start, onDrag, onSelect]);

  return (
    <div
      className={`absolute top-8 h-16 rounded-lg flex flex-col overflow-hidden select-none transition-all duration-100 ${
        isSelected 
          ? 'ring-2 ring-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.5)] z-20' 
          : 'hover:ring-1 hover:ring-white/30 z-10'
      } ${isDragging ? 'cursor-grabbing opacity-90' : 'cursor-grab'}`}
      style={{
        left,
        width,
        background: `linear-gradient(180deg, ${color}40 0%, ${color}20 50%, #18181b 100%)`,
        border: `1px solid ${color}`,
        boxShadow: isDragging ? `0 8px 30px ${color}60, inset 0 1px 0 rgba(255,255,255,0.1)` : 'inset 0 1px 0 rgba(255,255,255,0.05)'
      }}
    >
      {/* Main block content */}
      <div 
        className="flex-1 flex flex-col items-center justify-center relative"
        onPointerDown={handlePointerDown}
      >
        {/* Phoneme symbol */}
        <span className="text-xs font-bold text-white font-mono drop-shadow-md tracking-wider">
          {phoneme.symbol}
        </span>
        
        {/* Phoneme name */}
        <span className="text-[9px] text-white/60 font-mono">
          {displayName}
        </span>
        
        {/* Pitch bend indicator */}
        {phoneme.pitchBend !== 0 && (
          <span className={`text-[8px] font-mono mt-0.5 ${phoneme.pitchBend > 0 ? 'text-cyan-400' : 'text-purple-400'}`}>
            {phoneme.pitchBend > 0 ? '▲' : '▼'}{Math.abs(phoneme.pitchBend)}¢
          </span>
        )}
        
        {/* Delete button - visible on hover/selected */}
        {isSelected && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(phoneme.id); }}
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500/80 hover:bg-red-500 text-white text-xs flex items-center justify-center shadow-lg border border-red-400/50 transition-colors"
            title="Delete phoneme"
          >
            ×
          </button>
        )}
      </div>
      
      {/* Resize handles */}
      {isSelected && (
        <>
          <div
            className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize bg-gradient-to-r from-white/20 to-transparent hover:from-white/40 transition-colors flex items-center justify-center"
            onPointerDown={(e) => { e.stopPropagation(); onResizeStart(phoneme.id, 'left'); }}
          >
            <div className="w-0.5 h-4 bg-white/50 rounded-full" />
          </div>
          <div
            className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize bg-gradient-to-l from-white/20 to-transparent hover:from-white/40 transition-colors flex items-center justify-center"
            onPointerDown={(e) => { e.stopPropagation(); onResizeStart(phoneme.id, 'right'); }}
          >
            <div className="w-0.5 h-4 bg-white/50 rounded-full" />
          </div>
        </>
      )}
      
      {/* Pitch bend visualization - mini bar on the right */}
      <div className="absolute right-1 top-1 bottom-1 w-1 bg-black/40 rounded-full overflow-hidden">
        <div 
          className="absolute left-0 right-0 bg-gradient-to-b from-cyan-400 to-purple-400 rounded-full transition-all"
          style={{ 
            top: `${Math.min(100, Math.max(0, pitchPercent))}%`, 
            bottom: `${Math.min(100, Math.max(0, 100 - pitchPercent))}%`,
            height: phoneme.pitchBend === 0 ? '2px' : undefined
          }}
        />
      </div>
    </div>
  );
});

interface WaveformDisplayProps {
  audioBuffer: AudioBuffer | null;
  width: number;
  height: number;
  phonemes: PhonemeData[];
}

const WaveformDisplay = memo(({ audioBuffer, width, height, phonemes }: WaveformDisplayProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Clear
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, width, height);
    
    // Draw grid
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    
    // Draw waveform
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const amp = height / 2;
    
    ctx.beginPath();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 1.5;
    
    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      
      for (let j = 0; j < step; j++) {
        const datum = data[i * step + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      
      ctx.moveTo(i, (1 + min) * amp);
      ctx.lineTo(i, (1 + max) * amp);
    }
    ctx.stroke();
    
    // Draw center line
    ctx.beginPath();
    ctx.strokeStyle = '#3f3f46';
    ctx.lineWidth = 1;
    ctx.moveTo(0, amp);
    ctx.lineTo(width, amp);
    ctx.stroke();
    
    // Draw phoneme overlay
    phonemes.forEach(ph => {
      const x = ph.start * width;
      const w = (ph.end - ph.start) * width;
      const color = getPhonemeColor(ph.symbol);
      
      // Semi-transparent overlay
      ctx.fillStyle = `${color}20`;
      ctx.fillRect(x, 0, w, height);
      
      // Border
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, 0, w, height);
    });
    
  }, [audioBuffer, width, height, phonemes]);
  
  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="w-full block rounded-md border border-zinc-800"
      style={{ background: 'linear-gradient(180deg, #09090b 0%, #18181b 100%)' }}
    />
  );
});

// --- MAIN COMPONENT ---

export interface PhonemePainterProps {
  isOpen: boolean;
  onClose: () => void;
  stepIndex: number;
  note: Note | null;
  audioBuffer: AudioBuffer | null;
  onSave: (stepIndex: number, phonemes: PhonemeData[] | undefined) => void;
  alignment?: AlignmentResult | null;
}

export const PhonemePainter: React.FC<PhonemePainterProps> = ({
  isOpen,
  onClose,
  stepIndex,
  note,
  audioBuffer,
  onSave,
  alignment
}) => {
  const [phonemes, setPhonemes] = useState<PhonemeData[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [isAutoAligning, setIsAutoAligning] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const timelineRef = useRef<HTMLDivElement>(null);
  const resizeState = useRef<{ id: string; side: 'left' | 'right'; startX: number; startValue: number } | null>(null);
  
  const TIMELINE_WIDTH = 600;
  const TIMELINE_HEIGHT = 120;
  
  // Initialize phonemes from note when opened
  useEffect(() => {
    if (isOpen && note) {
      if (note.phonemes && note.phonemes.length > 0) {
        setPhonemes(note.phonemes);
      } else if (alignment && alignment.phonemes.length > 0) {
        // Auto-populate from alignment if no existing phonemes
        const alignedPhonemes: PhonemeData[] = alignment.phonemes.map((ph, idx) => ({
          id: generateId(),
          symbol: ph.phoneme,
          start: idx / alignment.phonemes.length,
          end: (idx + 1) / alignment.phonemes.length,
          pitchBend: 0,
          volume: 1
        }));
        setPhonemes(alignedPhonemes);
      } else {
        // Default empty phoneme
        setPhonemes([
          { id: generateId(), symbol: 'AA', start: 0, end: 1, pitchBend: 0, volume: 1 }
        ]);
      }
      setSelectedId(null);
    }
  }, [isOpen, note, alignment]);
  
  // Handle drag
  const handleDrag = useCallback((id: string, deltaX: number) => {
    setPhonemes(prev => {
      const idx = prev.findIndex(p => p.id === id);
      if (idx === -1) return prev;
      
      const ph = prev[idx];
      const duration = ph.end - ph.start;
      const deltaNormalized = deltaX / TIMELINE_WIDTH;
      
      let newStart = Math.max(0, Math.min(1 - duration, ph.start + deltaNormalized));
      
      const newPhonemes = [...prev];
      newPhonemes[idx] = { ...ph, start: newStart, end: newStart + duration };
      return newPhonemes;
    });
  }, []);
  
  // Handle resize start
  const handleResizeStart = useCallback((id: string, side: 'left' | 'right') => {
    const ph = phonemes.find(p => p.id === id);
    if (!ph) return;
    
    resizeState.current = {
      id,
      side,
      startX: 0, // Will be set on first move
      startValue: side === 'left' ? ph.start : ph.end
    };
    
    const handlePointerMove = (e: PointerEvent) => {
      if (!resizeState.current) return;
      if (resizeState.current.startX === 0) {
        resizeState.current.startX = e.clientX;
        return;
      }
      
      const deltaX = e.clientX - resizeState.current.startX;
      const deltaNormalized = deltaX / TIMELINE_WIDTH;
      
      setPhonemes(prev => {
        const idx = prev.findIndex(p => p.id === resizeState.current!.id);
        if (idx === -1) return prev;
        
        const p = prev[idx];
        const newPhonemes = [...prev];
        
        if (resizeState.current!.side === 'left') {
          const newStart = Math.max(0, Math.min(p.end - 0.05, resizeState.current!.startValue + deltaNormalized));
          newPhonemes[idx] = { ...p, start: newStart };
        } else {
          const newEnd = Math.max(p.start + 0.05, Math.min(1, resizeState.current!.startValue + deltaNormalized));
          newPhonemes[idx] = { ...p, end: newEnd };
        }
        return newPhonemes;
      });
    };
    
    const handlePointerUp = () => {
      resizeState.current = null;
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
    
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  }, [phonemes]);
  
  // Add new phoneme
  const handleAddPhoneme = useCallback((symbol: string) => {
    setPhonemes(prev => {
      // Find gap or append at end
      let newStart = 0;
      if (prev.length > 0) {
        const lastEnd = Math.max(...prev.map(p => p.end));
        newStart = Math.min(lastEnd, 0.9);
      }
      const newEnd = Math.min(1, newStart + 0.2);
      
      return [...prev, {
        id: generateId(),
        symbol,
        start: newStart,
        end: newEnd,
        pitchBend: 0,
        volume: 1
      }];
    });
    setShowAddMenu(false);
  }, []);
  
  // Delete phoneme
  const handleDelete = useCallback((id: string) => {
    setPhonemes(prev => prev.filter(p => p.id !== id));
    if (selectedId === id) setSelectedId(null);
  }, [selectedId]);
  
  // Update pitch bend
  const handlePitchBendChange = useCallback((id: string, bend: number) => {
    setPhonemes(prev => prev.map(p => 
      p.id === id ? { ...p, pitchBend: bend } : p
    ));
  }, []);
  
  // Auto-align using PhonemeAligner
  const handleAutoAlign = useCallback(async () => {
    if (!audioBuffer || !alignment) return;
    
    setIsAutoAligning(true);
    try {
      // Use the alignment data to redistribute phonemes
      const totalDuration = audioBuffer.duration;
      const stepDuration = totalDuration; // For now, use full duration
      
      const alignedPhonemes: PhonemeData[] = alignment.phonemes.map((ph, idx) => {
        // Normalize to 0-1 range
        const start = ph.start / totalDuration;
        const end = ph.end / totalDuration;
        
        return {
          id: generateId(),
          symbol: ph.phoneme,
          start: Math.max(0, Math.min(1, start)),
          end: Math.max(0, Math.min(1, end)),
          pitchBend: 0,
          volume: 1
        };
      });
      
      setPhonemes(alignedPhonemes);
    } finally {
      setIsAutoAligning(false);
    }
  }, [audioBuffer, alignment]);
  
  // Save changes
  const handleSave = useCallback(() => {
    onSave(stepIndex, phonemes.length > 0 ? phonemes : undefined);
    onClose();
  }, [onSave, onClose, stepIndex, phonemes]);
  
  // Clear all phonemes
  const handleClear = useCallback(() => {
    setPhonemes([]);
    setSelectedId(null);
  }, []);
  
  // Get selected phoneme
  const selectedPhoneme = useMemo(() => 
    phonemes.find(p => p.id === selectedId) || null,
    [phonemes, selectedId]
  );
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Popover Container */}
      <div className="relative w-full max-w-4xl bg-zinc-900 rounded-xl border border-cyan-500/30 shadow-[0_0_50px_rgba(6,182,212,0.2)] overflow-hidden">
        
        {/* Decorative screw holes */}
        <div className="absolute top-3 left-3 w-3 h-3 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center">
          <div className="w-2 h-[1px] bg-zinc-500 rotate-45" />
        </div>
        <div className="absolute top-3 right-3 w-3 h-3 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center">
          <div className="w-2 h-[1px] bg-zinc-500 rotate-45" />
        </div>
        <div className="absolute bottom-3 left-3 w-3 h-3 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center">
          <div className="w-2 h-[1px] bg-zinc-500 rotate-45" />
        </div>
        <div className="absolute bottom-3 right-3 w-3 h-3 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center">
          <div className="w-2 h-[1px] bg-zinc-500 rotate-45" />
        </div>
        
        {/* Header */}
        <div className="relative bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 border-b border-cyan-500/20 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Icon */}
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 flex items-center justify-center">
                <svg className="w-4 h-4 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 19l7-7 3 3-7 7-3-3z" />
                  <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                  <path d="M2 2l7.586 7.586" />
                  <circle cx="11" cy="11" r="2" />
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-bold text-cyan-300 font-mono tracking-wider">PHONEME PAINTER</h2>
                <p className="text-xs text-zinc-500 font-mono">Step {stepIndex + 1} • {note?.note || 'C4'} • Melodic Sampler</p>
              </div>
            </div>
            
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-all"
            >
              ×
            </button>
          </div>
        </div>
        
        {/* Main Content */}
        <div className="p-6 space-y-4">
          
          {/* Waveform Display */}
          <div className="relative rounded-lg border border-zinc-800 bg-black/50 overflow-hidden">
            <div className="absolute top-2 left-2 text-[10px] text-zinc-600 font-mono uppercase tracking-wider">Waveform</div>
            <WaveformDisplay 
              audioBuffer={audioBuffer}
              width={TIMELINE_WIDTH}
              height={80}
              phonemes={phonemes}
            />
          </div>
          
          {/* Timeline with Draggable Phonemes */}
          <div className="relative rounded-lg border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">Phoneme Timeline</span>
              <div className="flex items-center gap-2">
                {alignment && (
                  <button
                    onClick={handleAutoAlign}
                    disabled={isAutoAligning}
                    className="px-3 py-1.5 text-[10px] font-mono bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white rounded border border-purple-500/50 shadow-[0_2px_8px_rgba(168,85,247,0.3)] disabled:opacity-50 transition-all"
                  >
                    {isAutoAligning ? 'Aligning...' : '✨ Auto-Align'}
                  </button>
                )}
                <button
                  onClick={() => setShowAddMenu(!showAddMenu)}
                  className="px-3 py-1.5 text-[10px] font-mono bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-500 hover:to-cyan-600 text-white rounded border border-cyan-500/50 shadow-[0_2px_8px_rgba(6,182,212,0.3)] transition-all"
                >
                  + Add Phoneme
                </button>
              </div>
            </div>
            
            {/* Add phoneme menu */}
            {showAddMenu && (
              <div className="absolute right-4 top-10 z-30 w-64 bg-zinc-900 border border-cyan-500/30 rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.5)] overflow-hidden">
                <div className="p-2 border-b border-zinc-800">
                  <span className="text-xs text-zinc-400 font-mono">Select Phoneme</span>
                </div>
                <div className="max-h-48 overflow-y-auto p-2 space-y-2">
                  {COMMON_PHONEMES.map(group => (
                    <div key={group.cat}>
                      <div className="text-[9px] text-zinc-600 font-mono uppercase mb-1">{group.cat}</div>
                      <div className="flex flex-wrap gap-1">
                        {group.phones.map(ph => (
                          <button
                            key={ph}
                            onClick={() => handleAddPhoneme(ph)}
                            className="px-2 py-1 text-[10px] font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700 hover:border-cyan-500/50 transition-all"
                            style={{ color: getPhonemeColor(ph) }}
                          >
                            {ph}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Timeline track */}
            <div 
              ref={timelineRef}
              className="relative h-28 bg-zinc-950/50 rounded border border-zinc-800/50"
              style={{ width: TIMELINE_WIDTH }}
              onClick={() => setSelectedId(null)}
            >
              {/* Grid lines */}
              {Array.from({ length: 9 }, (_, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-l border-zinc-800/50"
                  style={{ left: (i / 8) * TIMELINE_WIDTH }}
                >
                  <span className="absolute -top-4 text-[9px] text-zinc-600 font-mono">{i * 12.5}%</span>
                </div>
              ))}
              
              {/* Phoneme blocks */}
              {phonemes.map((ph, idx) => (
                <PhonemeBlock
                  key={ph.id}
                  phoneme={ph}
                  index={idx}
                  isSelected={selectedId === ph.id}
                  pixelsPerUnit={TIMELINE_WIDTH}
                  timelineWidth={TIMELINE_WIDTH}
                  onDrag={handleDrag}
                  onResizeStart={handleResizeStart}
                  onSelect={setSelectedId}
                  onDelete={handleDelete}
                  onPitchBendChange={handlePitchBendChange}
                />
              ))}
              
              {phonemes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-xs font-mono">
                  No phonemes. Click "+ Add Phoneme" to start.
                </div>
              )}
            </div>
          </div>
          
          {/* Selected Phoneme Controls */}
          {selectedPhoneme && (
            <div className="rounded-lg border border-cyan-500/20 bg-gradient-to-r from-cyan-950/20 to-purple-950/20 p-4">
              <div className="flex items-center gap-6 flex-wrap">
                {/* Phoneme Info */}
                <div className="flex items-center gap-3">
                  <div 
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold font-mono border"
                    style={{ 
                      backgroundColor: `${getPhonemeColor(selectedPhoneme.symbol)}20`,
                      borderColor: getPhonemeColor(selectedPhoneme.symbol),
                      color: getPhonemeColor(selectedPhoneme.symbol)
                    }}
                  >
                    {selectedPhoneme.symbol}
                  </div>
                  <div>
                    <div className="text-xs text-zinc-400 font-mono">
                      {PHONEME_NAMES[selectedPhoneme.symbol.toUpperCase()] || selectedPhoneme.symbol}
                    </div>
                    <div className="text-[10px] text-zinc-600 font-mono">
                      {(selectedPhoneme.end - selectedPhoneme.start * 100).toFixed(0)}ms
                    </div>
                  </div>
                </div>
                
                {/* Pitch Bend Control */}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-400 font-mono">Pitch Bend</span>
                  <div className="relative w-32 h-6 bg-zinc-800 rounded-full overflow-hidden border border-zinc-700">
                    <div 
                      className="absolute top-0 bottom-0 bg-gradient-to-r from-purple-500/50 via-transparent to-cyan-500/50"
                      style={{ 
                        left: '50%',
                        right: selectedPhoneme.pitchBend >= 0 ? `${50 - (selectedPhoneme.pitchBend / 200) * 50}%` : '50%',
                        left: selectedPhoneme.pitchBend <= 0 ? `${50 + (selectedPhoneme.pitchBend / 200) * 50}%` : '50%'
                      }}
                    />
                    <input
                      type="range"
                      min="-100"
                      max="100"
                      value={selectedPhoneme.pitchBend}
                      onChange={(e) => handlePitchBendChange(selectedPhoneme.id, parseInt(e.target.value))}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-ns-resize"
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className={`text-[10px] font-mono ${selectedPhoneme.pitchBend !== 0 ? 'text-white' : 'text-zinc-600'}`}>
                        {selectedPhoneme.pitchBend > 0 ? '+' : ''}{selectedPhoneme.pitchBend}¢
                      </span>
                    </div>
                  </div>
                  {/* Fine adjustment buttons */}
                  <div className="flex gap-1">
                    <button
                      onClick={() => handlePitchBendChange(selectedPhoneme.id, selectedPhoneme.pitchBend - 10)}
                      className="w-6 h-6 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs border border-zinc-700"
                    >
                      −
                    </button>
                    <button
                      onClick={() => handlePitchBendChange(selectedPhoneme.id, selectedPhoneme.pitchBend + 10)}
                      className="w-6 h-6 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs border border-zinc-700"
                    >
                      +
                    </button>
                  </div>
                </div>
                
                {/* Volume Control */}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-400 font-mono">Volume</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={(selectedPhoneme.volume || 1) * 100}
                    onChange={(e) => {
                      const vol = parseInt(e.target.value) / 100;
                      setPhonemes(prev => prev.map(p => 
                        p.id === selectedPhoneme.id ? { ...p, volume: vol } : p
                      ));
                    }}
                    className="w-24 h-1 bg-zinc-700 rounded-lg appearance-none"
                  />
                </div>
                
                {/* Timing info */}
                <div className="flex items-center gap-4 text-[10px] text-zinc-500 font-mono">
                  <span>Start: {(selectedPhoneme.start * 100).toFixed(1)}%</span>
                  <span>End: {(selectedPhoneme.end * 100).toFixed(1)}%</span>
                </div>
              </div>
            </div>
          )}
          
          {/* Legend */}
          <div className="flex items-center gap-4 text-[10px] text-zinc-500 font-mono">
            <span className="text-zinc-600">Legend:</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-purple-500" />Vowel</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-red-500" />Plosive</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-green-500" />Fricative</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-orange-500" />Affricate</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-blue-500" />Nasal</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-cyan-500" />Liquid</span>
          </div>
        </div>
        
        {/* Footer Actions */}
        <div className="border-t border-zinc-800 bg-zinc-900/50 px-6 py-4 flex items-center justify-between">
          <button
            onClick={handleClear}
            className="px-4 py-2 text-xs font-mono text-red-400 hover:text-red-300 hover:bg-red-950/20 rounded border border-transparent hover:border-red-500/30 transition-all"
          >
            Clear All
          </button>
          
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-mono text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded border border-zinc-700 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 text-xs font-mono font-bold text-black bg-gradient-to-r from-cyan-400 to-cyan-500 hover:from-cyan-300 hover:to-cyan-400 rounded border border-cyan-400 shadow-[0_2px_12px_rgba(6,182,212,0.4)] transition-all"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PhonemePainter;
