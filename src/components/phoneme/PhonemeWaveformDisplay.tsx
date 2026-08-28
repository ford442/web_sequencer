import React, { useRef, useEffect, memo } from 'react';
import type { PhonemeData } from '../../types';
import { getPhonemeColor } from '../../constants/phonemes';

export interface PhonemeWaveformDisplayProps {
  audioBuffer: AudioBuffer | null;
  width: number;
  height: number;
  phonemes: PhonemeData[];
}

export const PhonemeWaveformDisplay = memo(({ audioBuffer, width, height, phonemes }: PhonemeWaveformDisplayProps) => {
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


  if (!audioBuffer) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center bg-zinc-900/40 border border-dashed border-zinc-700 rounded-md mb-1 w-full relative group">
        <div className="w-12 h-12 rounded-full bg-cyan-900/30 flex items-center justify-center mb-4 text-cyan-500" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        </div>
        <h3 className="text-zinc-300 font-bold mb-2 text-sm">No sample loaded</h3>
        <p className="text-zinc-500 text-xs mb-6 max-w-[250px]">Load a vocal sample to view the waveform and phoneme slices.</p>
      </div>
    );
  }

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
