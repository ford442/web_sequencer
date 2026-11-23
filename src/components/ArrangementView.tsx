/**
 * Arrangement view (#1342): the linear timeline. Tracks run horizontally,
 * clips are blocks that reference a pattern slot. Drag a clip to move it,
 * drag its right edge to trim/extend, its left edge to trim the head (the
 * notes stay in place). Double-click a lane — or its + button — to add a clip
 * of the track's current slot.
 *
 * The focused clip's own automation lanes (#1494) are edited below the
 * inspector, in clip-local steps.
 *
 * Audio tracks (#1629) sit under the pattern lanes: drop an audio file on
 * any lane (or use IMPORT) to put it on the timeline as an audio clip. Audio
 * clips move and trim like pattern clips (`arrangement/AudioTrackLanes.tsx`),
 * and draw their waveform on one canvas behind the lanes
 * (`arrangement/AudioWaveformCanvas.tsx`). Their top handles drag the fades
 * and the gain; Alt + drag slips the audio under the clip. Alt + click, S or
 * Ctrl/Cmd+E splits any clip (`arrangement/clipDrag.ts`).
 *
 * Edits preview locally and commit once on release, so a drag is one undo
 * step. The playhead follows the worklet step via `arrangementPlayhead`,
 * never React state.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TrackKey } from '../constants/appDefaults';
import { MAX_TRACK_PATTERN_SLOTS } from '../constants';
import type { Arrangement, ArrangementClip, AudioClip, AudioTrackKey, PatternClip } from '../types';
import {
    addClip, arrangementEnd, clipEnd, isAudioClip, isPatternClip, lastClipEnd, removeClip, setArrangementLength, splitClip, updateClip,
    type ClipPatch,
} from '../arrangement/model';
import { addAudioTrack, updateAudioTrack } from '../arrangement/audioTracks';
import { audioTrackStore } from '../stores/audioTrackStore';
import { useValueStore } from '../stores/valueStore';
import { useTransportMixStore } from '../stores/transportMixStore';
import { swingPercentToClock } from '../utils/musicTheory';
import { AudioClipInspector, AudioTrackLanes, type AudioClipHandlers } from './arrangement/AudioTrackLanes';
import { AudioWaveformCanvas } from './arrangement/AudioWaveformCanvas';
import {
    CLICK_SLOP_PX, clipDragPatch, clipDragPreview, keyboardSplitStep, splitStepNear, type ClipDragMode,
} from './arrangement/clipDrag';
import { audioFilesOf, useAudioImport } from './arrangement/useAudioImport';
import { arrangementPlayhead } from '../arrangement/playhead';
import { trackLoopLength, transportGrid, type SongMeter } from '../utils/songMeter';
import { SONG_MODE_TRACKS } from '../utils/songModeEditing';
import { ClipLanePanel } from './ClipLanePanel';

export type ArrangementZoom = 'bar' | '4bars';

export interface ArrangementViewProps {
    arrangement: Arrangement;
    meter: Pick<SongMeter, 'stepCount' | 'timeSignature' | 'trackLengths'>;
    /** Slot each track is currently editing — what a new clip references. */
    activeTrackSlots: Record<TrackKey, number>;
    isSongModeActive: boolean;
    onSetIsSongModeActive: (active: boolean) => void;
    onEdit: (updater: (prev: Arrangement) => Arrangement) => void;
    onUndo: () => void;
    onRedo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onClose: () => void;
}

const ROW_HEIGHT = 34;
const RULER_HEIGHT = 22;
const HEADER_WIDTH = 92;
const EDGE_PX = 6;
/** Pixel width of one bar at each zoom. */
const BAR_WIDTH: Record<ArrangementZoom, number> = { bar: 192, '4bars': 64 };
/** Extra empty bars drawn past the loop point, so there is room to drop clips. */
const TAIL_BARS = 4;

interface DragState {
    id: string;
    mode: ClipDragMode;
    pointerId: number;
    originX: number;
    originY: number;
    /** Song step under the pointer when it went down (where an Alt + click splits). */
    downStep: number;
    /** The pointer travelled past `CLICK_SLOP_PX`: an Alt press is a slip, not a split. */
    moved: boolean;
    clip: ArrangementClip;
    /** Preview of the clip under the pointer; committed on release. */
    preview: ArrangementClip;
}

/** `data-handle` of an audio clip's top handles → the drag they start. */
const HANDLE_MODES = new Map<string, ClipDragMode>([['fadeIn', 'fadeIn'], ['fadeOut', 'fadeOut'], ['gain', 'gain']]);

function bars(steps: number, stepsPerBar: number): string {
    const b = steps / stepsPerBar;
    return Number.isInteger(b) ? `${b} bar${b === 1 ? '' : 's'}` : `${steps} steps`;
}

function position(step: number, stepsPerBar: number, stepsPerBeat: number): string {
    const bar = Math.floor(step / stepsPerBar) + 1;
    const beat = Math.floor((step % stepsPerBar) / stepsPerBeat) + 1;
    const sixteenth = (step % stepsPerBeat) + 1;
    return `${bar}.${beat}.${sixteenth}`;
}

export const ArrangementView = memo(function ArrangementView({
    arrangement,
    meter,
    activeTrackSlots,
    isSongModeActive,
    onSetIsSongModeActive,
    onEdit,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    onClose,
}: ArrangementViewProps) {
    const [zoom, setZoom] = useState<ArrangementZoom>('bar');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [drag, setDrag] = useState<DragState | null>(null);
    const playheadRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [dropActive, setDropActive] = useState(false);
    const audio = useValueStore(audioTrackStore);
    const { status: importStatus, importFiles } = useAudioImport(onEdit, setSelectedId);
    const tempo = useTransportMixStore((m) => m.tempo);
    const swing = useTransportMixStore((m) => m.swing);
    const clock = useMemo(() => ({ tempo, swing: swingPercentToClock(swing) }), [swing, tempo]);

    const { stepsPerBar, stepsPerBeat } = transportGrid(meter);
    const pxPerStep = BAR_WIDTH[zoom] / stepsPerBar;
    // Bar zoom snaps to beats, 4-bar zoom to bars. Shift while dragging = steps.
    const snap = zoom === 'bar' ? stepsPerBeat : stepsPerBar;
    const loopEnd = arrangementEnd(arrangement);
    const barCount = Math.ceil(loopEnd / stepsPerBar) + TAIL_BARS;
    const laneWidth = barCount * stepsPerBar * pxPerStep;

    const selected = arrangement.clips.find((c) => c.id === selectedId) ?? null;

    // Playhead: imperative, from the worklet step.
    useEffect(() => {
        const place = (songStep: number) => {
            const el = playheadRef.current;
            if (!el) return;
            el.style.display = songStep < 0 ? 'none' : 'block';
            el.style.transform = `translateX(${HEADER_WIDTH + songStep * pxPerStep}px)`;
            if (el.dataset) el.dataset.step = String(songStep);
        };
        place(arrangementPlayhead.get());
        return arrangementPlayhead.subscribe(place);
    }, [pxPerStep]);

    const commit = useCallback((id: string, patch: ClipPatch) => {
        onEdit((prev) => updateClip(prev, id, patch));
    }, [onEdit]);

    const addClipAt = useCallback((track: TrackKey, startStep: number) => {
        let id = '';
        onEdit((prev) => {
            const result = addClip(prev, {
                track,
                patternSlot: activeTrackSlots[track] ?? 0,
                startStep: Math.max(0, startStep),
                lengthSteps: trackLoopLength(meter, track),
                loop: true,
            });
            id = result.id;
            return result.arrangement;
        });
        if (id) setSelectedId(id);
    }, [activeTrackSlots, meter, onEdit]);

    const appendClip = useCallback((track: TrackKey) => {
        let end = 0;
        for (const clip of arrangement.clips) if (clip.track === track) end = Math.max(end, clipEnd(clip));
        addClipAt(track, end);
    }, [addClipAt, arrangement.clips]);

    // ---- audio files (#1629) ----

    /** Song step under a pointer x (snapped like a drag), and the audio lane under it, if any. */
    const dropTarget = useCallback((e: React.DragEvent<HTMLElement>): { step: number; track: AudioTrackKey | null } => {
        const el = scrollRef.current;
        const rect = el?.getBoundingClientRect();
        const clientX = Number.isFinite(e.clientX) ? e.clientX : 0;
        const x = (rect ? clientX - rect.left + el!.scrollLeft : 0) - HEADER_WIDTH;
        const step = Math.max(0, Math.floor(x / pxPerStep / snap) * snap) || 0;
        const lane = (e.target as HTMLElement | null)?.closest?.('[data-audio-track]')?.getAttribute('data-audio-track');
        return { step, track: (lane as AudioTrackKey | null | undefined) ?? null };
    }, [pxPerStep, snap]);

    const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDropActive(true);
    }, []);

    const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        setDropActive(false);
        const files = audioFilesOf(e.dataTransfer?.files);
        if (files.length === 0) return;
        e.preventDefault();
        const { step, track } = dropTarget(e);
        void importFiles(files, track, step);
    }, [dropTarget, importFiles]);

    const removeSelected = useCallback(() => {
        if (!selectedId) return;
        onEdit((prev) => removeClip(prev, selectedId));
        setSelectedId(null);
    }, [onEdit, selectedId]);

    /** Split a clip at `at` (a song step strictly inside it); the left half keeps the id and the selection. */
    const splitAt = useCallback((id: string, at: number | null) => {
        if (at === null) return;
        onEdit((prev) => splitClip(prev, id, at).arrangement);
    }, [onEdit]);

    const splitByKey = useCallback((clip: ArrangementClip) => {
        splitAt(clip.id, keyboardSplitStep(clip, arrangementPlayhead.get(), snap));
    }, [snap, splitAt]);

    const gridFor = useCallback((clip: ArrangementClip) => ({
        pxPerStep,
        snap,
        clock,
        media: isAudioClip(clip) ? audio.media[clip.mediaId] ?? null : null,
    }), [audio.media, clock, pxPerStep, snap]);

    // ---- pointer editing ----

    const onClipPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, clip: ArrangementClip) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const handle = (e.target as HTMLElement | null)?.closest?.('[data-handle]')?.getAttribute('data-handle');
        const mode: ClipDragMode = (handle ? HANDLE_MODES.get(handle) : undefined)
            ?? (e.altKey ? 'alt' : x >= rect.width - EDGE_PX ? 'end' : x <= EDGE_PX ? 'start' : 'move');
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setSelectedId(clip.id);
        setDrag({
            id: clip.id, mode, pointerId: e.pointerId, originX: e.clientX, originY: e.clientY,
            downStep: clip.startStep + x / pxPerStep, moved: false, clip, preview: clip,
        });
    }, [pxPerStep]);

    const onClipPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const moved = drag.moved || Math.hypot(e.clientX - drag.originX, e.clientY - drag.originY) > CLICK_SLOP_PX;
        // An Alt press stays a click (a split) until the pointer travels.
        const preview = drag.mode === 'alt' && !moved
            ? drag.clip
            : clipDragPreview(drag, e.clientX, e.clientY, e.shiftKey, gridFor(drag.clip));
        setDrag({ ...drag, moved, preview });
    }, [drag, gridFor]);

    const onClipPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const { id, clip, preview } = drag;
        setDrag(null);
        if (drag.mode === 'alt' && !drag.moved) {
            splitAt(id, splitStepNear(clip, drag.downStep, e.shiftKey ? 1 : snap));
            return;
        }
        const patch = clipDragPatch(clip, preview);
        if (patch) commit(id, patch);
    }, [commit, drag, snap, splitAt]);

    const onLaneDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>, track: TrackKey) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const step = Math.floor((e.clientX - rect.left) / pxPerStep / snap) * snap;
        addClipAt(track, step);
    }, [addClipAt, pxPerStep, snap]);

    const onClipKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>, clip: ArrangementClip) => {
        const unit = e.altKey ? 1 : snap;
        const command = e.ctrlKey || e.metaKey;
        if (((e.key === 's' || e.key === 'S') && !command && !e.altKey) || (command && (e.key === 'e' || e.key === 'E'))) {
            e.preventDefault();
            // Not a note for the computer keyboard, too.
            e.stopPropagation();
            splitByKey(clip);
        } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && isAudioClip(clip)) {
            e.preventDefault();
            const step = (e.key === 'ArrowUp' ? 1 : -1) * (e.altKey ? 0.1 : 1);
            commit(clip.id, { gainDb: Math.round((clip.gainDb + step) * 10) / 10 });
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            const dir = e.key === 'ArrowRight' ? 1 : -1;
            if (e.shiftKey) commit(clip.id, { lengthSteps: Math.max(1, clip.lengthSteps + dir * unit) });
            else commit(clip.id, { startStep: Math.max(0, clip.startStep + dir * unit) });
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            onEdit((prev) => removeClip(prev, clip.id));
            setSelectedId(null);
        } else if ((e.key === 'l' || e.key === 'L') && isPatternClip(clip)) {
            e.preventDefault();
            commit(clip.id, { loop: !clip.loop });
        } else if (e.key === 'Escape') {
            setSelectedId(null);
        }
    }, [commit, onEdit, snap, splitByKey]);

    // ---- render ----

    const { patternClips, audioClips } = useMemo(() => {
        const pattern = new Map<string, PatternClip[]>();
        const audioByTrack = new Map<string, AudioClip[]>();
        for (const clip of arrangement.clips) {
            const shown = drag?.id === clip.id ? drag.preview : clip;
            if (isAudioClip(shown)) audioByTrack.set(shown.track, [...(audioByTrack.get(shown.track) ?? []), shown]);
            else pattern.set(shown.track, [...(pattern.get(shown.track) ?? []), shown]);
        }
        return { patternClips: pattern, audioClips: audioByTrack };
    }, [arrangement.clips, drag]);
    const shownAudioClips = useMemo(() => [...audioClips.values()].flat(), [audioClips]);

    const audioHandlers = useMemo<AudioClipHandlers>(() => ({
        onPointerDown: onClipPointerDown,
        onPointerMove: onClipPointerMove,
        onPointerUp: onClipPointerUp,
        onPointerCancel: () => setDrag(null),
        onKeyDown: onClipKeyDown,
        onFocus: setSelectedId,
        onLanePointerDown: () => setSelectedId(null),
        describe: (clip) => `at ${position(clip.startStep, stepsPerBar, stepsPerBeat)}, ${bars(clip.lengthSteps, stepsPerBar)}`,
    }), [onClipKeyDown, onClipPointerDown, onClipPointerMove, onClipPointerUp, stepsPerBar, stepsPerBeat]);
    const laneRows = SONG_MODE_TRACKS.length + audio.tracks.length + (audio.tracks.length < 8 ? 1 : 0);

    const btn = 'px-2.5 py-1 text-[10px] font-bold rounded-md border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500';
    const idle = 'bg-zinc-800 text-gray-400 border-zinc-700 hover:bg-zinc-700 hover:text-gray-200';

    return (
        <section
            aria-label="Arrangement timeline"
            className="hyphon-chrome-panel fixed inset-x-0 top-[calc(var(--hyphon-header-h,3rem)+0.5rem)] bottom-[320px] z-40 flex flex-col bg-[#0a0c0f] shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
        >
            <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-cyan-900/30 bg-[#0d1014] shrink-0">
                <h2 className="font-orbitron font-bold text-cyan-400 tracking-[0.18em] text-sm mr-2">ARRANGEMENT</h2>
                <div role="group" aria-label="Zoom" className="flex gap-1">
                    {(['bar', '4bars'] as const).map((z) => (
                        <button
                            key={z}
                            type="button"
                            aria-pressed={zoom === z}
                            onClick={() => setZoom(z)}
                            className={`${btn} ${zoom === z ? 'bg-cyan-900/50 text-cyan-300 border-cyan-600' : idle}`}
                        >
                            {z === 'bar' ? 'BAR' : '4 BARS'}
                        </button>
                    ))}
                </div>
                <span className="font-mono text-[10px] text-gray-500 ml-2" aria-live="off">
                    LEN {bars(loopEnd, stepsPerBar)}
                </span>
                <button
                    type="button"
                    aria-label="Shorten arrangement by one bar"
                    onClick={() => onEdit((prev) => setArrangementLength(prev, arrangementEnd(prev) - stepsPerBar))}
                    disabled={loopEnd - stepsPerBar < Math.max(1, lastClipEnd(arrangement))}
                    className={`${btn} ${idle} disabled:opacity-40`}
                >
                    - BAR
                </button>
                <button
                    type="button"
                    aria-label="Lengthen arrangement by one bar"
                    onClick={() => onEdit((prev) => setArrangementLength(prev, arrangementEnd(prev) + stepsPerBar))}
                    className={`${btn} ${idle}`}
                >
                    + BAR
                </button>
                <button
                    type="button"
                    aria-label="Add an audio track"
                    onClick={() => audioTrackStore.set((prev) => addAudioTrack(prev).state)}
                    disabled={audio.tracks.length >= 8}
                    className={`${btn} ${idle} disabled:opacity-40`}
                >
                    + AUDIO
                </button>
                <button type="button" aria-label="Import audio files onto a new audio track" onClick={() => fileInputRef.current?.click()} className={`${btn} ${idle}`}>
                    IMPORT
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*,.wav,.flac,.mp3,.ogg,.m4a,.aac"
                    multiple
                    hidden
                    data-testid="arrangement-audio-input"
                    onChange={(e) => {
                        const files = audioFilesOf(e.target.files);
                        e.target.value = '';
                        void importFiles(files, null, 0);
                    }}
                />
                {importStatus.kind !== 'idle' && (
                    <span role="status" className={`font-mono text-[10px] ${importStatus.kind === 'error' ? 'text-red-400' : 'text-gray-400'}`}>
                        {importStatus.text}
                    </span>
                )}
                <div className="flex-1" />
                <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="Undo your last edit (Ctrl/Cmd+Z)" className={`${btn} ${idle} disabled:opacity-40`}><span aria-hidden="true">UNDO</span></button>
                <button type="button" onClick={onRedo} disabled={!canRedo} aria-label="Redo your last undone edit (Ctrl/Cmd+Shift+Z)" className={`${btn} ${idle} disabled:opacity-40`}><span aria-hidden="true">REDO</span></button>
                <button
                    type="button"
                    onClick={() => onSetIsSongModeActive(!isSongModeActive)}
                    aria-pressed={isSongModeActive}
                    aria-label="Play the arrangement"
                    title={isSongModeActive ? 'PLAY follows the arrangement' : 'PLAY loops the current pattern'}
                    className={`${btn} ${isSongModeActive ? 'bg-purple-600 text-white border-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.5)]' : idle}`}
                >
                    {isSongModeActive ? 'LOOP SONG' : 'LOOP PATT'}
                </button>
                <button type="button" onClick={onClose} aria-label="Close Arrangement" title="Close Arrangement" className="ml-1 text-gray-400 hover:text-white text-lg px-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
                    <span aria-hidden="true">✕</span>
                </button>
            </div>

            <div
                ref={scrollRef}
                className={`flex-1 overflow-auto custom-scrollbar bg-[#0a0d10] ${dropActive ? 'outline outline-2 outline-teal-400/60 -outline-offset-2' : ''}`}
                onDragOver={onDragOver}
                onDragLeave={() => setDropActive(false)}
                onDrop={onDrop}
            >
                <div className="relative" style={{ width: HEADER_WIDTH + laneWidth, height: RULER_HEIGHT + laneRows * ROW_HEIGHT }}>
                    {/* Ruler */}
                    <div className="sticky top-0 z-20 flex h-[22px] bg-[#0d1014] border-b border-gray-800" style={{ width: HEADER_WIDTH + laneWidth }}>
                        <div className="sticky left-0 z-10 shrink-0 bg-[#0d1014] border-r border-gray-800" style={{ width: HEADER_WIDTH }} />
                        {Array.from({ length: barCount }, (_, b) => (
                            <div
                                key={b}
                                className={`shrink-0 border-l font-mono text-[10px] pl-1 leading-[22px] ${b * stepsPerBar < loopEnd ? 'border-gray-700 text-gray-500' : 'border-gray-800/50 text-gray-700'}`}
                                style={{ width: stepsPerBar * pxPerStep }}
                            >
                                {zoom === 'bar' || b % 4 === 0 ? b + 1 : ''}
                            </div>
                        ))}
                    </div>

                    {/* Lanes */}
                    {SONG_MODE_TRACKS.map((row) => (
                        <div key={row.key} className="flex border-b border-gray-900" style={{ height: ROW_HEIGHT }}>
                            <div className="sticky left-0 z-10 shrink-0 flex items-center justify-between gap-1 px-2 bg-[#0b0d10] border-r border-gray-800" style={{ width: HEADER_WIDTH }}>
                                <span className="font-mono text-[10px] font-bold tracking-[0.12em]" style={{ color: row.color }}>{row.label}</span>
                                <button
                                    type="button"
                                    aria-label={`Add ${row.label} clip`}
                                    title={`Add a clip of pattern ${(activeTrackSlots[row.key] ?? 0) + 1} after the last ${row.label} clip`}
                                    onClick={() => appendClip(row.key)}
                                    className="w-5 h-5 text-xs leading-none rounded border border-zinc-700 text-gray-400 hover:text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                                >
                                    +
                                </button>
                            </div>
                            <div
                                className="relative"
                                data-track={row.key}
                                style={{
                                    width: laneWidth,
                                    backgroundImage: `repeating-linear-gradient(to right, rgba(255,255,255,0.05) 0 1px, transparent 1px ${stepsPerBar * pxPerStep}px)`,
                                }}
                                onPointerDown={() => setSelectedId(null)}
                                onDoubleClick={(e) => onLaneDoubleClick(e, row.key)}
                            >
                                {/* Past the loop point */}
                                <div className="absolute inset-y-0 right-0 bg-black/40 pointer-events-none" style={{ left: loopEnd * pxPerStep }} />
                                {(patternClips.get(row.key) ?? []).map((clip) => {
                                    const patternLen = trackLoopLength(meter, clip.track);
                                    const isSelected = clip.id === selectedId;
                                    const width = Math.max(4, clip.lengthSteps * pxPerStep);
                                    // Where the pattern restarts (loop) or ends (one-shot) inside the clip.
                                    const offset = clip.offsetSteps ?? 0;
                                    const firstWrap = patternLen - (offset % patternLen);
                                    const marks: number[] = [];
                                    if (clip.loop) {
                                        for (let s = firstWrap; s < clip.lengthSteps && marks.length < 64; s += patternLen) marks.push(s);
                                    }
                                    const silentFrom = clip.loop ? null : Math.max(0, patternLen - offset);
                                    return (
                                        <div
                                            key={clip.id}
                                            role="button"
                                            tabIndex={0}
                                            data-clip-id={clip.id}
                                            aria-pressed={isSelected}
                                            aria-label={`${row.label} clip, pattern ${clip.patternSlot + 1}, at ${position(clip.startStep, stepsPerBar, stepsPerBeat)}, ${bars(clip.lengthSteps, stepsPerBar)}${clip.loop ? '' : ', one-shot'}${clip.lanes?.length ? ', automated' : ''}`}
                                            className={`absolute top-[3px] bottom-[3px] rounded-[4px] border overflow-hidden select-none touch-none cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${isSelected ? 'ring-1 ring-white/70' : ''}`}
                                            style={{
                                                left: clip.startStep * pxPerStep,
                                                width,
                                                background: `linear-gradient(180deg, ${row.color}55, ${row.color}26)`,
                                                borderColor: isSelected ? '#fff' : `${row.color}aa`,
                                                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
                                            }}
                                            onPointerDown={(e) => onClipPointerDown(e, clip)}
                                            onPointerMove={onClipPointerMove}
                                            onPointerUp={onClipPointerUp}
                                            onPointerCancel={() => setDrag(null)}
                                            onDoubleClick={(e) => e.stopPropagation()}
                                            onKeyDown={(e) => onClipKeyDown(e, clip)}
                                            onFocus={() => setSelectedId(clip.id)}
                                        >
                                            <span className="absolute left-1.5 top-0.5 font-mono text-[10px] font-bold text-white/90 pointer-events-none">
                                                P{clip.patternSlot + 1}{clip.loop ? '' : ' ▸'}{clip.lanes?.length ? ' ∿' : ''}
                                            </span>
                                            {marks.map((s) => (
                                                <span key={s} className="absolute inset-y-0 w-px bg-white/25 pointer-events-none" style={{ left: s * pxPerStep }} />
                                            ))}
                                            {silentFrom !== null && silentFrom < clip.lengthSteps && (
                                                <span
                                                    className="absolute inset-y-0 right-0 pointer-events-none"
                                                    style={{
                                                        left: silentFrom * pxPerStep,
                                                        backgroundImage: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.45) 0 3px, transparent 3px 6px)',
                                                    }}
                                                />
                                            )}
                                            <span className="absolute inset-y-0 left-0 w-[6px] cursor-ew-resize" aria-hidden="true" />
                                            <span className="absolute inset-y-0 right-0 w-[6px] cursor-ew-resize bg-white/10" aria-hidden="true" />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}

                    {audio.tracks.length > 0 && (
                        <AudioWaveformCanvas
                            scrollRef={scrollRef}
                            top={RULER_HEIGHT + SONG_MODE_TRACKS.length * ROW_HEIGHT}
                            headerWidth={HEADER_WIDTH}
                            laneWidth={laneWidth}
                            rowHeight={ROW_HEIGHT}
                            tracks={audio.tracks}
                            clips={shownAudioClips}
                            media={audio.media}
                            pxPerStep={pxPerStep}
                            clock={clock}
                            selectedId={selectedId}
                        />
                    )}
                    <AudioTrackLanes
                        tracks={audio.tracks}
                        media={audio.media}
                        clipsByTrack={audioClips}
                        selectedId={selectedId}
                        rowHeight={ROW_HEIGHT}
                        headerWidth={HEADER_WIDTH}
                        laneWidth={laneWidth}
                        pxPerStep={pxPerStep}
                        clock={clock}
                        barPx={stepsPerBar * pxPerStep}
                        loopEnd={loopEnd}
                        handlers={audioHandlers}
                        importing={importStatus.kind === 'busy'}
                    />

                    {/* Playhead */}
                    <div
                        ref={playheadRef}
                        data-testid="arrangement-playhead"
                        className="absolute top-0 bottom-0 left-0 w-[2px] bg-cyan-400/80 shadow-[0_0_6px_rgba(34,211,238,0.6)] pointer-events-none z-30"
                        style={{ display: 'none' }}
                    />
                </div>
            </div>

            {/* Selected clip inspector */}
            <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-t border-cyan-900/30 bg-[#0d1014] shrink-0 font-mono text-[10px] text-gray-400 min-h-[40px]">
                {selected && isAudioClip(selected) ? (
                    <AudioClipInspector
                        clip={selected}
                        track={audio.tracks.find((t) => t.id === selected.track) ?? null}
                        media={audio.media[selected.mediaId] ?? null}
                        position={position(selected.startStep, stepsPerBar, stepsPerBeat)}
                        onClipPatch={(patch) => commit(selected.id, patch)}
                        onTrackStrip={(id, patch) => audioTrackStore.set((prev) => updateAudioTrack(prev, id, patch))}
                        onSplit={() => splitByKey(selected)}
                        onDelete={removeSelected}
                        buttonClass={btn}
                    />
                ) : selected ? (
                    <>
                        <span className="font-bold text-gray-200">
                            {SONG_MODE_TRACKS.find((r) => r.key === selected.track)?.label} @ {position(selected.startStep, stepsPerBar, stepsPerBeat)}
                        </span>
                        <label className="flex items-center gap-1">
                            PATTERN
                            <select
                                value={selected.patternSlot}
                                onChange={(e) => commit(selected.id, { patternSlot: Number(e.target.value) })}
                                className="bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-cyan-300"
                            >
                                {Array.from({ length: MAX_TRACK_PATTERN_SLOTS }, (_, i) => (
                                    <option key={i} value={i}>{i + 1}</option>
                                ))}
                            </select>
                        </label>
                        <label htmlFor="arr-clip-length" className="flex items-center gap-1">
                            LENGTH
                            <input
                                id="arr-clip-length"
                                type="number"
                                min={1}
                                value={selected.lengthSteps}
                                onChange={(e) => {
                                    const n = Number(e.target.value);
                                    if (Number.isFinite(n) && n >= 1) commit(selected.id, { lengthSteps: n });
                                }}
                                className="w-14 bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-cyan-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                            />
                            steps
                        </label>
                        <label htmlFor="arr-clip-loop" className="flex items-center gap-1">
                            <input
                                id="arr-clip-loop"
                                type="checkbox"
                                checked={selected.loop}
                                onChange={(e) => commit(selected.id, { loop: e.target.checked })}
                                className="focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded-sm"
                            />
                            LOOP
                        </label>
                        <button type="button" onClick={() => splitByKey(selected)} title="Split at the playhead, or in the middle (S)" className={`${btn} ${idle}`}>
                            SPLIT
                        </button>
                        <button type="button" onClick={removeSelected} className={`${btn} text-red-400 border-red-900/60 bg-red-950/30 hover:bg-red-900/40`}>
                            DELETE
                        </button>
                    </>
                ) : (
                    <span>Double-click a lane or press + to add a clip · drop an audio file to add an audio clip · drag to move · drag edges to trim · Alt+click or S splits · audio: top handles fade and gain, Alt+drag slips · arrows move, Shift+arrows resize, ↑↓ gain, L loop, Del delete</span>
                )}
            </div>
            {selected && isPatternClip(selected) && <ClipLanePanel key={selected.id} clip={selected} onEdit={onEdit} />}
        </section>
    );
});

export default ArrangementView;
