import React, { useRef, useEffect } from 'react';
import type { AlignmentResult } from '../engines/rubberband/PhonemeAligner';

interface WaveformDisplayProps {
    buffer: AudioBuffer | null;
    alignment: AlignmentResult | null;
    sliceHighlightRef: React.MutableRefObject<((slice: number) => void) | null>;
    onAlignmentChange?: (alignment: AlignmentResult) => void;
}

export const WaveformDisplay: React.FC<WaveformDisplayProps> = ({ buffer, alignment, sliceHighlightRef, onAlignmentChange }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const activeSliceRef = useRef<number>(-1);

    // State for drag interactions
    const isDraggingRef = useRef(false);
    const draggedMarkerIndexRef = useRef<number>(-1);

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
                ctx.fillStyle = '#9ca3af';
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
            ctx.strokeStyle = '#6b7280'; // gray-500
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

    // Handle mouse interactions for custom slicing
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const getMouseTime = (e: MouseEvent): number | null => {
            const { buffer } = propsRef.current;
            if (!buffer) return null;

            const rect = canvas.getBoundingClientRect();
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            return (x / rect.width) * buffer.duration;
        };

        const getMarkerIndexNearTime = (time: number, thresholdSecs: number): number => {
            const { alignment } = propsRef.current;
            if (!alignment) return -1;

            let closestIdx = -1;
            let minDiff = Infinity;

            // Skip the first marker (index 0) since it's the start of the file
            for (let i = 1; i < alignment.phonemes.length; i++) {
                const diff = Math.abs(alignment.phonemes[i].start - time);
                if (diff < minDiff && diff <= thresholdSecs) {
                    minDiff = diff;
                    closestIdx = i;
                }
            }
            return closestIdx;
        };

        const handleMouseDown = (e: MouseEvent) => {
            if (!onAlignmentChange || !propsRef.current.alignment || !propsRef.current.buffer) return;

            const time = getMouseTime(e);
            if (time === null) return;

            const rect = canvas.getBoundingClientRect();
            const threshold = (5 / rect.width) * propsRef.current.buffer.duration; // 5px threshold

            const markerIdx = getMarkerIndexNearTime(time, threshold);

            if (markerIdx !== -1) {
                // Clicked on a marker, start dragging
                isDraggingRef.current = true;
                draggedMarkerIndexRef.current = markerIdx;
                e.preventDefault();
            } else {
                // Clicked in empty space, add a new slice
                const { alignment, buffer } = propsRef.current;

                // Find where to insert
                let insertIdx = alignment.phonemes.findIndex(p => p.start > time);
                if (insertIdx === -1) insertIdx = alignment.phonemes.length;

                const newPhonemes = [...alignment.phonemes];

                // We split the phoneme at insertIdx - 1
                const prevPhoneme = newPhonemes[insertIdx - 1];

                const newPhoneme = {
                    phoneme: `S${alignment.phonemes.length + 1}`,
                    start: time,
                    end: prevPhoneme.end,
                    isVowel: true
                };

                prevPhoneme.end = time;

                newPhonemes.splice(insertIdx, 0, newPhoneme);

                onAlignmentChange({
                    ...alignment,
                    phonemes: newPhonemes
                });
            }
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (!onAlignmentChange || !propsRef.current.alignment || !propsRef.current.buffer) return;

            const time = getMouseTime(e);
            if (time === null) return;

            if (isDraggingRef.current && draggedMarkerIndexRef.current !== -1) {
                // Update marker position
                const { alignment } = propsRef.current;
                const idx = draggedMarkerIndexRef.current;
                const newPhonemes = [...alignment.phonemes];

                // Constrain time between previous and next markers
                const minTime = newPhonemes[idx - 1].start + 0.01;
                const maxTime = idx < newPhonemes.length - 1 ? newPhonemes[idx + 1].start - 0.01 : propsRef.current.buffer.duration - 0.01;
                const clampedTime = Math.max(minTime, Math.min(time, maxTime));

                newPhonemes[idx].start = clampedTime;
                newPhonemes[idx - 1].end = clampedTime;

                onAlignmentChange({
                    ...alignment,
                    phonemes: newPhonemes
                });
            } else {
                // Update cursor
                const rect = canvas.getBoundingClientRect();
                const threshold = (5 / rect.width) * propsRef.current.buffer.duration;
                const markerIdx = getMarkerIndexNearTime(time, threshold);

                if (markerIdx !== -1) {
                    canvas.style.cursor = 'col-resize';
                } else {
                    canvas.style.cursor = 'crosshair';
                }
            }
        };

        const handleMouseUp = () => {
            isDraggingRef.current = false;
            draggedMarkerIndexRef.current = -1;
        };

        const handleDoubleClick = (e: MouseEvent) => {
            if (!onAlignmentChange || !propsRef.current.alignment || !propsRef.current.buffer) return;

            const time = getMouseTime(e);
            if (time === null) return;

            const rect = canvas.getBoundingClientRect();
            const threshold = (5 / rect.width) * propsRef.current.buffer.duration;
            const markerIdx = getMarkerIndexNearTime(time, threshold);

            if (markerIdx !== -1) {
                // Remove marker
                const { alignment } = propsRef.current;
                const newPhonemes = [...alignment.phonemes];

                // Merge with previous
                newPhonemes[markerIdx - 1].end = newPhonemes[markerIdx].end;
                newPhonemes.splice(markerIdx, 1);

                onAlignmentChange({
                    ...alignment,
                    phonemes: newPhonemes
                });
            }
        };

        canvas.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('dblclick', handleDoubleClick);

        return () => {
            canvas.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            canvas.removeEventListener('dblclick', handleDoubleClick);
        };
    }, [onAlignmentChange]);

    const label = !buffer
        ? "Waveform visualization: No sample loaded"
        : `Waveform visualization: Sample loaded${alignment ? " with phoneme alignment" : ""}`;

    return (
        <div
            ref={containerRef}
            className="w-full h-12 bg-gray-900 rounded border border-gray-700 overflow-hidden mb-1 relative"
            role="img"
            aria-label={label}
            title={label}
        >
            <canvas ref={canvasRef} className="w-full h-full block" />
        </div>
    );
};
