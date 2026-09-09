import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPattern, XMWriter, createModule, createInstrument, createSample, addSampleToInstrument, noteNameToValue } from '../utils/xm_save_lib/index';
import {
    XM_PATTERN_ROWS,
    XM_CHANNEL_COUNT,
    XM_TRACK_MAP,
    createTruncationReport,
    fillPatternFromSequence,
    formatTruncationMessage,
    hasTruncation,
    velocityToXmVolume,
    resolveTrackSlot,
} from '../utils/xmPatternFill';
import type { Note, PartSequence } from '../types';

const emptySteps = (n: number): (Note | null)[] => Array(n).fill(null) as (Note | null)[];

const seq = (steps: (Note | null)[]): PartSequence => ({ steps });

afterEach(() => {
    vi.restoreAllMocks();
});

describe('XM export truncation reporting (gap 15)', () => {
    it('reports rows past the pattern limit, naming the pattern, rows and track', () => {
        const report = createTruncationReport();
        const xmPat = createPattern(XM_PATTERN_ROWS, XM_CHANNEL_COUNT);

        // 40 steps: rows 32..39 cannot fit in a 32-row XM pattern.
        const steps = emptySteps(40);
        steps[0] = { note: 'C4', velocity: 1 };
        steps[32] = { note: 'D4', velocity: 1 };
        steps[35] = { note: 'E4', velocity: 1 };
        steps[39] = { note: 'F4', velocity: 1 };

        fillPatternFromSequence(xmPat, seq(steps), 'partA', 0, 3, report);

        expect(hasTruncation(report)).toBe(true);
        expect(report.rowOverflows).toEqual([
            { patternIndex: 3, trackName: 'Synth A', rowCount: 8, noteCount: 3 },
        ]);
        expect(report.channelOverflows).toEqual([]);

        // The in-range note still made it through.
        expect(xmPat.data[0][XM_TRACK_MAP.partA.chan].note).toBe(noteNameToValue('C4'));

        const message = formatTruncationMessage(report)!;
        expect(message).toContain('3 notes');
        expect(message).toContain('row 32');
        expect(message).toContain('8 extra rows');
        expect(message).toContain('Synth A');
        expect(message).toContain('pattern 3');
    });

    it('reports a whole track dropped when its channel is outside the budget', () => {
        const report = createTruncationReport();
        const xmPat = createPattern(XM_PATTERN_ROWS, XM_CHANNEL_COUNT);

        // Sampler bank 11 lands on channel 6 + 11 = 17, past the 16-channel budget.
        const outOfBudgetBank = XM_CHANNEL_COUNT - 6 + 5;
        expect(resolveTrackSlot('sampler', outOfBudgetBank).chan).toBeGreaterThanOrEqual(XM_CHANNEL_COUNT);

        const steps = emptySteps(XM_PATTERN_ROWS);
        steps[0] = { note: 'C4', velocity: 1 };
        steps[8] = { note: 'G4', velocity: 1 };

        fillPatternFromSequence(xmPat, seq(steps), 'sampler', outOfBudgetBank, 1, report);

        expect(report.channelOverflows).toEqual([
            {
                patternIndex: 1,
                trackName: `Sampler Bank ${outOfBudgetBank + 1}`,
                channel: 6 + outOfBudgetBank,
                noteCount: 2,
            },
        ]);

        const message = formatTruncationMessage(report)!;
        expect(message).toContain('2 notes');
        expect(message).toContain(`Sampler Bank ${outOfBudgetBank + 1}`);
        expect(message).toContain(`${XM_CHANNEL_COUNT}-channel limit`);
    });

    it('does not warn and does not truncate for a song that fits', () => {
        const report = createTruncationReport();
        const xmPat = createPattern(XM_PATTERN_ROWS, XM_CHANNEL_COUNT);

        const steps = emptySteps(XM_PATTERN_ROWS);
        steps[0] = { note: 'C4', velocity: 1 };
        steps[31] = { note: 'C5', velocity: 1 };

        fillPatternFromSequence(xmPat, seq(steps), 'partB', 0, 0, report);

        expect(hasTruncation(report)).toBe(false);
        expect(formatTruncationMessage(report)).toBeNull();
    });

    it('fires console.warn naming what was lost, and still writes a valid module', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const report = createTruncationReport();
        const xmPat = createPattern(XM_PATTERN_ROWS, XM_CHANNEL_COUNT);

        const steps = emptySteps(48);
        steps[40] = { note: 'A4', velocity: 1 };
        fillPatternFromSequence(xmPat, seq(steps), 'bass2', 0, 0, report);

        // Mirrors the console.warn call in exportSongToXM.
        const message = formatTruncationMessage(report);
        expect(message).not.toBeNull();
        console.warn('[xmExport]', message, report);

        expect(warn).toHaveBeenCalledTimes(1);
        const logged = String(warn.mock.calls[0][1]);
        expect(logged).toContain('Bass 2');
        expect(logged).toContain('row 32');
        expect(logged).toContain('1 note ');

        // Export is never failed by truncation: the module still serialises.
        const mod = createModule({ numberOfChannels: XM_CHANNEL_COUNT, defaultBPM: 120 });
        mod.patterns.push(xmPat);
        mod.header.numberOfPatterns = 1;
        mod.header.songLength = 1;
        expect(() => new XMWriter().write(mod)).not.toThrow();

        warn.mockRestore();
    });
});

describe('XM volume column from Note velocity (gap 12)', () => {
    it('maps 0-1 velocity onto the 0-64 XM volume column', () => {
        expect(velocityToXmVolume(0)).toBe(0);
        expect(velocityToXmVolume(0.5)).toBe(32);
        expect(velocityToXmVolume(1)).toBe(64);
        expect(velocityToXmVolume(0.8)).toBe(51);
    });

    it('clamps out-of-range velocity and defaults when it is missing', () => {
        expect(velocityToXmVolume(-1)).toBe(0);
        expect(velocityToXmVolume(2)).toBe(64);
        expect(velocityToXmVolume(undefined)).toBe(64);
        expect(velocityToXmVolume(NaN)).toBe(64);
    });

    it('writes per-step velocity into the pattern instead of a fixed 64', () => {
        const report = createTruncationReport();
        const xmPat = createPattern(XM_PATTERN_ROWS, XM_CHANNEL_COUNT);

        const steps = emptySteps(XM_PATTERN_ROWS);
        steps[0] = { note: 'C4', velocity: 1 };
        steps[4] = { note: 'C4', velocity: 0.5 };
        steps[8] = { note: 'C4', velocity: 0 };

        fillPatternFromSequence(xmPat, seq(steps), 'partA', 0, 0, report);

        const chan = XM_TRACK_MAP.partA.chan;
        expect(xmPat.data[0][chan].volume).toBe(64);
        expect(xmPat.data[4][chan].volume).toBe(32);
        expect(xmPat.data[8][chan].volume).toBe(0);
    });

    it('round-trips velocity through the writer as XM volume bytes 0x10-0x50', () => {
        const report = createTruncationReport();
        const xmPat = createPattern(XM_PATTERN_ROWS, XM_CHANNEL_COUNT);

        const steps = emptySteps(XM_PATTERN_ROWS);
        steps[0] = { note: 'C4', velocity: 1 };
        steps[1] = { note: 'C4', velocity: 0.5 };
        steps[2] = { note: 'C4', velocity: 0 };

        fillPatternFromSequence(xmPat, seq(steps), 'partA', 0, 0, report);

        const mod = createModule({ numberOfChannels: XM_CHANNEL_COUNT, defaultBPM: 120 });
        mod.patterns.push(xmPat);
        mod.header.numberOfPatterns = 1;
        mod.header.songLength = 1;

        const inst = createInstrument('Lead');
        addSampleToInstrument(inst, createSample({ name: 'Lead', data: new Int16Array(16) }));
        mod.instruments.push(inst);
        mod.header.numberOfInstruments = 1;

        const bytes = new Uint8Array(new XMWriter().write(mod));

        // Packed note: flags 0x80|note|instrument|volume = 0x87, then note,
        // instrument, volume byte. Row 0 channel 0 is the first packed entry of
        // the pattern data, so find that triple for each of the three rows.
        const expectVolumeByte = (vol: number) => {
            const note = noteNameToValue('C4');
            for (let i = 0; i < bytes.length - 3; i++) {
                if (bytes[i] === 0x87 && bytes[i + 1] === note && bytes[i + 2] === XM_TRACK_MAP.partA.inst && bytes[i + 3] === vol + 0x10) {
                    return true;
                }
            }
            return false;
        };

        expect(expectVolumeByte(64)).toBe(true); // 0x50
        expect(expectVolumeByte(32)).toBe(true); // 0x30
        // Volume 0 packs as 0x10, which is still a real "set volume 0" command.
        expect(expectVolumeByte(0)).toBe(true);
    });
});

describe('bass2 XM channel (gap 14)', () => {
    it('allocates bass2 a channel and instrument inside the budget', () => {
        expect(XM_TRACK_MAP.bass2.chan).toBe(14);
        expect(XM_TRACK_MAP.bass2.chan).toBeLessThan(XM_CHANNEL_COUNT);
        expect(XM_TRACK_MAP.bass2.inst).toBe(15);
    });

    it('does not collide with any other track or sampler bank channel', () => {
        const channels = [
            ...Object.values(XM_TRACK_MAP).map(v => v.chan),
            ...Array.from({ length: 8 }, (_, i) => resolveTrackSlot('sampler', i).chan),
        ];
        expect(new Set(channels).size).toBe(channels.length);
        expect(Math.max(...channels)).toBeLessThan(XM_CHANNEL_COUNT);

        const instruments = [
            ...Object.values(XM_TRACK_MAP).map(v => v.inst),
            ...Array.from({ length: 8 }, (_, i) => resolveTrackSlot('sampler', i).inst),
        ];
        expect(new Set(instruments).size).toBe(instruments.length);
    });

    it('produces a bass2 channel containing the pattern notes, pitched not fixed', () => {
        const report = createTruncationReport();
        const xmPat = createPattern(XM_PATTERN_ROWS, XM_CHANNEL_COUNT);

        const steps = emptySteps(XM_PATTERN_ROWS);
        steps[2] = { note: 'G2', velocity: 0.9 };
        steps[6] = { note: 'A2', velocity: 0.7 };
        steps[14] = { note: 'C3', velocity: 1 };

        fillPatternFromSequence(xmPat, seq(steps), 'bass2', 0, 0, report);

        const chan = XM_TRACK_MAP.bass2.chan;
        expect(hasTruncation(report)).toBe(false);

        expect(xmPat.data[2][chan].note).toBe(noteNameToValue('G2'));
        expect(xmPat.data[2][chan].instrument).toBe(XM_TRACK_MAP.bass2.inst);
        expect(xmPat.data[2][chan].volume).toBe(velocityToXmVolume(0.9));

        expect(xmPat.data[6][chan].note).toBe(noteNameToValue('A2'));
        expect(xmPat.data[14][chan].note).toBe(noteNameToValue('C3'));

        // bass2 is pitched, so the three notes must differ from each other.
        expect(new Set([
            xmPat.data[2][chan].note,
            xmPat.data[6][chan].note,
            xmPat.data[14][chan].note,
        ]).size).toBe(3);

        // Empty rows on that channel stay empty.
        expect(xmPat.data[0][chan].note).toBe(0);
        expect(xmPat.data[0][chan].instrument).toBe(0);

        // partA/partB channels are untouched by a bass2-only pattern.
        expect(xmPat.data[2][XM_TRACK_MAP.partA.chan].instrument).toBe(0);
        expect(xmPat.data[2][XM_TRACK_MAP.partB.chan].instrument).toBe(0);
    });

    it('writes the bass2 channel into the serialised module', () => {
        const report = createTruncationReport();
        const xmPat = createPattern(XM_PATTERN_ROWS, XM_CHANNEL_COUNT);

        const steps = emptySteps(XM_PATTERN_ROWS);
        steps[0] = { note: 'G2', velocity: 1 };
        fillPatternFromSequence(xmPat, seq(steps), 'bass2', 0, 0, report);

        const mod = createModule({ numberOfChannels: XM_CHANNEL_COUNT, defaultBPM: 120 });
        mod.patterns.push(xmPat);
        mod.header.numberOfPatterns = 1;
        mod.header.songLength = 1;

        const bytes = new Uint8Array(new XMWriter().write(mod));
        const note = noteNameToValue('G2');

        let found = false;
        for (let i = 0; i < bytes.length - 3; i++) {
            if (bytes[i] === 0x87 && bytes[i + 1] === note && bytes[i + 2] === XM_TRACK_MAP.bass2.inst && bytes[i + 3] === 64 + 0x10) {
                found = true;
                break;
            }
        }
        expect(found).toBe(true);
    });
});
