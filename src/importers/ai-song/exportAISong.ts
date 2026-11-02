/**
 * SavedSongData → AISongData: the inverse of `AISongImporter.convert`.
 *
 * The co-producer agent reads the open song through this (`get_song`), edits
 * it, and may hand it back to the importer whole (`import_song`). So the
 * contract is a round trip: importing what this writes gives back the song it
 * was given, and exporting that again gives the same JSON.
 *
 *   - Anything the importer would fill in by default is left out (a velocity
 *     of 0.8, a 4/4 meter, straight swing, a knob at its import default), so
 *     the JSON an agent reads is only what the song actually says.
 *   - A pattern is named after the slot it lives in (`slot0`, `slot3`, …): a
 *     track that plays `slot3` in a `song` row plays `trackStorage[track][3]`.
 *     That is the slot `edit_pattern` addresses.
 *   - Whatever the format cannot carry is reported in `losses`, never dropped
 *     silently: note FX, chords, drum velocities, drum knobs, off-grid clips,
 *     lanes that never play, … An agent told "the open song also has X" does
 *     not overwrite X by accident.
 *
 * The song it writes passes `validateAISongData` and the strict importer: an
 * automation lane the live scheduler never plays is reported, not exported,
 * because strict import would reject it.
 */

import type {
  Bass2Params,
  Note,
  PartSequence,
  SamplerBankParams,
  SavedSongData,
  SynthParams,
  TrackKey,
  UnifiedAutomationLane,
} from '../../types';
import type { ArrangementClip } from '../../types/song';
import type { SongStructure } from '../../types/songMode';
import { TRACK_KEYS } from '../../constants';
import { normalizeArrangement, projectArrangement, songStructureToArrangement } from '../../arrangement/model';
import { resolveSongMeter } from '../../utils/songMeter';
import { laneDispatchGap } from '../../audio/automation/laneResolver';
import { VALID_PARAMETERS_BY_TARGET } from './automationParameters';
import { AI_SONG_TRACK_NAMES, AI_TRACK_TO_TRACK_KEY, resolveSongBlock } from './songBlock';
import { tilePatternAutomation } from './automation';
import {
  AI_SONG_ACCENT_TIMBRE,
  AI_SONG_BASS2_FIXED,
  AI_SONG_DEFAULT_LENGTH,
  AI_SONG_DEFAULT_SAMPLER_BANK,
  AI_SONG_DEFAULT_SYNTH,
  AI_SONG_DEFAULT_VELOCITY,
  AI_SONG_DRUM_PARAMS,
  AI_SONG_PLAIN_TIMBRE,
  isValidNote,
} from './AISongImporter';
import type {
  AIAutomationLane,
  AIAutomationTarget,
  AINoteEvent,
  AIPatternData,
  AISamplerBankData,
  AISongData,
  AISongRow,
  AISongTrackName,
  AISongTracks,
  AITargetedParameter,
  AITrackData,
} from './types';

/** Something in the song the AI format cannot say. */
export interface AISongExportLoss {
  /** Where it is in the open song, e.g. `partA slot 2`, `automationLanes[3]`, `noteFx`. */
  where: string;
  message: string;
}

export interface AISongExport {
  song: AISongData;
  /** Empty when the export is lossless. */
  losses: AISongExportLoss[];
}

export interface AISongExportOptions {
  /** `meta` of the written song. Defaults describe an export, with `createdAt` now. */
  meta?: Partial<AISongData['meta']>;
}

/** Pattern id of slot `slot` (`slot0`, `slot1`, …). */
export function slotPatternId(slot: number): string {
  return `slot${slot}`;
}

/** Slot a `slotPatternId` names, or null. */
export function patternIdSlot(id: string): number | null {
  const m = /^slot(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

const MELODIC: ReadonlySet<AISongTrackName> = new Set(['synthA', 'synthB', 'bass2']);
const DRUMS = ['kick', 'snare', 'closedHat', 'openHat'] as const;
const SAMPLER_BANKS = 8;

/** Note fields the AI note event carries (drums: the hit itself); anything else on a `Note` is a loss. */
const MELODIC_NOTE_FIELDS = new Set(['note', 'velocity', 'length', 'slide', 'timbre']);
const SAMPLER_NOTE_FIELDS = new Set(['note', 'velocity', 'length']);

const isImportableTimeSignature = (ts: unknown): ts is [number, number] =>
  Array.isArray(ts) && ts.length === 2 && ts.every((n) => Number.isInteger(n) && n >= 1 && n <= 32);
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** The keys of `value` that differ from `base` (undefined values left out). */
function diffFrom<T extends object>(value: T, base: Readonly<Partial<T>>): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, v] of Object.entries(value) as [keyof T, T[keyof T]][]) {
    if (v === undefined) continue;
    if (!deepEqual(v, base[key])) out[key] = v;
  }
  return out;
}

/** Steps of a stored pattern (a slot may be null: an empty pattern). */
function stepsOf(seq: PartSequence | null | undefined): readonly (Note | null)[] {
  return seq?.steps ?? [];
}

class Exporter {
  readonly losses: AISongExportLoss[] = [];
  private readonly lossKeys = new Set<string>();
  readonly steps: number;
  constructor(steps: number) {
    this.steps = steps;
  }

  lose(where: string, message: string): void {
    const key = `${where}\u0000${message}`;
    if (this.lossKeys.has(key)) return;
    this.lossKeys.add(key);
    this.losses.push({ where, message });
  }

  /** Steps past the song length that hold notes. */
  private checkOverflow(steps: readonly (Note | null)[], where: string): void {
    const past = steps.slice(this.steps).filter(Boolean).length;
    if (past > 0) this.lose(where, `${past} note${past === 1 ? '' : 's'} past step ${this.steps} (the song length) not exported`);
  }

  /** Report fields of `notes` outside `allowed`, once per field. */
  private checkFields(notes: readonly Note[], allowed: ReadonlySet<string>, where: string): void {
    const extra = new Map<string, number>();
    for (const note of notes) {
      for (const [k, v] of Object.entries(note)) {
        if (v === undefined || allowed.has(k)) continue;
        // Neutral values say nothing: the grid writes `slide: false` on every step it creates.
        if (v === false || v === 0 || (Array.isArray(v) && v.length === 0) || (k === 'probability' && v === 1)) continue;
        extra.set(k, (extra.get(k) ?? 0) + 1);
      }
    }
    if (extra.size === 0) return;
    const list = [...extra].map(([k, n]) => `${k} (${n})`).join(', ');
    this.lose(where, `note fields the AI format has no place for: ${list}`);
  }

  melodicTrack(seq: PartSequence | null | undefined, where: string): AINoteEvent[] {
    const steps = stepsOf(seq);
    this.checkOverflow(steps, where);
    const notes: AINoteEvent[] = [];
    const kept: Note[] = [];
    let roundedTimbre = 0;
    for (let step = 0; step < Math.min(steps.length, this.steps); step++) {
      const n = steps[step];
      if (!n) continue;
      const event = this.noteEvent(step, n, where);
      if (!event) continue;
      kept.push(n);
      const timbre = n.timbre;
      if (timbre !== undefined && timbre !== AI_SONG_ACCENT_TIMBRE && timbre !== AI_SONG_PLAIN_TIMBRE) roundedTimbre++;
      if (timbre !== undefined && timbre > 0.75) event.accent = true;
      if (n.slide) event.slide = true;
      notes.push(event);
    }
    this.checkFields(kept, MELODIC_NOTE_FIELDS, where);
    if (roundedTimbre > 0) {
      this.lose(where, `${roundedTimbre} note timbre value${roundedTimbre === 1 ? '' : 's'} rounded to accent on/off`);
    }
    return notes;
  }

  /** The step / note / velocity / length every note event has, or null when the note name is unusable. */
  private noteEvent(step: number, n: Note, where: string): AINoteEvent | null {
    if (typeof n.note !== 'string' || !isValidNote(n.note)) {
      this.lose(where, `step ${step}: note "${String(n.note)}" is not a note name the AI format takes (C0–B8) — not exported`);
      return null;
    }
    const event: AINoteEvent = { step, note: n.note };
    const velocity = typeof n.velocity === 'number' ? clamp(n.velocity, 0, 1) : AI_SONG_DEFAULT_VELOCITY;
    if (velocity !== n.velocity && typeof n.velocity === 'number') this.lose(where, `step ${step}: velocity clamped to 0–1`);
    if (velocity !== AI_SONG_DEFAULT_VELOCITY) event.velocity = velocity;
    if (typeof n.length === 'number' && n.length !== AI_SONG_DEFAULT_LENGTH) {
      if (n.length >= 1) event.length = n.length;
      else this.lose(where, `step ${step}: length ${n.length} is under one step — exported as 1`);
    }
    return event;
  }

  drumTrack(seq: PartSequence | null | undefined, where: string): boolean[] {
    const steps = stepsOf(seq);
    this.checkOverflow(steps, where);
    const hits = Array.from({ length: this.steps }, (_, i) => !!steps[i]);
    const notes = steps.slice(0, this.steps).filter((n): n is Note => !!n);
    const soft = notes.filter((n) => n.velocity !== 1).length;
    if (soft > 0) this.lose(where, `${soft} drum hit${soft === 1 ? '' : 's'} with a velocity other than 1 (drum hits are on/off in the AI format)`);
    this.checkFields(notes, MELODIC_NOTE_FIELDS, where);
    return hits;
  }

  /** Sampler banks with notes in `banks`, one entry each (params attached separately). */
  samplerBanks(banks: readonly (PartSequence | null)[] | null | undefined, where: string): Map<number, AINoteEvent[]> {
    const out = new Map<number, AINoteEvent[]>();
    for (let bank = 0; bank < SAMPLER_BANKS; bank++) {
      const steps = stepsOf(banks?.[bank]);
      const bankWhere = `${where} bank ${bank}`;
      this.checkOverflow(steps, bankWhere);
      const events: AINoteEvent[] = [];
      const kept: Note[] = [];
      for (let step = 0; step < Math.min(steps.length, this.steps); step++) {
        const n = steps[step];
        if (!n) continue;
        const event = this.noteEvent(step, n, bankWhere);
        if (!event) continue;
        kept.push(n);
        events.push(event);
      }
      this.checkFields(kept, SAMPLER_NOTE_FIELDS, bankWhere);
      if (events.length > 0) out.set(bank, events);
    }
    return out;
  }
}

/** AI track params of a synth part: what differs from the import defaults. */
function synthParamsOut(params: Partial<SynthParams> | undefined): Partial<SynthParams> | undefined {
  if (!params) return undefined;
  const diff = diffFrom(params as SynthParams, AI_SONG_DEFAULT_SYNTH);
  return Object.keys(diff).length > 0 ? diff : undefined;
}

/** BASS 2 knobs the AI format can set, as `SynthParams` names. */
function bass2ParamsOut(b: Bass2Params | undefined, ex: Exporter, where: string): Partial<SynthParams> | undefined {
  if (!b) return undefined;
  const lost: string[] = [];
  if (b.accent !== AI_SONG_BASS2_FIXED.accent) lost.push(`accent ${b.accent}`);
  if (b.envMod !== AI_SONG_BASS2_FIXED.envMod) lost.push(`envMod ${b.envMod}`);
  if (b.drive) lost.push(`drive ${b.drive}`);
  if (b.pan) lost.push(`pan ${b.pan}`);
  if (b.slideTime !== undefined) lost.push(`slideTime ${b.slideTime}`);
  if (b.model303 !== undefined && b.model303 !== 'stock-open303') lost.push(`model303 ${b.model303}`);
  if (b.engine303 !== undefined && b.engine303 !== 'open303') lost.push(`engine303 ${b.engine303}`);
  if (b.model303Extra !== undefined) lost.push('model303Extra');
  if (lost.length > 0) ex.lose(where, `BASS 2 knobs the AI format cannot set: ${lost.join(', ')}`);
  const synth: Partial<SynthParams> = {
    waveform: b.waveform,
    pitch: b.pitch,
    filterCutoff: b.cutoff,
    filterResonance: b.resonance,
    filterMode: b.filterMode,
    decay: b.decay,
    volume: b.volume,
  };
  return synthParamsOut(synth);
}

/** What `params[track]` / a slot snapshot of `track` exports as. */
function trackParamsOut(
  track: 'synthA' | 'synthB' | 'bass2',
  params: Partial<SynthParams> | Partial<Bass2Params> | undefined,
  ex: Exporter,
  where: string,
): Partial<SynthParams> | undefined {
  return track === 'bass2'
    ? bass2ParamsOut(params as Bass2Params | undefined, ex, where)
    : synthParamsOut(params as Partial<SynthParams> | undefined);
}

/** `sampleName` back to the `ttsText` / `sampleUrl` the importer read it from. */
function samplerSource(bank: number, sampleName: string | undefined): Pick<AISamplerBankData, 'ttsText' | 'sampleUrl'> {
  if (!sampleName || sampleName === AI_SONG_DEFAULT_SAMPLER_BANK.sampleName || sampleName === `bank_${bank}`) return {};
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(sampleName) ? { sampleUrl: sampleName } : { ttsText: sampleName };
}

/** Bank voice settings that differ from the import defaults (`sampleName` travels as tts / url). */
function samplerParamsOut(params: SamplerBankParams | undefined): Partial<SamplerBankParams> | undefined {
  if (!params) return undefined;
  const rest: Partial<SamplerBankParams> = { ...params };
  delete rest.sampleName;
  const diff = diffFrom(rest, AI_SONG_DEFAULT_SAMPLER_BANK as Partial<SamplerBankParams>);
  return Object.keys(diff).length > 0 ? diff : undefined;
}

/** True when bank `bank` has anything the song must say even without notes. */
function samplerBankHasSettings(song: SavedSongData, bank: number): boolean {
  const params = song.params.sampler?.[bank];
  if (!params) return false;
  return samplerParamsOut(params) !== undefined || params.sampleName !== AI_SONG_DEFAULT_SAMPLER_BANK.sampleName;
}

function samplerEntry(song: SavedSongData, bank: number, steps: AINoteEvent[], withSettings: boolean): AISamplerBankData {
  const entry: AISamplerBankData = { bankIndex: bank, steps };
  if (!withSettings) return entry;
  const params = song.params.sampler?.[bank];
  Object.assign(entry, samplerSource(bank, params?.sampleName));
  const out = samplerParamsOut(params);
  if (out) entry.params = out;
  return entry;
}

/** A clip one Song Mode cell maps back to, and nothing more. */
function isGridClip(clip: ArrangementClip, spm: number): boolean {
  const aligned = clip.startStep % spm === 0 && clip.lengthSteps % spm === 0 && (clip.offsetSteps ?? 0) === 0;
  return aligned && (clip.loop || clip.lengthSteps === spm);
}

/** The song's measures (Song Mode rows), or [] for a song that plays one pattern. */
function songRows(song: SavedSongData, steps: number, ex: Exporter): SongStructure {
  const arrangement = normalizeArrangement(song.arrangement)
    ?? songStructureToArrangement((song.songStructure ?? []) as Array<Partial<Record<TrackKey, unknown>>>, steps);
  if (arrangement.clips.length === 0) return [];
  arrangement.clips.forEach((clip) => {
    const where = `arrangement ${clip.track} clip ${clip.id}`;
    if (!isGridClip(clip, steps)) ex.lose(where, 'trimmed, offset or one-shot clip — exported as the Song Mode measure it covers most of');
    if (clip.lanes?.length) ex.lose(where, 'clip automation lanes are not in the AI format');
  });
  return projectArrangement(arrangement, steps);
}

const AI_TARGETS = new Set<string>(Object.keys(VALID_PARAMETERS_BY_TARGET));

/** 0–1 lane points as 0–127 steps over `[from, from + steps)`. */
function laneStepsOf(lane: UnifiedAutomationLane, from: number, steps: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: steps }, () => null);
  for (const p of lane.points) {
    const local = p.step - from;
    if (Number.isInteger(local) && local >= 0 && local < steps) out[local] = Math.round(clamp(p.value, 0, 1) * 127);
  }
  return out;
}

/** Why `lane` cannot be exported at all, or null. */
function laneBlocker(lane: UnifiedAutomationLane): string | null {
  if (!lane.enabled) return 'disabled lane — not exported';
  if (!AI_TARGETS.has(lane.target)) return `target "${lane.target}" is not in the AI format`;
  const target = lane.target as AIAutomationTarget;
  if (!VALID_PARAMETERS_BY_TARGET[target].includes(lane.parameter as AITargetedParameter)) {
    return `${target}.${lane.parameter} is not in the AI format's parameter list`;
  }
  const gap = laneDispatchGap(lane.target, lane.parameter);
  if (gap) return `${target}.${lane.parameter} never plays (${gap}) — not exported`;
  if (lane.scope === 'pattern') return 'pattern-scoped lane (one pattern index) — the AI format has no such scope';
  if (lane.points.some((p) => !Number.isInteger(p.step))) return 'lane has points between steps — not exported';
  return null;
}

function aiLane(lane: UnifiedAutomationLane, steps: (number | null)[]): AIAutomationLane {
  return { target: lane.target as AIAutomationTarget, parameter: lane.parameter as AITargetedParameter, steps, interpolation: lane.interpolation };
}

interface ExportedLanes {
  songWide: AIAutomationLane[];
  /** Song-timeline lanes to try as pattern-local lanes (verified against the tiler). */
  timeline: UnifiedAutomationLane[];
}

function classifyLanes(song: SavedSongData, rows: SongStructure, steps: number, ex: Exporter): ExportedLanes {
  const songWide: AIAutomationLane[] = [];
  const timeline: UnifiedAutomationLane[] = [];
  (song.automationLanes ?? []).forEach((lane, i) => {
    const where = `automationLanes[${i}] ${lane.target}.${lane.parameter}`;
    const blocker = laneBlocker(lane);
    if (blocker) {
      ex.lose(where, blocker);
      return;
    }
    if (lane.timeline === 'song' && rows.length > 0) {
      timeline.push(lane);
      return;
    }
    // A pattern-step lane repeats every measure; outside Song Mode a song-timeline
    // lane plays its first measure.
    const values = laneStepsOf(lane, 0, steps);
    const past = lane.points.filter((p) => p.step >= steps).length;
    if (past > 0 && lane.timeline !== 'song') ex.lose(where, `${past} point${past === 1 ? '' : 's'} past step ${steps} never play — not exported`);
    if (values.some((v) => v !== null)) songWide.push(aiLane(lane, values));
  });
  return { songWide, timeline };
}

/**
 * Song-timeline lanes back to pattern-local lanes. A slot is a candidate when
 * every measure that plays it on the lane's track has a point on its first
 * step (the tiler always writes one there); its lane is the points of the
 * first such measure. The candidates are kept only when the importer's tiler
 * turns them back into the same points — and when a hold point the tiler wrote
 * between occurrences looks like an occurrence (a one-step pattern), without
 * the one candidate that breaks it.
 */
function untileLanes(
  candidate: AISongData,
  lanes: readonly UnifiedAutomationLane[],
  rows: SongStructure,
  steps: number,
  songWideKeys: ReadonlySet<string>,
  ex: Exporter,
): void {
  const patterns = candidate.patterns!;
  const taken = new Set<string>();
  for (const lane of lanes) {
    const key = `${lane.target}.${lane.parameter}`;
    const where = `automationLanes ${key} (song timeline)`;
    if (songWideKeys.has(key) || taken.has(key)) {
      ex.lose(where, `a second lane on ${key} — the AI format plays one per parameter, not exported`);
      continue;
    }
    const trackKey = AI_TRACK_TO_TRACK_KEY[lane.target as AISongTrackName];
    const starts = new Set(lane.points.map((p) => p.step));
    const measuresOf = new Map<number, number[]>();
    rows.forEach((row, m) => {
      const slot = row[trackKey];
      if (slot !== null && slot !== undefined) measuresOf.set(slot, [...(measuresOf.get(slot) ?? []), m]);
    });
    const candidates = [...measuresOf]
      .filter(([, measures]) => measures.every((m) => starts.has(m * steps)))
      .map(([slot, measures]) => ({ id: slotPatternId(slot), lane: aiLane(lane, laneStepsOf(lane, measures[0] * steps, steps)) }));

    const want = [...lane.points].sort((a, b) => a.step - b.step);
    const attach = (set: typeof candidates) => set.forEach(({ id, lane: ai }) => (patterns[id].automation ??= []).push(ai));
    const detach = (set: typeof candidates) => set.forEach(({ id, lane: ai }) => {
      const list = patterns[id].automation!;
      list.splice(list.indexOf(ai), 1);
      if (list.length === 0) delete patterns[id].automation;
    });
    const tilesBack = (set: typeof candidates): boolean => {
      attach(set);
      const tiled = tilePatternAutomation(resolveSongBlock(candidate)).lanes.find((l) => `${l.target}.${l.parameter}` === key);
      const same = !!tiled && tiled.interpolation === lane.interpolation && tiled.points.length === want.length
        && tiled.points.every((p, i) => p.step === want[i].step && Math.abs(p.value - want[i].value) <= 0.5 / 127 + 1e-9);
      if (!same) detach(set);
      return same;
    };
    if (candidates.length > 0 && (tilesBack(candidates) || candidates.some((_, i) => tilesBack(candidates.filter((__, j) => j !== i))))) {
      taken.add(key);
      continue;
    }
    ex.lose(where, 'changes from measure to measure in a way per-pattern lanes cannot repeat — not exported');
  }
}

function defaultMeta(meta: Partial<AISongData['meta']> | undefined, version: AISongData['meta']['version']): AISongData['meta'] {
  return {
    title: 'Hyphon song',
    author: 'Hyphon',
    createdAt: new Date().toISOString(),
    generator: 'hyphon-export',
    prompt: 'Exported from the song open in Hyphon.',
    ...meta,
    version,
  };
}

/** Losses that do not depend on the tracks: song-level features the format lacks. */
function songLevelLosses(song: SavedSongData, ex: Exporter): void {
  if (song.noteFx && Object.keys(song.noteFx).length > 0) ex.lose('noteFx', 'note FX chains (arp / ratchet / chord / euclid / humanize) are not in the AI format');
  if (song.trackLengths && Object.keys(song.trackLengths).length > 0) ex.lose('trackLengths', 'per-track loop lengths (polyrhythm) are not in the AI format');
  for (const drum of DRUMS) {
    const params = song.params[drum];
    if (params && !deepEqual(params, AI_SONG_DRUM_PARAMS[drum])) {
      ex.lose(`params.${drum}`, 'drum knobs are not in the AI format (get_song reports them as knobs)');
    }
  }
  if (song.pcfFilter?.enabled) ex.lose('pcfFilter', 'the .rbs PCF filter is not in the AI format');
  if (song.wam2?.plugins?.length) ex.lose('wam2', 'WAM2 plugin slots are not in the AI format');
  if (song.rbsTrakEvents?.length) ex.lose('rbsTrakEvents', '.rbs TRAK events are not in the AI format');
}

/** Non-empty pattern slots no exported measure plays. */
function unplayedSlotLosses(song: SavedSongData, exported: Record<TrackKey, Set<number>>, ex: Exporter): void {
  const storage = song.trackStorage as Partial<Record<TrackKey, (PartSequence | PartSequence[] | null)[]>>;
  for (const key of TRACK_KEYS) {
    (storage[key] ?? []).forEach((seq, slot) => {
      if (!seq || exported[key].has(slot)) return;
      const seqs = Array.isArray(seq) ? seq : [seq];
      if (seqs.some((s) => s?.steps?.some(Boolean))) {
        ex.lose(`${key} slot ${slot}`, 'pattern slot the song never plays — not exported (edit_pattern can still address it)');
      }
    });
  }
}

/** One pattern's tracks: every track in `which` gets its slot content. */
function patternTracks(
  ex: Exporter,
  song: SavedSongData,
  content: (key: TrackKey) => PartSequence | PartSequence[] | null | undefined,
  which: ReadonlySet<AISongTrackName>,
  label: string,
  samplerSettings: boolean,
): AISongTracks {
  const tracks: AISongTracks = {};
  for (const name of AI_SONG_TRACK_NAMES) {
    if (!which.has(name)) continue;
    const key = AI_TRACK_TO_TRACK_KEY[name];
    const where = `${key} ${label}`;
    if (MELODIC.has(name)) {
      tracks[name as 'synthA' | 'synthB' | 'bass2'] = { notes: ex.melodicTrack(content(key) as PartSequence | null, where) };
    } else if (name === 'sampler') {
      const raw = content('sampler');
      const banks = ex.samplerBanks(Array.isArray(raw) ? raw : null, where);
      const entries: AISamplerBankData[] = [];
      for (let bank = 0; bank < SAMPLER_BANKS; bank++) {
        const notes = banks.get(bank);
        const settings = samplerSettings && samplerBankHasSettings(song, bank);
        if (notes || settings) entries.push(samplerEntry(song, bank, notes ?? [], samplerSettings));
      }
      tracks.sampler = entries;
    } else {
      tracks[name as (typeof DRUMS)[number]] = ex.drumTrack(content(key) as PartSequence | null, where);
    }
  }
  return tracks;
}

/** Drop tracks that say nothing (no notes, no hits, no params) from a single-pattern song. */
function pruneEmpty(tracks: AISongTracks): AISongTracks {
  const out: AISongTracks = {};
  for (const [name, value] of Object.entries(tracks) as [AISongTrackName, unknown][]) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'boolean') {
      if ((value as boolean[]).some(Boolean)) Object.assign(out, { [name]: value });
    } else if (name === 'sampler') {
      if ((value as AISamplerBankData[]).length > 0) out.sampler = value as AISamplerBankData[];
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const t = value as AITrackData;
      if (t.notes.length > 0 || t.params) Object.assign(out, { [name]: t });
    }
  }
  return out;
}

/**
 * Write `song` as an AI song. v1.0 when it plays one 32-step pattern, else
 * v1.1: `tracks` for a single measure every track plays from slot 0,
 * `patterns` + `song` otherwise.
 */
export function exportAISong(song: SavedSongData, options: AISongExportOptions = {}): AISongExport {
  const meter = resolveSongMeter(song);
  const steps = meter.stepCount;
  const ex = new Exporter(steps);
  const rows = songRows(song, steps, ex);
  songLevelLosses(song, ex);

  const globals: AISongData['globals'] = { tempo: clamp(song.tempo, 30, 300) };
  if (globals.tempo !== song.tempo) ex.lose('tempo', `tempo ${song.tempo} clamped to 30–300 BPM`);
  // The song's own signature when the importer takes it back, else the meter's.
  const ts = isImportableTimeSignature(song.timeSignature) ? song.timeSignature : meter.timeSignature;
  if (ts[0] !== 4 || ts[1] !== 4) globals.timeSignature = [ts[0], ts[1]];
  if (meter.swing !== 50) globals.swing = meter.swing;

  const storage = song.trackStorage as Partial<Record<TrackKey, (PartSequence | PartSequence[] | null)[]>>;
  const slotContent = (slot: number) => (key: TrackKey) => storage[key]?.[slot] ?? null;
  const exportedSlots = Object.fromEntries(TRACK_KEYS.map((k) => [k, new Set<number>()])) as Record<TrackKey, Set<number>>;
  const all = new Set<AISongTrackName>(AI_SONG_TRACK_NAMES);

  const lanes = classifyLanes(song, rows, steps, ex);
  const withParams = (tracks: AISongTracks, params: (name: 'synthA' | 'synthB' | 'bass2') => Partial<SynthParams> | undefined) => {
    for (const name of ['synthA', 'synthB', 'bass2'] as const) {
      const p = params(name);
      if (!p) continue;
      tracks[name] = { notes: tracks[name]?.notes ?? [], params: p };
    }
    return tracks;
  };
  const songParams = (name: 'synthA' | 'synthB' | 'bass2') =>
    trackParamsOut(name, song.params[name], ex, `params.${name}`);

  const singleSlot0 = rows.length === 1 && TRACK_KEYS.every((k) => rows[0][k] === 0);
  let out: AISongData;
  if (rows.length === 0 || singleSlot0) {
    // One pattern: the live pattern in pattern mode, slot 0 for a one-measure song.
    const active = song.activeTrackSlots ?? {};
    const live = (key: TrackKey) => (rows.length === 0 ? song.pattern[key] : storage[key]?.[0] ?? song.pattern[key]);
    for (const key of TRACK_KEYS) exportedSlots[key].add(rows.length === 0 ? active[key] ?? 0 : 0);
    const tracks = pruneEmpty(withParams(patternTracks(ex, song, live, all, rows.length === 0 ? 'pattern' : 'slot 0', true), songParams));
    const v10 = rows.length === 0 && steps === 32;
    out = {
      meta: defaultMeta(options.meta, v10 ? '1.0' : '1.1'),
      globals: v10 ? globals : { ...globals, stepCount: steps },
      tracks,
    };
    if (lanes.songWide.length > 0) out.automation = lanes.songWide;
  } else {
    out = exportSongBlock(song, rows, steps, globals, options, ex, exportedSlots, slotContent, lanes);
  }
  unplayedSlotLosses(song, exportedSlots, ex);
  return { song: out, losses: ex.losses };
}

function exportSongBlock(
  song: SavedSongData,
  rows: SongStructure,
  steps: number,
  globals: AISongData['globals'],
  options: AISongExportOptions,
  ex: Exporter,
  exportedSlots: Record<TrackKey, Set<number>>,
  slotContent: (slot: number) => (key: TrackKey) => PartSequence | PartSequence[] | null | undefined,
  lanes: ExportedLanes,
): AISongData {
  // Per track, the slots it plays in first-seen order (the importer's slot order).
  const firstSeen = Object.fromEntries(AI_SONG_TRACK_NAMES.map((n) => [n, [] as number[]])) as Record<AISongTrackName, number[]>;
  const songOut: AISongRow[] = rows.map((row) => {
    const out: AISongRow = {};
    for (const name of AI_SONG_TRACK_NAMES) {
      const slot = row[AI_TRACK_TO_TRACK_KEY[name]];
      if (slot === null || slot === undefined) continue;
      out[name] = slotPatternId(slot);
      if (!firstSeen[name].includes(slot)) firstSeen[name].push(slot);
    }
    return out;
  });

  const slots = [...new Set(AI_SONG_TRACK_NAMES.flatMap((n) => firstSeen[n]))].sort((a, b) => a - b);
  const firstSampler = firstSeen.sampler[0];
  const patterns: Record<string, AIPatternData> = {};
  for (const slot of slots) {
    const which = new Set(AI_SONG_TRACK_NAMES.filter((n) => firstSeen[n].includes(slot)));
    for (const name of which) exportedSlots[AI_TRACK_TO_TRACK_KEY[name]].add(slot);
    const tracks = patternTracks(ex, song, slotContent(slot), which, `slot ${slot}`, slot === firstSampler);
    for (const name of ['synthA', 'synthB', 'bass2'] as const) {
      if (!which.has(name)) continue;
      const params = slotParams(song, name, slot, firstSeen[name], ex);
      if (params) tracks[name] = { ...tracks[name]!, params };
    }
    patterns[slotPatternId(slot)] = { tracks };
  }

  // A track's song params live on the first pattern it plays; a track the song
  // never plays cannot carry them.
  for (const name of ['synthA', 'synthB', 'bass2'] as const) {
    if (firstSeen[name].length === 0 && trackParamsOut(name, song.params[name], ex, `params.${name}`)) {
      ex.lose(`params.${name}`, `${name} knobs: the song never plays ${name}, so no pattern can carry them`);
    }
  }
  if (firstSeen.sampler.length === 0 && [...Array(SAMPLER_BANKS).keys()].some((b) => samplerBankHasSettings(song, b))) {
    ex.lose('params.sampler', 'sampler bank settings: the song never plays the sampler, so no pattern can carry them');
  }

  const out: AISongData = {
    meta: defaultMeta(options.meta, '1.1'),
    globals: { ...globals, stepCount: steps },
    patterns,
    song: songOut,
  };
  if (lanes.songWide.length > 0) out.automation = lanes.songWide;
  const songWideKeys = new Set(lanes.songWide.map((l) => `${l.target}.${l.parameter}`));
  untileLanes(out, lanes.timeline, rows, steps, songWideKeys, ex);
  return out;
}

/**
 * Params of `track` on pattern `slot`: the song params on the first slot it
 * plays, and a slot snapshot (`trackParamStorage`) that differs from them on
 * the others — what `buildTrackParamStorage` reads back.
 */
function slotParams(
  song: SavedSongData,
  track: 'synthA' | 'synthB' | 'bass2',
  slot: number,
  order: readonly number[],
  ex: Exporter,
): Partial<SynthParams> | undefined {
  const base = song.params[track];
  if (slot === order[0]) return trackParamsOut(track, base, ex, `params.${track}`);
  const snapshot = song.trackParamStorage?.[track]?.[slot];
  if (!snapshot) return undefined;
  const merged = { ...base, ...snapshot } as Partial<SynthParams> | Partial<Bass2Params>;
  if (deepEqual(merged, base)) return undefined;
  // A snapshot equal to the import defaults is `params: {}`: present, so the
  // importer reads the defaults instead of falling back to the song params.
  return trackParamsOut(track, merged, ex, `${track} slot ${slot} params`) ?? {};
}
