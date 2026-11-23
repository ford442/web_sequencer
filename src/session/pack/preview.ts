/**
 * What the Session Launcher shows before an explicit load: the pack's name,
 * scenes and clips, tracks, and which instruments it asks for. Derived from a
 * validated `SessionPack` and the live storage; no state is read or written.
 */

import { TRACK_KEYS } from '@/constants';
import type { TrackKey } from '@/constants/appDefaults';
import { ENGINE_CATALOG } from '@/engines/backends/engineCatalog';
import type { PartSequence, SynthParams } from '@/types';
import { parseWaveform, type OscEngineId } from '@/utils/waveformParser';
import type { TrackStorageMap } from '@/utils/trackStorageUtils';
import { SESSION_TRACK_LABELS } from '../types';
import type { SessionPack } from './format';
import { findSlotCollisions, type SlotRef } from './plan';

export interface PackSceneSummary {
  name: string;
  /** Tracks this scene launches a (non-empty) clip on. */
  clips: number;
}

export interface PackTrackSummary {
  track: TrackKey;
  label: string;
  /** Non-empty clips in the column. */
  clips: number;
  /** Pattern slots the pack fills on this track. */
  patterns: number;
  /** Notes across those patterns. */
  notes: number;
}

export interface PackInstrumentSummary {
  part: 'SYNTH A' | 'SYNTH B';
  waveform: string;
  /** Engine family label, e.g. "Macro". */
  engine: string;
  /** What the browser or build must provide, or null when nothing special. */
  requirement: string | null;
  /** How many settings the pack applies besides the waveform. */
  settings: number;
}

export interface PackSummary {
  id: string;
  name: string;
  description: string;
  author?: string;
  rows: number;
  /** Scenes that launch at least one clip, in order. */
  scenes: PackSceneSummary[];
  /** Scenes with nothing to launch (the document keeps its unused rows). */
  emptyScenes: number;
  /** Only tracks that have clips or patterns. */
  tracks: PackTrackSummary[];
  instruments: PackInstrumentSummary[];
  totalClips: number;
  totalNotes: number;
  /** Plain-language things a pack cannot bring with it. */
  notices: string[];
}

const ENGINE_REQUIREMENTS: Record<OscEngineId, string | null> = {
  js: null,
  wav: null,
  wam: null,
  rust: 'AudioWorklet + WASM SIMD (plays the C++ OSC without SIMD, the WASM OSC table without a worklet)',
  cpp: 'AudioWorklet (plays the WASM OSC table without it)',
  wgsl: 'WebGPU (plays a fallback waveform without it)',
  pyodide: 'Python runtime (loads on first use)',
  '303': 'native 303 engine',
  prophecy: 'native Prophecy engine',
  macro: 'native macro engine (plays a fallback waveform without it)',
};

const countNotes = (slot: PartSequence | PartSequence[] | null): number =>
  slot == null ? 0 : (Array.isArray(slot) ? slot : [slot]).reduce((n, p) => n + p.steps.filter(Boolean).length, 0);

function describeInstrument(part: PackInstrumentSummary['part'], settings: Partial<SynthParams>): PackInstrumentSummary | null {
  const waveform = settings.waveform;
  const others = Object.keys(settings).filter((key) => key !== 'waveform').length;
  if (waveform === undefined) return others === 0 ? null : { part, waveform: 'current waveform', engine: 'unchanged', requirement: null, settings: others };
  const { engine } = parseWaveform(waveform);
  return { part, waveform, engine: ENGINE_CATALOG[engine].label, requirement: ENGINE_REQUIREMENTS[engine], settings: others };
}

export function summarizePack(pack: SessionPack): PackSummary {
  const { session } = pack;
  const rows = session.columns.partA.clips.length;

  const tracks: PackTrackSummary[] = [];
  for (const track of TRACK_KEYS) {
    const clips = session.columns[track].clips.filter((c) => !c.empty).length;
    const slots = pack.trackStorage[track].filter((s) => s != null);
    if (clips === 0 && slots.length === 0) continue;
    tracks.push({
      track,
      label: SESSION_TRACK_LABELS[track],
      clips,
      patterns: slots.length,
      notes: slots.reduce((n, s) => n + countNotes(s), 0),
    });
  }

  const allScenes = session.scenes.map((scene) => ({
    name: scene.name,
    clips: TRACK_KEYS.filter((t) => scene.clipIds[t] != null).length,
  }));
  const scenes = allScenes.filter((scene) => scene.clips > 0);

  const instruments: PackInstrumentSummary[] = [];
  for (const [key, part] of [['synthA', 'SYNTH A'], ['synthB', 'SYNTH B']] as const) {
    const settings = pack.instruments?.[key];
    const summary = settings ? describeInstrument(part, settings) : null;
    if (summary) instruments.push(summary);
  }

  const notices: string[] = [];
  if (tracks.some((t) => t.track === 'sampler')) {
    notices.push('Sampler clips trigger the sampler banks you have loaded; a pack carries patterns, not audio.');
  }
  if (instruments.length === 0) notices.push('No instrument settings: your current SYNTH A / B sounds are kept.');

  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    ...(pack.author ? { author: pack.author } : {}),
    rows,
    scenes,
    emptyScenes: allScenes.length - scenes.length,
    tracks,
    instruments,
    totalClips: tracks.reduce((n, t) => n + t.clips, 0),
    totalNotes: tracks.reduce((n, t) => n + t.notes, 0),
    notices,
  };
}

/** Everything the preview dialog needs, including what loading would collide with. */
export interface PackPreview {
  pack: SessionPack;
  summary: PackSummary;
  warnings: string[];
  /** Occupied slots the pack would replace (`overwrite`) or avoid (`relocate`). */
  collisions: SlotRef[];
  /** Set when `pack.id` was already taken and the pack was given another. */
  renamedFrom?: string;
}

export function previewPack(pack: SessionPack, current: TrackStorageMap, warnings: string[] = []): PackPreview {
  return { pack, summary: summarizePack(pack), warnings, collisions: findSlotCollisions(pack, current) };
}
