/**
 * The audio lanes' waveforms (#1629 P2): one canvas behind the clip blocks,
 * as wide as the lanes in view and as tall as all audio lanes, drawn with the
 * piano roll's quad renderers (WebGPU, Canvas2D fallback).
 *
 * The canvas is `position: sticky`, so it stays over the visible part of the
 * lanes while the timeline scrolls under it, and the scene is drawn for the
 * scroll offset. A canvas the width of the whole song would not fit a GPU
 * texture at any real song length.
 *
 * `WaveformPainter` (`waveformPainter.ts`) holds what is drawn outside React.
 */
import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { AudioClip, AudioTrack, MediaRef } from '@/types/song';
import type { StepClock } from '@/audio/audioTracks/clipTiming';
import { peakCache } from '@/audio/media/peakCache';
import { useQuadCanvas } from '../piano-roll/render/useQuadCanvas';
import { WaveformPainter } from './waveformPainter';

export interface AudioWaveformCanvasProps {
    /** The timeline's scroll container. */
    scrollRef: RefObject<HTMLDivElement | null>;
    /** Content y of the first audio lane. */
    top: number;
    /** Width of the sticky lane headers: lane x 0 sits here. */
    headerWidth: number;
    laneWidth: number;
    rowHeight: number;
    tracks: readonly AudioTrack[];
    clips: readonly AudioClip[];
    media: Readonly<Record<string, MediaRef>>;
    pxPerStep: number;
    clock: StepClock;
    selectedId: string | null;
}

/** Matches the clip blocks' `top-[3px] bottom-[3px]` inside a row with a 1 px bottom border. */
const INSET_TOP = 3;
const INSET_BOTTOM = 4;

export const AudioWaveformCanvas = memo(function AudioWaveformCanvas({
    scrollRef, top, headerWidth, laneWidth, rowHeight, tracks, clips, media, pxPerStep, clock, selectedId,
}: AudioWaveformCanvasProps) {
    const gpuRef = useRef<HTMLCanvasElement>(null);
    const cpuRef = useRef<HTMLCanvasElement>(null);
    const painter = useMemo(() => new WaveformPainter(), []);
    const backend = useQuadCanvas(painter, gpuRef, cpuRef, {
        degradationId: 'webgpu-arrangement-waveforms',
        fallbackMessage: 'Arrangement waveforms using Canvas2D fallback',
        transparent: true,
    });
    const [viewport, setViewport] = useState(0);
    const height = tracks.length * rowHeight;
    const width = Math.max(0, Math.min(laneWidth, viewport - headerWidth));

    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const measure = () => setViewport(el.clientWidth);
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [scrollRef]);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const onScroll = () => painter.setView(width, height, el.scrollLeft);
        onScroll();
        el.addEventListener('scroll', onScroll, { passive: true });
        return () => el.removeEventListener('scroll', onScroll);
    }, [height, painter, scrollRef, width]);

    useEffect(() => {
        painter.setInput({
            pxPerStep,
            rowHeight,
            insetTop: INSET_TOP,
            insetBottom: INSET_BOTTOM,
            tracks: tracks.map((t) => t.id),
            clips,
            media,
            clock,
            selectedId,
        });
    }, [clips, clock, media, painter, pxPerStep, rowHeight, selectedId, tracks]);

    useEffect(() => {
        peakCache.request(new Set(clips.filter((c) => media[c.mediaId]).map((c) => c.mediaId)));
    }, [clips, media]);

    const canvasStyle = { left: headerWidth, width, height };
    return (
        <div
            aria-hidden="true"
            data-testid="arrangement-waveforms"
            data-backend={backend}
            className="absolute pointer-events-none"
            style={{ top, left: headerWidth, width: laneWidth, height }}
        >
            <canvas ref={gpuRef} className="sticky" style={{ ...canvasStyle, display: backend === 'canvas2d' ? 'none' : 'block' }} />
            {backend === 'canvas2d' && <canvas ref={cpuRef} className="sticky block" style={canvasStyle} />}
        </div>
    );
});
