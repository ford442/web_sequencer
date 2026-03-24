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
