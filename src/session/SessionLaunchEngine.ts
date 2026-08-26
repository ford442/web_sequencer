import { TRACK_KEYS } from '@/constants';
import type { TrackKey } from '@/constants/appDefaults';
import { NUM_STEPS } from '@/constants';
import {
  resolveTrackConflicts,
  shouldPreemptSession,
  shouldPreemptSongMode,
} from './conflict';
import { emptyPlayingMap } from './defaults';
import { resolveFollowClip } from './followActions';
import { nextFollowBoundary, quantizeLaunch } from './quantize';
import type {
  ClipId,
  CompiledLaunchEvent,
  LaunchIntent,
  LaunchQuantization,
  PlayingClipState,
  SessionCaptureEvent,
  SessionDocument,
  SessionTickResult,
  TransportClockSnapshot,
} from './types';

function playingRecord(): Record<TrackKey, PlayingClipState | null> {
  const map = {} as Record<TrackKey, PlayingClipState | null>;
  for (const t of TRACK_KEYS) map[t] = null;
  return map;
}

export class SessionLaunchEngine {
  document: SessionDocument;
  quantization: LaunchQuantization;
  playing: Record<TrackKey, PlayingClipState | null> = playingRecord();
  queued: CompiledLaunchEvent[] = [];
  timelineStep = 0;
  private lastClockStep = -1;
  private seq = 0;
  capturing = false;
  captureEvents: SessionCaptureEvent[] = [];
  private rng: () => number;
  private songModeLatched = false;

  constructor(document: SessionDocument, rng: () => number = Math.random) {
    this.document = document;
    this.quantization = document.quantization;
    this.rng = rng;
  }

  setDocument(document: SessionDocument): void {
    this.document = document;
    this.quantization = document.quantization;
  }

  setQuantization(q: LaunchQuantization): void {
    this.quantization = q;
    this.document = { ...this.document, quantization: q };
  }

  nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  resetTransport(): void {
    this.queued = [];
    this.playing = playingRecord();
    this.timelineStep = 0;
    this.lastClockStep = -1;
    this.songModeLatched = false;
  }

  armCapture(): void {
    this.capturing = true;
    this.captureEvents = [];
  }

  disarmCapture(): SessionCaptureEvent[] {
    this.capturing = false;
    return this.captureEvents.slice();
  }

  /**
   * Compile a user/MIDI/scene intent into queued timeline events.
   * Does not depend on React; call from click/MIDI handlers with the latest clock.
   */
  enqueue(intent: Omit<LaunchIntent, 'requestSeq'> & { requestSeq?: number }, clock: TransportClockSnapshot): CompiledLaunchEvent[] {
    const requestSeq = intent.requestSeq ?? this.nextSeq();
    const full: LaunchIntent = { ...intent, requestSeq };
    const events = this.compileIntent(full, clock);
    this.queued.push(...events);
    this.queued.sort((a, b) => a.timelineStep - b.timelineStep || a.requestSeq - b.requestSeq);
    return events;
  }

  compileIntent(intent: LaunchIntent, clock: TransportClockSnapshot): CompiledLaunchEvent[] {
    const q = quantizeLaunch(
      this.quantization,
      clock,
      intent.requestStep,
      intent.requestAudioTime,
      this.timelineStep,
    );

    if (intent.kind === 'stop-all') {
      return TRACK_KEYS.map((track) => this.makeEvent(intent, clock, q, track, 'stop', null));
    }

    if (intent.kind === 'stop-track' && intent.track) {
      return [this.makeEvent(intent, clock, q, intent.track, 'stop', null)];
    }

    if (intent.kind === 'scene' && intent.sceneId) {
      const scene = this.document.scenes.find((s) => s.id === intent.sceneId);
      if (!scene) return [];
      const out: CompiledLaunchEvent[] = [];
      for (const track of TRACK_KEYS) {
        const clipId = scene.clipIds[track];
        if (clipId === undefined) continue;
        if (clipId === null) {
          out.push(this.makeEvent(intent, clock, q, track, 'stop', null, scene.id));
          continue;
        }
        const clip = this.document.columns[track]?.clips.find((c) => c.id === clipId);
        if (!clip || clip.empty) continue;
        const playing = this.playing[track];
        const action = playing ? 'replace' : 'start';
        out.push(this.makeEvent(intent, clock, q, track, action, clip.id, scene.id));
      }
      return out;
    }

    if (intent.kind === 'clip' && intent.track && intent.clipId) {
      const track = intent.track;
      const clip = this.document.columns[track]?.clips.find((c) => c.id === intent.clipId);
      if (!clip || clip.empty) return [];

      const playing = this.playing[track];

      if (clip.launchMode === 'gate' && intent.gateDown === false) {
        if (playing?.clipId === clip.id) {
          return [this.makeEvent(intent, clock, q, track, 'stop', null)];
        }
        return [];
      }

      if (clip.launchMode === 'toggle' && playing?.clipId === clip.id) {
        return [this.makeEvent(intent, clock, q, track, 'stop', null)];
      }

      const action = playing ? 'replace' : 'start';
      return [this.makeEvent(intent, clock, q, track, action, clip.id)];
    }

    return [];
  }

  /**
   * Consume the audio-clock step. Returns applied events for this exact boundary.
   */
  tick(clock: TransportClockSnapshot): SessionTickResult {
    if (this.lastClockStep < 0) {
      this.timelineStep = 0;
    } else if (clock.step !== this.lastClockStep) {
      const pattern = Math.max(1, clock.patternSteps);
      const delta = (clock.step - this.lastClockStep + pattern) % pattern;
      this.timelineStep += delta === 0 ? 1 : delta;
    }
    this.lastClockStep = clock.step;

    if (clock.songModeActive && !this.songModeLatched && !this.hasLiveQueued()) {
      this.songModeLatched = true;
      const songModeStops = this.stopPlayingAsSongMode(clock);
      if (songModeStops.length > 0) {
        return this.applyEvents(songModeStops, clock, false, true);
      }
    }
    if (!clock.songModeActive) this.songModeLatched = false;

    const due: CompiledLaunchEvent[] = [];
    const remaining: CompiledLaunchEvent[] = [];
    for (let i = 0; i < this.queued.length; i++) {
      const e = this.queued[i];
      if (e.timelineStep <= this.timelineStep) {
        due.push(e);
      } else {
        remaining.push(e);
      }
    }
    this.queued = remaining;

    const follow = clock.songModeActive ? [] : this.collectFollowEvents(clock);
    const merged = resolveTrackConflicts([...due, ...follow]);

    const preemptSongMode = merged.some((e) => shouldPreemptSongMode(e.source, clock.songModeActive));
    const preemptSession = merged.some((e) => shouldPreemptSession(e.source));

    return this.applyEvents(merged, clock, preemptSongMode, preemptSession);
  }

  playingSlot(track: TrackKey): number | null {
    return this.playing[track]?.slotIndex ?? null;
  }

  playingSlots(): Record<TrackKey, number | null> {
    const out = emptyPlayingMap() as Record<TrackKey, number | null>;
    for (const track of TRACK_KEYS) {
      out[track] = this.playingSlot(track);
    }
    return out;
  }

  hasPlaying(): boolean {
    return TRACK_KEYS.some((t) => this.playing[t] != null);
  }

  private hasLiveQueued(): boolean {
    return this.queued.some(
      (e) => e.source === 'manual' || e.source === 'midi' || e.source === 'gamepad' || e.source === 'scene',
    );
  }

  private collectFollowEvents(clock: TransportClockSnapshot): CompiledLaunchEvent[] {
    const out: CompiledLaunchEvent[] = [];
    for (const track of TRACK_KEYS) {
      const playing = this.playing[track];
      if (!playing) continue;
      const clip = this.document.columns[track]?.clips.find((c) => c.id === playing.clipId);
      if (!clip) continue;
      const length = clock.patternSteps || NUM_STEPS;
      const boundary = nextFollowBoundary(clock, playing.startedTimelineStep, length, this.timelineStep);
      if (!boundary) continue;

      if (clip.launchMode === 'one-shot') {
        out.push(this.followEvent(clock, boundary, track, 'stop', null));
        continue;
      }

      if (clip.followAction === 'repeat') {
        playing.loopsCompleted += 1;
        if (playing.followRepeatRemaining > 1) {
          playing.followRepeatRemaining -= 1;
          continue;
        }
        out.push(this.followEvent(clock, boundary, track, 'stop', null));
        continue;
      }

      const next = resolveFollowClip(this.document, track, clip, this.rng);
      if (next === 'stop') {
        out.push(this.followEvent(clock, boundary, track, 'stop', null));
      } else if (next) {
        out.push(this.followEvent(clock, boundary, track, 'replace', next.id));
      }
    }
    return out;
  }

  private applyEvents(
    events: CompiledLaunchEvent[],
    clock: TransportClockSnapshot,
    preemptSongMode: boolean,
    preemptSession: boolean,
  ): SessionTickResult {
    const flushTracks: TrackKey[] = [];
    const applied: CompiledLaunchEvent[] = [];

    if (preemptSession) {
      for (const track of TRACK_KEYS) {
        if (this.playing[track]) {
          flushTracks.push(track);
          this.playing[track] = null;
        }
      }
      this.queued = [];
    }

    for (const ev of events) {
      const prev = this.playing[ev.track];
      if (ev.action === 'stop') {
        if (prev) flushTracks.push(ev.track);
        this.playing[ev.track] = null;
        applied.push(ev);
        if (this.capturing) {
          this.captureEvents.push({
            audioTime: ev.audioTime,
            step: ev.step,
            timelineStep: ev.timelineStep,
            track: ev.track,
            action: ev.action,
            clipId: ev.clipId,
            slotIndex: ev.slotIndex,
            sceneId: ev.sceneId,
          });
        }
      } else if (ev.clipId) {
        const clip = this.document.columns[ev.track]?.clips.find((c) => c.id === ev.clipId);
        if (!clip || clip.empty) continue;
        if (prev && prev.clipId !== clip.id) flushTracks.push(ev.track);
        this.playing[ev.track] = {
          clipId: clip.id,
          slotIndex: clip.slotIndex,
          launchMode: clip.launchMode,
          loopsCompleted: 0,
          followRepeatRemaining: clip.followRepeatN,
          startedTimelineStep: this.timelineStep,
        };
        applied.push(ev);
        if (this.capturing) {
          this.captureEvents.push({
            audioTime: ev.audioTime,
            step: ev.step,
            timelineStep: ev.timelineStep,
            track: ev.track,
            action: ev.action,
            clipId: ev.clipId,
            slotIndex: ev.slotIndex,
            sceneId: ev.sceneId,
          });
        }
      }
    }

    if (preemptSongMode) this.songModeLatched = false;

    return {
      applied,
      flushTracks: [...new Set(flushTracks)],
      playing: { ...this.playing },
      queued: this.queued.slice(),
      preemptSongMode,
      preemptSession,
    };
  }

  private stopPlayingAsSongMode(clock: TransportClockSnapshot): CompiledLaunchEvent[] {
    if (!this.hasPlaying()) return [];
    const q = quantizeLaunch('immediate', clock, clock.step, clock.audioTime, this.timelineStep);
    const events: CompiledLaunchEvent[] = [];
    for (let i = 0; i < TRACK_KEYS.length; i++) {
      const track = TRACK_KEYS[i];
      if (this.playing[track]) {
        events.push(
          this.makeEvent(
            {
              kind: 'stop-all',
              source: 'song-mode',
              requestSeq: this.nextSeq(),
              requestAudioTime: clock.audioTime,
              requestStep: clock.step,
            },
            clock,
            q,
            track,
            'stop',
            null,
          ),
        );
      }
    }
    return events;
  }

  private makeEvent(
    intent: LaunchIntent,
    _clock: TransportClockSnapshot,
    q: { step: number; audioTime: number; timelineStep: number },
    track: TrackKey,
    action: CompiledLaunchEvent['action'],
    clipId: ClipId | null,
    sceneId?: string,
  ): CompiledLaunchEvent {
    const clip = clipId
      ? this.document.columns[track]?.clips.find((c) => c.id === clipId)
      : undefined;
    return {
      audioTime: q.audioTime,
      step: q.step,
      timelineStep: q.timelineStep,
      track,
      action,
      clipId,
      slotIndex: clip?.slotIndex ?? null,
      sceneId,
      source: intent.source,
      requestSeq: intent.requestSeq,
    };
  }

  private followEvent(
    clock: TransportClockSnapshot,
    q: { step: number; audioTime: number; timelineStep: number },
    track: TrackKey,
    action: CompiledLaunchEvent['action'],
    clipId: ClipId | null,
  ): CompiledLaunchEvent {
    return this.makeEvent(
      {
        kind: clipId ? 'clip' : 'stop-track',
        source: 'follow',
        requestSeq: this.nextSeq(),
        requestAudioTime: clock.audioTime,
        requestStep: clock.step,
        track,
        clipId: clipId ?? undefined,
      },
      clock,
      q,
      track,
      action,
      clipId,
    );
  }
}
