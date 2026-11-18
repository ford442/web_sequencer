/**
 * The arrangement's audio lanes (#1629 P1): one row per audio track under the
 * pattern lanes, a drop row to add one, and the inspector of a focused audio
 * clip. Clips move and trim with the same pointer and keyboard handlers as
 * pattern clips (`ArrangementView`); waveforms come with P2.
 */

import React, { memo } from 'react';
import type { AudioClip, AudioTrack, AudioTrackKey, MediaRef } from '../../types';
import { MAX_AUDIO_TRACKS } from '../../constants';
import { AUDIO_CLIP_GAIN_DB_RANGE } from '../../arrangement/model';
import { AUDIO_TRACK_GAIN_DB_RANGE } from '../../arrangement/audioTracks';
import { trackMuteSoloStore, useTrackMuteSolo } from '../../stores/trackMuteSoloStore';

export const AUDIO_LANE_COLOR = '#2dd4bf';

export interface AudioClipHandlers {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>, clip: AudioClip) => void;
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: () => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>, clip: AudioClip) => void;
    onFocus: (id: string) => void;
    onLanePointerDown: () => void;
    /** Accessible "at 5.1.1, 2 bars". */
    describe: (clip: AudioClip) => string;
}

export interface AudioTrackLanesProps {
    tracks: readonly AudioTrack[];
    media: Readonly<Record<string, MediaRef>>;
    clipsByTrack: ReadonlyMap<string, readonly AudioClip[]>;
    selectedId: string | null;
    rowHeight: number;
    headerWidth: number;
    laneWidth: number;
    pxPerStep: number;
    barPx: number;
    loopEnd: number;
    handlers: AudioClipHandlers;
    importing: boolean;
}

function mediaName(media: Readonly<Record<string, MediaRef>>, id: string): string {
    return media[id]?.name || 'missing media';
}

export const AudioTrackLanes = memo(function AudioTrackLanes({
    tracks, media, clipsByTrack, selectedId, rowHeight, headerWidth, laneWidth, pxPerStep, barPx, loopEnd, handlers, importing,
}: AudioTrackLanesProps) {
    const { muted, soloed } = useTrackMuteSolo();
    const pad = 'w-5 h-5 text-[9px] font-bold leading-none rounded border focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500';
    return (
        <>
            {tracks.map((track) => {
                const isMuted = muted.includes(track.id);
                const isSoloed = soloed.includes(track.id);
                return (
                    <div key={track.id} className="flex border-b border-gray-900" style={{ height: rowHeight }}>
                        <div className="sticky left-0 z-10 shrink-0 flex items-center justify-between gap-1 px-2 bg-[#0b0d10] border-r border-gray-800" style={{ width: headerWidth }}>
                            <span className="font-mono text-[10px] font-bold tracking-[0.08em] truncate" style={{ color: AUDIO_LANE_COLOR }} title={track.name}>{track.name.toUpperCase()}</span>
                            <span className="flex gap-0.5 shrink-0">
                                <button type="button" aria-pressed={isMuted} aria-label={`Mute ${track.name}`} onClick={() => trackMuteSoloStore.toggleMute(track.id)}
                                    className={`${pad} ${isMuted ? 'bg-amber-600 text-black border-amber-400' : 'border-zinc-700 text-gray-400 hover:bg-zinc-700'}`}>M</button>
                                <button type="button" aria-pressed={isSoloed} aria-label={`Solo ${track.name}`} onClick={() => trackMuteSoloStore.toggleSolo(track.id)}
                                    className={`${pad} ${isSoloed ? 'bg-lime-500 text-black border-lime-300' : 'border-zinc-700 text-gray-400 hover:bg-zinc-700'}`}>S</button>
                            </span>
                        </div>
                        <div
                            className="relative"
                            data-audio-track={track.id}
                            style={{
                                width: laneWidth,
                                backgroundImage: `repeating-linear-gradient(to right, rgba(255,255,255,0.05) 0 1px, transparent 1px ${barPx}px)`,
                            }}
                            onPointerDown={handlers.onLanePointerDown}
                        >
                            <div className="absolute inset-y-0 right-0 bg-black/40 pointer-events-none" style={{ left: loopEnd * pxPerStep }} />
                            {(clipsByTrack.get(track.id) ?? []).map((clip) => {
                                const isSelected = clip.id === selectedId;
                                const name = mediaName(media, clip.mediaId);
                                const missing = !media[clip.mediaId];
                                return (
                                    <div
                                        key={clip.id}
                                        role="button"
                                        tabIndex={0}
                                        data-clip-id={clip.id}
                                        aria-pressed={isSelected}
                                        aria-label={`${track.name} audio clip, ${name}, ${handlers.describe(clip)}${clip.gainDb ? `, ${clip.gainDb} dB` : ''}`}
                                        className={`absolute top-[3px] bottom-[3px] rounded-[4px] border overflow-hidden select-none touch-none cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${isSelected ? 'ring-1 ring-white/70' : ''}`}
                                        style={{
                                            left: clip.startStep * pxPerStep,
                                            width: Math.max(4, clip.lengthSteps * pxPerStep),
                                            background: missing
                                                ? 'repeating-linear-gradient(135deg, rgba(239,68,68,0.25) 0 4px, transparent 4px 8px)'
                                                : `linear-gradient(180deg, ${AUDIO_LANE_COLOR}55, ${AUDIO_LANE_COLOR}22)`,
                                            borderColor: isSelected ? '#fff' : `${AUDIO_LANE_COLOR}aa`,
                                        }}
                                        onPointerDown={(e) => handlers.onPointerDown(e, clip)}
                                        onPointerMove={handlers.onPointerMove}
                                        onPointerUp={handlers.onPointerUp}
                                        onPointerCancel={handlers.onPointerCancel}
                                        onDoubleClick={(e) => e.stopPropagation()}
                                        onKeyDown={(e) => handlers.onKeyDown(e, clip)}
                                        onFocus={() => handlers.onFocus(clip.id)}
                                    >
                                        <span className="absolute left-1.5 top-0.5 right-2 truncate font-mono text-[10px] font-bold text-white/90 pointer-events-none">
                                            ♪ {name}{clip.gainDb ? ` ${clip.gainDb > 0 ? '+' : ''}${clip.gainDb} dB` : ''}
                                        </span>
                                        <span className="absolute inset-y-0 left-0 w-[6px] cursor-ew-resize" aria-hidden="true" />
                                        <span className="absolute inset-y-0 right-0 w-[6px] cursor-ew-resize bg-white/10" aria-hidden="true" />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
            {tracks.length < MAX_AUDIO_TRACKS && (
                <div className="flex border-b border-gray-900" style={{ height: rowHeight }}>
                    <div className="sticky left-0 z-10 shrink-0 flex items-center px-2 bg-[#0b0d10] border-r border-gray-800 font-mono text-[9px] text-gray-500" style={{ width: headerWidth }}>
                        + AUDIO
                    </div>
                    <div
                        className="relative flex items-center pl-3 font-mono text-[10px] text-gray-500 border border-dashed border-gray-800"
                        data-audio-drop="new"
                        style={{ width: laneWidth }}
                    >
                        {importing ? 'Importing…' : 'Drop a WAV, FLAC, MP3, Ogg or AAC file here (or on any lane) to add an audio track'}
                    </div>
                </div>
            )}
        </>
    );
});

export interface AudioClipInspectorProps {
    clip: AudioClip;
    track: AudioTrack | null;
    media: MediaRef | null;
    position: string;
    onClipGain: (gainDb: number) => void;
    onClipLength: (lengthSteps: number) => void;
    onTrackStrip: (id: AudioTrackKey, patch: Partial<Pick<AudioTrack, 'gainDb' | 'pan'>>) => void;
    onDelete: () => void;
    buttonClass: string;
}

function numberField(value: string, min: number, max: number, onValue: (n: number) => void): number | null {
    const n = Number(value);
    if (!Number.isFinite(n) || value.trim() === '') return null;
    const clamped = Math.min(max, Math.max(min, n));
    onValue(clamped);
    return clamped;
}

export const AudioClipInspector = memo(function AudioClipInspector({
    clip, track, media, position, onClipGain, onClipLength, onTrackStrip, onDelete, buttonClass,
}: AudioClipInspectorProps) {
    const input = 'w-14 bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-cyan-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500';
    const seconds = media ? (media.frames / media.sampleRate).toFixed(1) : null;
    return (
        <>
            <span className="font-bold text-gray-200">{track?.name ?? clip.track} @ {position}</span>
            <span className={media ? 'text-gray-300' : 'text-red-400'} title={clip.mediaId}>
                {media ? `${media.name} · ${seconds} s · ${media.sampleRate / 1000} kHz · ${media.channels === 1 ? 'mono' : 'stereo'}` : 'media missing from this browser'}
            </span>
            <label htmlFor="arr-audio-gain" className="flex items-center gap-1">
                CLIP
                <input id="arr-audio-gain" type="number" step={0.5} min={AUDIO_CLIP_GAIN_DB_RANGE[0]} max={AUDIO_CLIP_GAIN_DB_RANGE[1]} value={clip.gainDb}
                    onChange={(e) => numberField(e.target.value, AUDIO_CLIP_GAIN_DB_RANGE[0], AUDIO_CLIP_GAIN_DB_RANGE[1], onClipGain)} className={input} />
                dB
            </label>
            <label htmlFor="arr-audio-length" className="flex items-center gap-1">
                LENGTH
                <input id="arr-audio-length" type="number" min={1} value={clip.lengthSteps}
                    onChange={(e) => numberField(e.target.value, 1, 1 << 20, (n) => onClipLength(Math.round(n)))} className={input} />
                steps
            </label>
            {track && (
                <>
                    <label htmlFor="arr-audio-fader" className="flex items-center gap-1">
                        TRACK
                        <input id="arr-audio-fader" type="number" step={0.5} min={AUDIO_TRACK_GAIN_DB_RANGE[0]} max={AUDIO_TRACK_GAIN_DB_RANGE[1]} value={track.gainDb}
                            onChange={(e) => numberField(e.target.value, AUDIO_TRACK_GAIN_DB_RANGE[0], AUDIO_TRACK_GAIN_DB_RANGE[1], (gainDb) => onTrackStrip(track.id, { gainDb }))} className={input} />
                        dB
                    </label>
                    <label htmlFor="arr-audio-pan" className="flex items-center gap-1">
                        PAN
                        <input id="arr-audio-pan" type="number" step={0.1} min={-1} max={1} value={track.pan}
                            onChange={(e) => numberField(e.target.value, -1, 1, (pan) => onTrackStrip(track.id, { pan }))} className={input} />
                    </label>
                </>
            )}
            <button type="button" onClick={onDelete} className={`${buttonClass} text-red-400 border-red-900/60 bg-red-950/30 hover:bg-red-900/40`}>
                DELETE
            </button>
        </>
    );
});
