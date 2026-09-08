// @mode: typescript
// Pattern-fill and truncation bookkeeping for XM export.
//
// Extracted from xmExport.ts so this logic can be unit-tested without pulling in
// the WASM module, OfflineAudioContext, or the DOM download path.

import { noteNameToValue } from './xm_save_lib/index';
import type { XMPattern } from './xm_save_lib/index';
import type { PartSequence, TrackKey } from '../types';

/** Rows per exported XM pattern. Sequences longer than this are truncated. */
export const XM_PATTERN_ROWS = 32;

/**
 * Channels in the exported module.
 *
 * 0-5 instrument tracks, 6-13 the eight sampler banks, 14 bass2, 15 spare.
 * XM itself allows 2-32 (see XMWriter.write), so there is headroom left.
 */
export const XM_CHANNEL_COUNT = 16;

/** First channel of the eight contiguous sampler-bank channels. */
export const XM_SAMPLER_BASE_CHANNEL = 6;
/** First instrument index of the eight contiguous sampler-bank instruments. */
export const XM_SAMPLER_BASE_INSTRUMENT = 7;
/** Number of sampler banks the exporter allocates a channel/instrument for. */
export const XM_SAMPLER_BANK_COUNT = 8;

/**
 * Channel and instrument assignment for every non-sampler track.
 *
 * bass2 takes instrument 15 (appended after the sampler banks) rather than a
 * slot next to partB, so that adding it does not renumber the drum and sampler
 * instruments in previously exported modules.
 */
export const XM_TRACK_MAP: Record<Exclude<TrackKey, 'sampler'>, { inst: number; chan: number }> = {
    partA: { inst: 1, chan: 0 },
    partB: { inst: 2, chan: 1 },
    kick: { inst: 3, chan: 2 },
    snare: { inst: 4, chan: 3 },
    closedHat: { inst: 5, chan: 4 },
    openHat: { inst: 6, chan: 5 },
    bass2: { inst: 15, chan: 14 },
};

/** Human-readable track names used in truncation warnings. */
export const XM_TRACK_LABELS: Record<TrackKey, string> = {
    partA: 'Synth A',
    partB: 'Synth B',
    bass2: 'Bass 2',
    kick: 'Kick',
    snare: 'Snare',
    closedHat: 'Closed Hat',
    openHat: 'Open Hat',
    sampler: 'Sampler',
};

/** XM note value for C-4, used for the unpitched drum tracks. */
const DRUM_NOTE_C4 = 49;

/**
 * Maximum value of the XM volume column (0-64). XMWriter.packNote offsets this
 * by 0x10 to produce the 0x10-0x50 byte range the format defines.
 */
export const XM_MAX_VOLUME = 64;

/** Volume written for a note that carries no usable velocity. */
export const XM_DEFAULT_VOLUME = 64;

/**
 * Map a Note velocity (0-1) onto the XM volume column (0-64).
 * Anything missing or non-finite keeps the full-volume default.
 */
export const velocityToXmVolume = (velocity: number | undefined): number => {
    if (typeof velocity !== 'number' || !Number.isFinite(velocity)) return XM_DEFAULT_VOLUME;
    const scaled = Math.round(velocity * XM_MAX_VOLUME);
    return Math.max(0, Math.min(XM_MAX_VOLUME, scaled));
};

/** A track whose steps ran past the exported pattern's last row. */
export interface XmRowOverflow {
    patternIndex: number;
    trackName: string;
    /** Rows the source sequence has beyond XM_PATTERN_ROWS. */
    rowCount: number;
    /** Notes actually lost in those rows. */
    noteCount: number;
}

/** A track whose assigned channel fell outside the exported channel budget. */
export interface XmChannelOverflow {
    patternIndex: number;
    trackName: string;
    /** The channel index that did not fit. */
    channel: number;
    /** Notes lost because the channel does not exist. */
    noteCount: number;
}

/** Everything the export had to drop to fit the XM format limits. */
export interface XmTruncationReport {
    rowOverflows: XmRowOverflow[];
    channelOverflows: XmChannelOverflow[];
}

export const createTruncationReport = (): XmTruncationReport => ({
    rowOverflows: [],
    channelOverflows: [],
});

export const hasTruncation = (report: XmTruncationReport): boolean =>
    report.rowOverflows.length > 0 || report.channelOverflows.length > 0;

const uniqueSorted = (values: string[]): string[] => [...new Set(values)].sort();

const listNames = (names: string[]): string => {
    if (names.length <= 2) return names.join(' and ');
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

/**
 * Render a truncation report as a single plain-language sentence naming what was
 * lost. Returns null when nothing was dropped.
 */
export const formatTruncationMessage = (report: XmTruncationReport): string | null => {
    if (!hasTruncation(report)) return null;

    const parts: string[] = [];

    if (report.rowOverflows.length > 0) {
        const notes = report.rowOverflows.reduce((sum, o) => sum + o.noteCount, 0);
        const rows = Math.max(...report.rowOverflows.map(o => o.rowCount));
        const patterns = uniqueSorted(report.rowOverflows.map(o => String(o.patternIndex)));
        const names = uniqueSorted(report.rowOverflows.map(o => o.trackName));
        parts.push(
            `${notes} note${notes === 1 ? '' : 's'} past row ${XM_PATTERN_ROWS} ` +
            `(up to ${rows} extra row${rows === 1 ? '' : 's'}) ` +
            `dropped from ${listNames(names)} in pattern${patterns.length === 1 ? '' : 's'} ${patterns.join(', ')}`
        );
    }

    if (report.channelOverflows.length > 0) {
        const notes = report.channelOverflows.reduce((sum, o) => sum + o.noteCount, 0);
        const channels = uniqueSorted(report.channelOverflows.map(o => String(o.channel)));
        const patterns = uniqueSorted(report.channelOverflows.map(o => String(o.patternIndex)));
        const names = uniqueSorted(report.channelOverflows.map(o => o.trackName));
        parts.push(
            `${notes} note${notes === 1 ? '' : 's'} dropped from ${listNames(names)} ` +
            `in pattern${patterns.length === 1 ? '' : 's'} ${patterns.join(', ')} ` +
            `because channel${channels.length === 1 ? '' : 's'} ${channels.join(', ')} ` +
            `exceed the ${XM_CHANNEL_COUNT}-channel limit`
        );
    }

    return `XM export truncated: ${parts.join('; ')}. The rest of the song exported normally.`;
};

/** Resolve the channel/instrument pair a track and bank writes to. */
export const resolveTrackSlot = (trackKey: TrackKey, bankIdx: number = 0): { inst: number; chan: number } => {
    if (trackKey === 'sampler') {
        return {
            inst: XM_SAMPLER_BASE_INSTRUMENT + bankIdx,
            chan: XM_SAMPLER_BASE_CHANNEL + bankIdx,
        };
    }
    return XM_TRACK_MAP[trackKey];
};

/** Tracks that carry a real pitch rather than a fixed drum trigger. */
const isPitchedTrack = (trackKey: TrackKey): boolean =>
    trackKey === 'partA' || trackKey === 'partB' || trackKey === 'bass2' || trackKey === 'sampler';

/**
 * Write one sequence into an XM pattern, recording anything the format cannot
 * hold into `report` instead of dropping it silently.
 */
export const fillPatternFromSequence = (
    xmPat: XMPattern,
    sequence: PartSequence,
    trackKey: TrackKey,
    bankIdx: number,
    patternIndex: number,
    report: XmTruncationReport,
): void => {
    const { inst, chan } = resolveTrackSlot(trackKey, bankIdx);
    const trackName = trackKey === 'sampler'
        ? `Sampler Bank ${bankIdx + 1}`
        : XM_TRACK_LABELS[trackKey];

    const steps = sequence.steps;

    // Whole track does not fit in the channel budget: nothing of it survives.
    if (chan >= XM_CHANNEL_COUNT) {
        const noteCount = steps.reduce<number>((sum, step) => sum + (step ? 1 : 0), 0);
        if (noteCount > 0) {
            report.channelOverflows.push({ patternIndex, trackName, channel: chan, noteCount });
        }
        return;
    }

    let droppedNotes = 0;

    steps.forEach((stepData, row) => {
        if (!stepData) return;

        if (row >= XM_PATTERN_ROWS) {
            droppedNotes++;
            return;
        }

        const note = xmPat.data[row][chan];
        note.note = isPitchedTrack(trackKey) ? noteNameToValue(stepData.note) : DRUM_NOTE_C4;
        note.instrument = inst;
        note.volume = velocityToXmVolume(stepData.velocity);
    });

    if (droppedNotes > 0) {
        report.rowOverflows.push({
            patternIndex,
            trackName,
            rowCount: steps.length - XM_PATTERN_ROWS,
            noteCount: droppedNotes,
        });
    }
};
