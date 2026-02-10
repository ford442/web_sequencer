import React, { useRef, useEffect } from 'react';
import type { AlignmentResult } from '../engines/rubberband/PhonemeAligner';

interface WaveformDisplayProps {
    buffer: AudioBuffer | null;
    alignment: AlignmentResult | null;
    sliceHighlightRef: React.MutableRefObject<((slice: number) => void) | null>;
}

export const WaveformDisplay: React.FC<WaveformDisplayProps> = ({ buffer, alignment, sliceHighlightRef }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const activeSliceRef = useRef<number>(-1);

    // Keep latest props in ref to access them inside the imperative callback without stale closures
    const propsRef = useRef({ buffer, alignment });
    useEffect(() => { propsRef.current = { buffer, alignment }; }, [buffer, alignment]);

    useEffect(() => {
        const draw = () => {
            const canvas = canvasRef.current;
            const container = containerRef.current;
            if (!canvas || !container) return;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const { buffer, alignment } = propsRef.current;
            const activeSlice = activeSliceRef.current;

            // Handle High DPI
            const dpr = window.devicePixelRatio || 1;
            const rect = container.getBoundingClientRect();

            // Only resize if dimensions changed to avoid clearing canvas unnecessarily
            if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
                canvas.width = rect.width * dpr;
                canvas.height = rect.height * dpr;
                canvas.style.width = `${rect.width}px`;
                canvas.style.height = `${rect.height}px`;
            }

            ctx.scale(dpr, dpr);
            const width = rect.width;
            const height = rect.height;

            // Clear
            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = '#111827'; // gray-900
            ctx.fillRect(0, 0, width, height);

            if (!buffer) {
                ctx.fillStyle = '#374151';
                ctx.font = '10px monospace';
                ctx.textAlign = 'center';
                ctx.fillText("NO SAMPLE", width / 2, height / 2);
                ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
                return;
            }

            // Draw Waveform
            const data = buffer.getChannelData(0);
            const step = Math.ceil(data.length / width);
            const amp = height / 2;

            ctx.beginPath();
            ctx.strokeStyle = '#4b5563'; // gray-600
            ctx.lineWidth = 1;

            for (let i = 0; i < width; i++) {
                let min = 1.0;
                let max = -1.0;
                // Simple downsampling
                for (let j = 0; j < step; j++) {
                    const datum = data[i * step + j];
                    if (datum < min) min = datum;
                    if (datum > max) max = datum;
                }
                ctx.moveTo(i, amp + min * amp);
                ctx.lineTo(i, amp + max * amp);
            }
            ctx.stroke();

            // Draw Alignment Markers
            if (alignment) {
                const duration = buffer.duration;

                // Highlight Active Slice
                if (activeSlice >= 0 && activeSlice < alignment.phonemes.length) {
                    const p = alignment.phonemes[activeSlice];
                    const startX = (p.start / duration) * width;
                    const endX = (p.end / duration) * width;

                    ctx.fillStyle = 'rgba(147, 51, 234, 0.3)'; // purple-600 with opacity
                    ctx.fillRect(startX, 0, endX - startX, height);

                    ctx.strokeStyle = '#d8b4fe'; // purple-300
                    ctx.lineWidth = 2;
                    ctx.strokeRect(startX, 0, endX - startX, height);
                }

                // Draw Lines & Text
                ctx.textAlign = 'left';
                ctx.font = '9px monospace';
                ctx.fillStyle = '#9ca3af'; // gray-400

                alignment.phonemes.forEach((p, idx) => {
                    const x = (p.start / duration) * width;

                    // Line
                    ctx.beginPath();
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
                    ctx.lineWidth = 1;
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, height);
                    ctx.stroke();

                    // Label (only if wide enough)
                    const endX = (p.end / duration) * width;
                    if (endX - x > 10) {
                        ctx.fillStyle = idx === activeSlice ? '#fff' : 'rgba(255,255,255,0.5)';
                        ctx.fillText(p.phoneme, x + 2, height - 2);
                    }
                });
            }

            // Reset transform for next frame
            ctx.setTransform(1, 0, 0, 1, 0, 0);
        };

        // Assign imperative handle
        sliceHighlightRef.current = (slice: number) => {
             // Only redraw if slice changed
             if (activeSliceRef.current !== slice) {
                 activeSliceRef.current = slice;
                 requestAnimationFrame(draw);
             }
        };

        // Initial draw (and whenever props change)
        requestAnimationFrame(draw);

        // Handle resize
        const handleResize = () => requestAnimationFrame(draw);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);

    }, [buffer, alignment, sliceHighlightRef]);

    return (
        <div ref={containerRef} className="w-full h-12 bg-gray-900 rounded border border-gray-700 overflow-hidden mb-1 relative">
            <canvas ref={canvasRef} className="w-full h-full block" />
        </div>
    );
};
