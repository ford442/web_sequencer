import { describe, expect, it } from 'vitest';
import type { Tb303PatternA, Tb303Step } from '../../../../importers/rbs/types';
import {
  DEFAULT_PATTERN_SCRIPT_OPTIONS,
  patternParams,
  patternToScript,
  selectRbsPatterns,
  stepMidiNote,
} from '../rbsSource';
import { PARAM, serializeScriptForNative, type Voice303Event } from '../script';

const rest = (index: number): Tb303Step => ({ index, note: -1, octave: 3, accent: false, slide: false, tie: false });
const note = (index: number, n: number, extra: Partial<Tb303Step> = {}): Tb303Step => ({
  index, note: n, octave: 3, accent: false, slide: false, tie: false, ...extra,
});

function pattern(steps: Tb303Step[], extra: Partial<Tb303PatternA> = {}): Tb303PatternA {
  return { steps, cutoff: 127, resonance: 64, envMod: 0, decay: 127, accent: 32, waveform: 1, ...extra };
}

const OPTS = { ...DEFAULT_PATTERN_SCRIPT_OPTIONS, tempo: 150, loops: 1 }; // 150 BPM @ 44.1 kHz = 4410 frames per step

const kinds = (events: Voice303Event[], kind: Voice303Event['kind']) => events.filter((e) => e.kind === kind);

describe('stepMidiNote', () => {
  it('maps ReBirth octave 3 / note 0 to C3 = MIDI 48', () => {
    expect(stepMidiNote({ note: 0, octave: 3 })).toBe(48);
    expect(stepMidiNote({ note: 7, octave: 2 })).toBe(43);
  });
});

describe('patternParams', () => {
  it('knob mapping is byte / 127 for every voice', () => {
    const p = new Map(patternParams(pattern([note(0, 0)]), 'knob'));
    expect(p.get(PARAM.cutoff)).toBe(1);
    expect(p.get(PARAM.resonance)).toBeCloseTo(64 / 127, 12);
    expect(p.get(PARAM.waveform)).toBe(1);
    expect(p.get(PARAM.envMod)).toBe(0);
  });

  it('import mapping follows the importer / applyLead303Params, which sends no env mod or accent', () => {
    const p = new Map(patternParams(pattern([note(0, 0)], { cutoff: 0, resonance: 127, decay: 127, envMod: 127 }), 'import'));
    expect(p.get(PARAM.cutoff)).toBeCloseTo(100 / 8000, 9); // 100 * 2^(0/21.17) Hz
    expect(p.get(PARAM.resonance)).toBeCloseTo(1, 9); // 127 / 6.35 = 20 of 20
    expect(p.get(PARAM.decay)).toBe(1); // 2 s clamps to 1
    expect(p.get(PARAM.filterMode)).toBe(1); // env mod rides the filter-mode param
    expect(p.has(PARAM.envMod)).toBe(false);
    expect(p.has(PARAM.accent)).toBe(false);
  });
});

describe('patternToScript', () => {
  it('plays notes at their step with a noteOff after the gate, and nothing for rests', () => {
    const s = patternToScript(pattern([note(0, 0, { accent: true }), rest(1), note(2, 7)]), OPTS);
    const on = kinds(s.events, 'on');
    const off = kinds(s.events, 'off');
    expect(on).toEqual([
      { frame: 0, kind: 'on', note: 48, velocity: 127 },
      { frame: 8820, kind: 'on', note: 55, velocity: 90 },
    ]);
    expect(off.map((e) => e.frame)).toEqual([Math.round(0.6 * 4410), 8820 + Math.round(0.6 * 4410)]);
    expect(s.totalFrames).toBe(3 * 4410 + Math.round(OPTS.tailSeconds * 44100));
  });

  it('holds the previous note into a slide step: no noteOff before the slide noteOn', () => {
    const s = patternToScript(pattern([note(0, 0), note(1, 3, { slide: true }), rest(2)]), OPTS);
    const ordered = s.events.filter((e) => e.kind === 'on' || e.kind === 'off');
    expect(ordered.map((e) => `${e.kind}${'note' in e ? e.note : ''}@${e.frame}`)).toEqual([
      'on48@0',
      'on51@4410',
      `off51@${4410 + Math.round(0.6 * 4410)}`,
    ]);
  });

  it('stretches a note over its ties', () => {
    const s = patternToScript(pattern([note(0, 0), { ...rest(1), tie: true }, { ...rest(2), tie: true }, rest(3)]), OPTS);
    expect(kinds(s.events, 'on')).toHaveLength(1);
    expect(kinds(s.events, 'off')[0].frame).toBe(Math.round((2 + 0.6) * 4410));
  });

  it('puts a slide across the loop wrap and repeats loops', () => {
    const steps = [note(0, 0, { slide: true }), rest(1), rest(2), note(3, 5)];
    const s = patternToScript(pattern(steps), { ...OPTS, loops: 2 });
    expect(kinds(s.events, 'on')).toHaveLength(4);
    // step 3 of loop 0 slides into step 0 of loop 1: no noteOff for it
    expect(kinds(s.events, 'off').some((e) => 'note' in e && e.note === 53 && e.frame < 4 * 4410 + 4410)).toBe(false);
  });

  it('serializes to the text form the native renderer reads', () => {
    const text = serializeScriptForNative(patternToScript(pattern([note(0, 0)]), OPTS));
    expect(text.startsWith('sr 44100\nframes ')).toBe(true);
    expect(text).toContain('e 0 on 48 90');
    expect(text).toMatch(/e 2646 off 48\n/);
    expect(text).toMatch(/e 0 param 2 1\n/);
  });
});

describe('selectRbsPatterns', () => {
  it('prefers the most used slots, then the lowest slot, and honours an explicit list', () => {
    const steps = [note(0, 0)];
    const bank = [0, 1, 2].map(() => pattern(steps));
    const raw = {
      tb303PatternA: bank[0],
      tb303PatternB: bank[0],
      songData: {
        patternBanks: { tb303A: bank, tb303B: [] },
        tracks: [
          {
            trackIndex: 1,
            events: [2, 2, 1, 40].map((value) => ({ controllerId: 0x01, value })),
          },
        ],
      },
    } as unknown as Parameters<typeof selectRbsPatterns>[0];
    const a = selectRbsPatterns(raw, 2).filter((p) => p.device === 'A');
    expect(a.map((p) => `${p.device}${p.slot}:${p.uses}`)).toEqual(['A2:2', 'A1:1']);
    expect(selectRbsPatterns(raw, 1, ['a0']).map((p) => `${p.device}${p.slot}`)).toEqual(['A0']);
  });
});
