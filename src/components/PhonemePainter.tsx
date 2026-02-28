import React, { useState, useRef, useCallback, memo } from 'react';
import type { AlignmentResult, PhonemeSegment } from '../engines/rubberband/PhonemeAligner';

/**
 * PhonemePainter - Live phoneme editing interface
 * 
 * Phase 3 of the Vocal Workstation implementation.
 * Features:
 * - Visual waveform with phoneme overlay
 * - Draggable phoneme pills
 * - Per-phoneme pitch bend
 * - Time adjustment handles
 * - Phoneme elasticity (squish/stretch)
 */

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

// Phoneme categories for coloring
const getPhonemeColor = (phoneme: string, isVowel: boolean): string => {
  if (isVowel) return '#a855f7'; // Purple for vowels
  const ph = phoneme.toUpperCase();
  // Plosives
  if (['P', 'B', 'T', 'D', 'K', 'G'].includes(ph)) return '#ef4444'; // Red
  // Fricatives
  if (['F', 'V', 'TH', 'DH', 'S', 'Z', 'SH', 'ZH', 'HH'].includes(ph)) return '#22c55e'; // Green
  // Affricates
  if (['CH', 'JH'].includes(ph)) return '#f97316'; // Orange
  // Nasals
  if (['M', 'N', 'NG'].includes(ph)) return '#3b82f6'; // Blue
  // Liquids/Glides
  if (['L', 'R', 'W', 'Y'].includes(ph)) return '#06b6d4'; // Cyan
  return '#6b7280'; // Gray default
};

interface PhonemePillProps {
  phoneme: PhonemeSegment;
  index: number;
  totalDuration: number;
  pixelsPerSecond: number;
  isSelected: boolean;
  pitchBend: number;
  elasticity: number;
  onDrag: (index: number, deltaTime: number) => void;
  onPitchBendChange: (index: number, bend: number) => void;
  onElasticityChange: (index: number, elasticity: number) => void;
  onSelect: (index: number) => void;
}

const PhonemePill = memo(({
  phoneme,
  index,
  totalDuration: _totalDuration,
  pixelsPerSecond,
  isSelected,
  pitchBend,
  elasticity,
  onDrag,
  onPitchBendChange: _onPitchBendChange,
  onElasticityChange: _onElasticityChange,
  onSelect
}: PhonemePillProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartTime = useRef(0);

  const duration = phoneme.end - phoneme.start;
  const left = phoneme.start * pixelsPerSecond;
  const width = Math.max(30, duration * pixelsPerSecond);
  const color = getPhonemeColor(phoneme.phoneme, phoneme.isVowel);
  const displayName = PHONEME_NAMES[phoneme.phoneme.toUpperCase()] || phoneme.phoneme;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);

    dragStartX.current = e.clientX;
    dragStartTime.current = phoneme.start;
    setIsDragging(true);
    onSelect(index);

    const handlePointerMove = (ev: PointerEvent) => {
      const deltaX = ev.clientX - dragStartX.current;
      const deltaTime = deltaX / pixelsPerSecond;
      onDrag(index, deltaTime);
    };

    const handlePointerUp = (ev: PointerEvent) => {
      target.removeEventListener('pointermove', handlePointerMove as any);
      target.removeEventListener('pointerup', handlePointerUp as any);
      target.releasePointerCapture(ev.pointerId);
      setIsDragging(false);
    };

    target.addEventListener('pointermove', handlePointerMove as any);
    target.addEventListener('pointerup', handlePointerUp as any);
  }, [index, phoneme.start, pixelsPerSecond, onDrag, onSelect]);

  return (
    <div
      className={`absolute top-8 h-10 rounded-lg border-2 flex flex-col items-center justify-center cursor-grab active:cursor-grabbing select-none transition-shadow ${isSelected ? 'ring-2 ring-white shadow-lg' : ''
        } ${isDragging ? 'z-20 opacity-90' : 'z-10'}`}
      style={{
        left,
        width,
        backgroundColor: `${color}40`, // 25% opacity
        borderColor: color,
        boxShadow: isDragging ? `0 4px 20px ${color}60` : 'none'
      }}
      onPointerDown={handlePointerDown}
    >
      {/* Phoneme name */}
      <span className="text-xs font-bold text-white drop-shadow-md">
        {displayName}
      </span>

      {/* Pitch bend indicator */}
      {pitchBend !== 0 && (
        <span className="text-[9px] text-white/80">
          {pitchBend > 0 ? '+' : ''}{pitchBend}¢
        </span>
      )}

      {/* Elasticity indicator */}
      {elasticity !== 1 && (
        <span className="text-[9px] text-white/60">
          {elasticity > 1 ? '→' : '←'}{Math.round(elasticity * 100)}%
        </span>
      )}

      {/* Resize handles */}
      {isSelected && (
        <>
          <div
            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/30 hover:bg-white/50"
            title="Drag to adjust start time"
          />
          <div
            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/30 hover:bg-white/50"
            title="Drag to adjust end time"
          />
        </>
      )}
    </div>
  );
});

interface PhonemePainterProps {
  alignment: AlignmentResult | null;
  audioBuffer: AudioBuffer | null;
  onAlignmentChange?: (alignment: AlignmentResult) => void;
  onPhonemeSelect?: (phonemeIndex: number) => void;
  selectedPhonemeIndex?: number;
}

export const PhonemePainter: React.FC<PhonemePainterProps> = ({
  alignment,
  audioBuffer,
  onAlignmentChange,
  onPhonemeSelect,
  selectedPhonemeIndex = -1
}) => {
  const [zoom, setZoom] = useState(1);
  // const [scrollX, setScrollX] = useState(0); // Reserved for future scroll functionality
  const [phonemePitchBends, setPhonemePitchBends] = useState<Record<number, number>>({});
  const [phonemeElasticity, setPhonemeElasticity] = useState<Record<number, number>>({});
  const [localAlignment, setLocalAlignment] = useState<AlignmentResult | null>(alignment);

  const containerRef = useRef<HTMLDivElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);

  // Sync local alignment with prop
  React.useEffect(() => {
    setLocalAlignment(alignment);
  }, [alignment]);

  const duration = localAlignment?.duration || audioBuffer?.duration || 0;
  const pixelsPerSecond = 100 * zoom;
  const totalWidth = Math.max(800, duration * pixelsPerSecond);

  // Draw waveform
  React.useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !audioBuffer) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#1a1d24';
    ctx.fillRect(0, 0, width, height);

    // Draw waveform
    ctx.beginPath();
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 1;

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
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    ctx.moveTo(0, amp);
    ctx.lineTo(width, amp);
    ctx.stroke();
  }, [audioBuffer, zoom]);

  const handlePhonemeDrag = useCallback((index: number, deltaTime: number) => {
    if (!localAlignment) return;

    const newPhonemes = [...localAlignment.phonemes];
    const phoneme = newPhonemes[index];
    const duration = phoneme.end - phoneme.start;

    // Calculate new start time
    let newStart = phoneme.start + deltaTime;
    newStart = Math.max(0, Math.min(duration - 0.01, newStart));

    // Update phoneme
    newPhonemes[index] = {
      ...phoneme,
      start: newStart,
      end: newStart + duration
    };

    const newAlignment = { ...localAlignment, phonemes: newPhonemes };
    setLocalAlignment(newAlignment);
    onAlignmentChange?.(newAlignment);
  }, [localAlignment, onAlignmentChange]);

  const handlePitchBendChange = useCallback((index: number, bend: number) => {
    setPhonemePitchBends(prev => ({ ...prev, [index]: bend }));
  }, []);

  const handleElasticityChange = useCallback((index: number, elasticity: number) => {
    setPhonemeElasticity(prev => ({ ...prev, [index]: elasticity }));
  }, []);

  if (!localAlignment && !audioBuffer) {
    return (
      <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-8 text-center">
        <p className="text-gray-500 text-sm">No audio or alignment data available</p>
        <p className="text-gray-600 text-xs mt-2">Generate TTS to see phonemes</p>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-gray-900 to-gray-800 border border-purple-500/30 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-black/20">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-purple-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
          </svg>
          <span className="text-xs font-bold text-purple-300 uppercase">Phoneme Painter</span>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom(z => Math.max(0.5, z * 0.8))}
            className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white text-xs"
            title="Zoom out"
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="text-xs text-gray-500 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom(z => Math.min(5, z * 1.25))}
            className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white text-xs"
            title="Zoom in"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      {/* Timeline ruler */}
      <div className="h-6 bg-black/30 border-b border-white/5 relative overflow-hidden" style={{ width: totalWidth }}>
        {Array.from({ length: Math.ceil(duration) + 1 }, (_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-gray-600"
            style={{ left: i * pixelsPerSecond }}
          >
            <span className="text-[9px] text-gray-500 ml-1">{i}s</span>
          </div>
        ))}
      </div>

      {/* Waveform and phonemes */}
      <div
        ref={containerRef}
        className="relative overflow-auto"
        style={{ maxHeight: 300 }}
      >
        <div style={{ width: totalWidth, minHeight: 200 }}>
          {/* Waveform */}
          <canvas
            ref={waveformCanvasRef}
            width={Math.min(2000, totalWidth)}
            height={60}
            className="w-full h-[60px] block"
          />

          {/* Phoneme track */}
          <div className="relative h-20 mt-2">
            {localAlignment?.phonemes.map((phoneme, index) => (
              <PhonemePill
                key={index}
                phoneme={phoneme}
                index={index}
                totalDuration={duration}
                pixelsPerSecond={pixelsPerSecond}
                isSelected={selectedPhonemeIndex === index}
                pitchBend={phonemePitchBends[index] || 0}
                elasticity={phonemeElasticity[index] || 1}
                onDrag={handlePhonemeDrag}
                onPitchBendChange={handlePitchBendChange}
                onElasticityChange={handleElasticityChange}
                onSelect={onPhonemeSelect || (() => { })}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Selected phoneme controls */}
      {selectedPhonemeIndex >= 0 && localAlignment?.phonemes[selectedPhonemeIndex] && (
        <div className="border-t border-white/10 p-3 bg-black/20">
          <div className="flex items-center gap-4">
            <div className="text-xs">
              <span className="text-gray-500">Phoneme:</span>
              <span className="ml-1 font-bold text-purple-300">
                {localAlignment.phonemes[selectedPhonemeIndex].phoneme}
              </span>
            </div>

            {/* Pitch bend control */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Pitch Bend:</span>
              <input
                type="range"
                min="-100"
                max="100"
                value={phonemePitchBends[selectedPhonemeIndex] || 0}
                onChange={(e) => handlePitchBendChange(selectedPhonemeIndex, parseInt(e.target.value))}
                className="w-24 h-1 bg-gray-700 rounded-lg appearance-none"
              />
              <span className="text-xs text-gray-400 w-10">
                {phonemePitchBends[selectedPhonemeIndex] || 0}¢
              </span>
            </div>

            {/* Elasticity control */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Stretch:</span>
              <input
                type="range"
                min="50"
                max="150"
                value={(phonemeElasticity[selectedPhonemeIndex] || 1) * 100}
                onChange={(e) => handleElasticityChange(selectedPhonemeIndex, parseInt(e.target.value) / 100)}
                className="w-24 h-1 bg-gray-700 rounded-lg appearance-none"
              />
              <span className="text-xs text-gray-400 w-10">
                {Math.round((phonemeElasticity[selectedPhonemeIndex] || 1) * 100)}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-3 px-4 py-2 border-t border-white/10 bg-black/10 text-[10px]">
        <span className="text-gray-500">Legend:</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500"></span> Vowel</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500"></span> Plosive</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500"></span> Fricative</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500"></span> Affricate</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500"></span> Nasal</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-500"></span> Liquid</span>
      </div>
    </div>
  );
};

export default PhonemePainter;
