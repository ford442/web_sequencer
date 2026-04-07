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
 * - Keyboard navigation support (WCAG 2.1 AA)
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { PhonemeData, Note } from '../types';
import { PhonemeAligner, type AlignmentResult, type PhonemeSegment } from '../engines/rubberband/PhonemeAligner';
import { PHONEME_NAMES, COMMON_PHONEMES, getPhonemeColor, generateId } from '../constants/phonemes';
import { PhonemeBlock } from './phoneme/PhonemeBlock';
import { PhonemeWaveformDisplay } from './phoneme/PhonemeWaveformDisplay';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const phonemeButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const addMenuRef = useRef<HTMLDivElement>(null);
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

  // Focus trap and escape key handling
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close
      if (e.key === 'Escape') {
        if (showAddMenu) {
          setShowAddMenu(false);
        } else {
          onClose();
        }
        return;
      }

      // Focus management
      if (e.key === 'Tab') {
        // Let default tab behavior work, but ensure focus stays in modal
        const focusableElements = containerRef.current?.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusableElements || focusableElements.length === 0) return;

        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    
    // Focus first element when opened
    const timer = setTimeout(() => {
      containerRef.current?.querySelector('button')?.focus();
    }, 100);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
    };
  }, [isOpen, onClose, showAddMenu]);

  // Keyboard navigation for phoneme blocks
  const handlePhonemeKeyDown = useCallback((e: React.KeyboardEvent, phonemeId: string) => {
    const phoneme = phonemes.find(p => p.id === phonemeId);
    if (!phoneme) return;

    const phonemeIndex = phonemes.findIndex(p => p.id === phonemeId);
    const STEP_SIZE = 0.01; // 1% increments
    const BIG_STEP = 0.05;  // 5% increments

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        if (e.shiftKey) {
          // Extend right
          handleResize(phonemeId, 'right', BIG_STEP);
        } else {
          // Move right
          handleDrag(phonemeId, TIMELINE_WIDTH * STEP_SIZE);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (e.shiftKey) {
          // Extend left
          handleResize(phonemeId, 'right', -BIG_STEP);
        } else {
          // Move left
          handleDrag(phonemeId, -TIMELINE_WIDTH * STEP_SIZE);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        // Increase pitch bend
        handlePitchBendChange(phonemeId, Math.min(100, phoneme.pitchBend + (e.shiftKey ? 20 : 5)));
        break;
      case 'ArrowDown':
        e.preventDefault();
        // Decrease pitch bend
        handlePitchBendChange(phonemeId, Math.max(-100, phoneme.pitchBend - (e.shiftKey ? 20 : 5)));
        break;
      case 'Home':
        e.preventDefault();
        // Move to start
        setPhonemes(prev => prev.map(p => 
          p.id === phonemeId ? { ...p, start: 0, end: p.end - p.start } : p
        ));
        break;
      case 'End':
        e.preventDefault();
        // Move to end
        setPhonemes(prev => prev.map(p => {
          if (p.id !== phonemeId) return p;
          const duration = p.end - p.start;
          return { ...p, start: 1 - duration, end: 1 };
        }));
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        handleDelete(phonemeId);
        // Focus next phoneme or add button
        const nextPhoneme = phonemes[phonemeIndex + 1];
        if (nextPhoneme) {
          setSelectedId(nextPhoneme.id);
        }
        break;
      case 'Tab':
        // Navigate between phonemes
        if (e.shiftKey) {
          const prevPhoneme = phonemes[phonemeIndex - 1];
          if (prevPhoneme) {
            e.preventDefault();
            setSelectedId(prevPhoneme.id);
          }
        } else {
          const nextPhoneme = phonemes[phonemeIndex + 1];
          if (nextPhoneme) {
            e.preventDefault();
            setSelectedId(nextPhoneme.id);
          }
        }
        break;
    }
  }, [phonemes]);

  // Helper for keyboard resize
  const handleResize = useCallback((id: string, side: 'left' | 'right', deltaNormalized: number) => {
    setPhonemes(prev => {
      const idx = prev.findIndex(p => p.id === id);
      if (idx === -1) return prev;
      
      const p = prev[idx];
      const newPhonemes = [...prev];
      
      if (side === 'left') {
        const newStart = Math.max(0, Math.min(p.end - 0.05, p.start + deltaNormalized));
        newPhonemes[idx] = { ...p, start: newStart };
      } else {
        const newEnd = Math.max(p.start + 0.05, Math.min(1, p.end + deltaNormalized));
        newPhonemes[idx] = { ...p, end: newEnd };
      }
      return newPhonemes;
    });
  }, []);
  
  // Handle drag
  const handleDrag = useCallback((id: string, deltaX: number) => {
    setPhonemes(prev => {
      const idx = prev.findIndex(p => p.id === id);
      if (idx === -1) return prev;
      
      const ph = prev[idx];
      const duration = ph.end - ph.start;
      const deltaNormalized = deltaX / TIMELINE_WIDTH;
      
      const newStart = Math.max(0, Math.min(1 - duration, ph.start + deltaNormalized));
      
      const newPhonemes = [...prev];
      newPhonemes[idx] = { ...ph, start: newStart, end: newStart + duration };
      return newPhonemes;
    });
  }, []);
  
  // Handle resize start
  const handleResizeStart = useCallback((id: string, side: 'left' | 'right') => {
    const ph = phonemes.find(p => p.id === id);
    if (!ph) return;
    
    const startX = (e: PointerEvent) => e.clientX;
    let initialX = 0;
    const startValue = side === 'left' ? ph.start : ph.end;
    
    resizeState.current = {
      id,
      side,
      startX: 0,
      startValue
    };
    
    const handlePointerMove = (e: PointerEvent) => {
      if (!resizeState.current) return;
      if (resizeState.current.startX === 0) {
        resizeState.current.startX = e.clientX;
        initialX = e.clientX;
        return;
      }
      
      const deltaX = e.clientX - initialX;
      const deltaNormalized = deltaX / TIMELINE_WIDTH;
      
      setPhonemes(prev => {
        const idx = prev.findIndex(p => p.id === resizeState.current!.id);
        if (idx === -1) return prev;
        
        const p = prev[idx];
        const newPhonemes = [...prev];
        
        if (resizeState.current!.side === 'left') {
          const newStart = Math.max(0, Math.min(p.end - 0.05, startValue + deltaNormalized));
          newPhonemes[idx] = { ...p, start: newStart };
        } else {
          const newEnd = Math.max(p.start + 0.05, Math.min(1, startValue + deltaNormalized));
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

  // Announce changes to screen readers
  const announceToScreenReader = useCallback((message: string) => {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.textContent = message;
    document.body.appendChild(announcement);
    setTimeout(() => document.body.removeChild(announcement), 1000);
  }, []);
  
  if (!isOpen) return null;
  
  return (
    <div 
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="phoneme-painter-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Skip to content link for keyboard users */}
      <a 
        href="#phoneme-timeline" 
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          timelineRef.current?.focus();
        }}
      >
        Skip to timeline
      </a>
      
      {/* Popover Container with hardware panel aesthetic */}
      <div 
        className="relative w-full max-w-4xl rounded-xl border overflow-hidden animate-in fade-in zoom-in duration-200"
        style={{
          background: 'linear-gradient(145deg, rgba(24,24,27,0.98), rgba(9,9,11,0.99))',
          borderColor: 'rgba(6,182,212,0.25)',
          boxShadow: '0 0 60px rgba(6,182,212,0.15), 0 20px 60px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05)'
        }}
      >
        {/* Holographic border glow */}
        <div className="absolute inset-0 rounded-xl pointer-events-none" style={{
          background: 'linear-gradient(135deg, rgba(6,182,212,0.1) 0%, transparent 50%, rgba(168,85,247,0.1) 100%)'
        }} />
        
        {/* Decorative screw holes - hardware panel style */}
        <div className="absolute top-4 left-4 w-3.5 h-3.5 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]">
          <div className="w-2 h-[1.5px] bg-zinc-500 rotate-45 shadow-sm" />
        </div>
        <div className="absolute top-4 right-4 w-3.5 h-3.5 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]">
          <div className="w-2 h-[1.5px] bg-zinc-500 rotate-45 shadow-sm" />
        </div>
        <div className="absolute bottom-4 left-4 w-3.5 h-3.5 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]">
          <div className="w-2 h-[1.5px] bg-zinc-500 rotate-45 shadow-sm" />
        </div>
        <div className="absolute bottom-4 right-4 w-3.5 h-3.5 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]">
          <div className="w-2 h-[1.5px] bg-zinc-500 rotate-45 shadow-sm" />
        </div>
        
        {/* Header with holographic styling */}
        <div className="relative border-b border-cyan-500/20 px-6 py-4">
          {/* Holographic header background */}
          <div className="absolute inset-0 bg-gradient-to-r from-zinc-900 via-zinc-800/80 to-zinc-900" />
          <div className="absolute inset-0 opacity-30" style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(6,182,212,0.1) 30%, rgba(168,85,247,0.1) 70%, transparent 100%)'
          }} />
          
          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-3">
              {/* Icon with glow */}
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-cyan-500/40 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                <svg className="w-4 h-4 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 19l7-7 3 3-7 7-3-3z" />
                  <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                  <path d="M2 2l7.586 7.586" />
                  <circle cx="11" cy="11" r="2" />
                </svg>
              </div>
              <div>
                <h2 
                  id="phoneme-painter-title"
                  className="text-sm font-bold text-cyan-300 font-mono tracking-wider flex items-center gap-2"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                  PHONEME PAINTER
                </h2>
                <p className="text-xs text-zinc-500 font-mono mt-0.5">Step {stepIndex + 1} • {note?.note || 'C4'} • Melodic Sampler</p>
              </div>
            </div>
            
            {/* Close button - hardware style */}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-gradient-to-b from-zinc-800 to-zinc-900 hover:from-zinc-700 hover:to-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
              aria-label="Close Phoneme Painter"
            >
              ×
            </button>
          </div>
        </div>
        
        {/* Main Content */}
        <div className="p-6 space-y-4">
          
          {/* Waveform Display - with improved styling */}
          <div className="relative rounded-lg border border-zinc-800 bg-black/50 overflow-hidden shadow-[inset_0_2px_8px_rgba(0,0,0,0.5)]">
            <div className="absolute top-2 left-3 text-[10px] text-zinc-500 font-mono uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-cyan-500/50" />
              Waveform
            </div>
            <PhonemeWaveformDisplay
              audioBuffer={audioBuffer}
              width={TIMELINE_WIDTH}
              height={80}
              phonemes={phonemes}
            />
          </div>
          
          {/* Timeline with Draggable Phonemes */}
          <div 
            id="phoneme-timeline"
            ref={timelineRef}
            tabIndex={0}
            aria-label="Phoneme timeline. Use arrow keys to navigate and adjust phonemes."
            className="relative rounded-lg border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none focus:ring-2 focus:ring-cyan-500/50"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-purple-500/50" />
                Phoneme Timeline
              </span>
              <div className="flex items-center gap-2">
                {alignment && (
                  <button
                    onClick={handleAutoAlign}
                    disabled={isAutoAligning}
                    className="px-3 py-1.5 text-[10px] font-mono bg-gradient-to-b from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white rounded-md border border-purple-500/50 shadow-[0_2px_8px_rgba(168,85,247,0.3),inset_0_1px_0_rgba(255,255,255,0.1)] disabled:opacity-50 transition-all"
                    aria-busy={isAutoAligning}
                    aria-label={isAutoAligning ? "Auto-aligning phonemes..." : "Auto-align phonemes"}
                  >
                    <span className="flex items-center gap-1">
                      {isAutoAligning ? (
                        <svg className="animate-spin h-3 w-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : (
                        '✨'
                      )}
                      {isAutoAligning ? 'Aligning...' : 'Auto-Align'}
                    </span>
                  </button>
                )}
                <button
                  onClick={() => setShowAddMenu(!showAddMenu)}
                  className="px-3 py-1.5 text-[10px] font-mono bg-gradient-to-b from-cyan-600 to-cyan-700 hover:from-cyan-500 hover:to-cyan-600 text-white rounded-md border border-cyan-500/50 shadow-[0_2px_8px_rgba(6,182,212,0.3),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all"
                  aria-expanded={showAddMenu}
                  aria-controls="add-phoneme-menu"
                  aria-label="Toggle add phoneme menu"
                  aria-haspopup="menu"
                  title="Toggle add phoneme menu (A)"
                >
                  <span className="flex items-center gap-1">+ Add Phoneme</span>
                </button>
              </div>
            </div>
            
            {/* Keyboard shortcuts hint */}
            <div className="text-[9px] text-zinc-600 font-mono mb-2 flex items-center gap-2">
              <span>Shortcuts:</span>
              <span className="px-1 py-0.5 bg-zinc-800 rounded">←→ Move</span>
              <span className="px-1 py-0.5 bg-zinc-800 rounded">Shift+←→ Resize</span>
              <span className="px-1 py-0.5 bg-zinc-800 rounded">↑↓ Pitch</span>
              <span className="px-1 py-0.5 bg-zinc-800 rounded">Del Delete</span>
              <span className="px-1 py-0.5 bg-zinc-800 rounded">Tab Navigate</span>
            </div>
            
            {/* Add phoneme menu - improved styling */}
            {showAddMenu && (
              <div
                id="add-phoneme-menu"
                ref={addMenuRef}
                role="menu"
                aria-label="Add phoneme menu"
                className="absolute right-4 top-16 z-30 w-64 rounded-lg overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
                style={{
                  background: 'linear-gradient(145deg, rgba(24,24,27,0.98), rgba(9,9,11,0.99))',
                  border: '1px solid rgba(6,182,212,0.3)',
                  boxShadow: '0 12px 40px rgba(0,0,0,0.6), 0 0 20px rgba(6,182,212,0.1)'
                }}
              >
                <div className="p-2 border-b border-zinc-800 bg-gradient-to-r from-cyan-950/30 to-transparent">
                  <span className="text-xs text-cyan-400 font-mono flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-cyan-400" />
                    Select Phoneme
                  </span>
                </div>
                <div className="max-h-48 overflow-y-auto p-2 space-y-2">
                  {COMMON_PHONEMES.map(group => (
                    <div key={group.cat} role="group" aria-label={group.cat}>
                      <div className="text-[9px] text-zinc-500 font-mono uppercase mb-1.5 px-1">{group.cat}</div>
                      <div className="flex flex-wrap gap-1">
                        {group.phones.map((ph, idx) => (
                          <button
                            key={ph}
                            ref={el => { phonemeButtonRefs.current[idx] = el; }}
                            onClick={() => handleAddPhoneme(ph)}
                            className="px-2 py-1 text-[10px] font-mono bg-gradient-to-b from-zinc-800 to-zinc-900 hover:from-zinc-700 hover:to-zinc-800 text-zinc-300 rounded border border-zinc-700 hover:border-cyan-500/50 transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                            style={{ color: getPhonemeColor(ph) }}
                            aria-label={`Add ${ph} phoneme`}
                            title={`Add ${ph} phoneme`}
                            role="menuitem"
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
              className="relative h-28 bg-zinc-950/50 rounded-lg border border-zinc-800/50 shadow-[inset_0_2px_8px_rgba(0,0,0,0.5)]"
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
              {/* Horizontal grid lines */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-1/4 left-0 right-0 h-px bg-zinc-800/30" />
                <div className="absolute top-1/2 left-0 right-0 h-px bg-zinc-800/30" />
                <div className="absolute top-3/4 left-0 right-0 h-px bg-zinc-800/30" />
              </div>
              
              {/* Phoneme blocks */}
              {phonemes.map((ph, idx) => (
                <div
                  key={ph.id}
                  role="button"
                  tabIndex={selectedId === ph.id ? 0 : -1}
                  aria-label={`${ph.symbol} phoneme, ${((ph.end - ph.start) * 100).toFixed(0)}% duration, pitch ${ph.pitchBend} cents`}
                  aria-pressed={selectedId === ph.id}
                  onKeyDown={(e) => handlePhonemeKeyDown(e, ph.id)}
                  onClick={() => setSelectedId(ph.id)}
                >
                  <PhonemeBlock
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
                </div>
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
            <div 
              role="region"
              aria-label="Selected phoneme controls"
              className="rounded-lg border p-4 relative overflow-hidden"
              style={{
                borderColor: `${getPhonemeColor(selectedPhoneme.symbol)}40`,
                background: `linear-gradient(135deg, ${getPhonemeColor(selectedPhoneme.symbol)}15 0%, transparent 100%)`
              }}
            >
              {/* Glow effect */}
              <div 
                className="absolute -right-20 -top-20 w-40 h-40 opacity-20 blur-3xl pointer-events-none"
                style={{ backgroundColor: getPhonemeColor(selectedPhoneme.symbol) }}
              />
              <div className="flex items-center gap-6 flex-wrap relative z-10">
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
                      {((selectedPhoneme.end - selectedPhoneme.start) * 100).toFixed(0)}ms
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
                      aria-label="Pitch Bend"
                      aria-valuetext={`${selectedPhoneme.pitchBend > 0 ? '+' : ''}${selectedPhoneme.pitchBend} cents`}
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
                      className="w-6 h-6 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs border border-zinc-700 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      aria-label="Decrease pitch bend"
                    >
                      −
                    </button>
                    <button
                      onClick={() => handlePitchBendChange(selectedPhoneme.id, selectedPhoneme.pitchBend + 10)}
                      className="w-6 h-6 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs border border-zinc-700 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      aria-label="Increase pitch bend"
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
                    className="w-24 h-1 bg-zinc-700 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    aria-label="Volume"
                    aria-valuetext={`${Math.round((selectedPhoneme.volume || 1) * 100)}%`}
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
          
          {/* Legend - improved styling */}
          <div className="flex items-center gap-4 text-[10px] text-zinc-500 font-mono flex-wrap">
            <span className="text-zinc-500 uppercase tracking-wider">Legend:</span>
            <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-950/50 border border-zinc-800"><span className="w-2 h-2 rounded-sm bg-purple-500 shadow-[0_0_6px_rgba(168,85,247,0.6)]" />Vowel</span>
            <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-950/50 border border-zinc-800"><span className="w-2 h-2 rounded-sm bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />Plosive</span>
            <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-950/50 border border-zinc-800"><span className="w-2 h-2 rounded-sm bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" />Fricative</span>
            <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-950/50 border border-zinc-800"><span className="w-2 h-2 rounded-sm bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.6)]" />Affricate</span>
            <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-950/50 border border-zinc-800"><span className="w-2 h-2 rounded-sm bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.6)]" />Nasal</span>
            <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-950/50 border border-zinc-800"><span className="w-2 h-2 rounded-sm bg-cyan-500 shadow-[0_0_6px_rgba(6,182,212,0.6)]" />Liquid</span>
          </div>
        </div>
        
        {/* Footer Actions - hardware style */}
        <div className="border-t border-zinc-800 bg-zinc-950/50 px-6 py-4 flex items-center justify-between relative">
          <button
            onClick={handleClear}
            className="px-4 py-2 text-xs font-mono text-red-400 hover:text-red-300 rounded-md border border-red-900/30 bg-gradient-to-b from-red-950/30 to-red-950/10 hover:from-red-950/50 hover:to-red-950/20 transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] focus:outline-none focus:ring-2 focus:ring-red-500"
            aria-label="Clear all phonemes"
            title="Clear all phonemes"
          >
            Clear All
          </button>
          
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-mono text-zinc-400 hover:text-white rounded-md bg-gradient-to-b from-zinc-800 to-zinc-900 hover:from-zinc-700 hover:to-zinc-800 border border-zinc-700 transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] focus:outline-none focus:ring-2 focus:ring-zinc-500"
              aria-label="Cancel changes"
              title="Cancel changes"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 text-xs font-mono font-bold text-black rounded-md bg-gradient-to-b from-cyan-400 to-cyan-500 hover:from-cyan-300 hover:to-cyan-400 border border-cyan-400 transition-all shadow-[0_4px_16px_rgba(6,182,212,0.4),inset_0_1px_0_rgba(255,255,255,0.3)] relative overflow-hidden group focus:outline-none focus:ring-2 focus:ring-cyan-500"
              aria-label="Save changes"
              title="Save changes"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-500" />
              <span className="relative">Save Changes</span>
            </button>
          </div>
        </div>
        
        {/* Screen reader announcements */}
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {phonemes.length} phonemes in timeline
          {selectedPhoneme && `, ${selectedPhoneme.symbol} selected`}
        </div>
      </div>
    </div>
  );
};

export default PhonemePainter;
