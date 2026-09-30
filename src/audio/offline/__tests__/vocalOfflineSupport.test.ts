import { describe, expect, it } from 'vitest';
import type { PartSequence, SamplerBankParams } from '@/types';
import { describeOfflineVocalSupport, formatOfflineVocalWarning } from '../vocalOfflineSupport';

const bank = (params: Partial<SamplerBankParams>) => ({ sampleName: 'voice', ...params }) as SamplerBankParams;
const seq = (...steps: PartSequence['steps']): PartSequence => ({ steps });
const note = (extra: object = {}) => ({ note: 'C4', velocity: 1, ...extra });

describe('describeOfflineVocalSupport', () => {
  it('flags a stretch bank with notes as needing the live Rubber Band chain', () => {
    expect(describeOfflineVocalSupport({ sampler: [bank({ mode: 'stretch' })], sequences: [seq(note())] }))
      .toEqual([{ bank: 0, sampleName: 'voice', gaps: ['rubber-band'] }]);
  });

  it('adds vocal FX from bank params or per-step params, and phoneme edits', () => {
    const reports = describeOfflineVocalSupport({
      sampler: [bank({ mode: 'stretch', spectralComp: 0.5 }), bank({ mode: 'stretch' }), bank({ mode: 'stretch', downsample: 4 })],
      sequences: [
        seq(note()),
        seq(null, note({ vocalChorus: 0.3, phonemes: [{ id: 'x', symbol: 'AA', start: 0, end: 1, pitchBend: 0 }] })),
        seq(note()),
      ],
    });
    expect(reports.map((r) => r.gaps)).toEqual([
      ['rubber-band', 'vocal-fx'],
      ['rubber-band', 'vocal-fx', 'phoneme-edits'],
      ['rubber-band', 'vocal-fx'],
    ]);
  });

  it('flags HARM on any bank that plays, and ignores silent or loop-only banks', () => {
    const reports = describeOfflineVocalSupport({
      sampler: [bank({ mode: 'loop' }), bank({ mode: 'stretch' }), bank({ mode: 'loop' })],
      sequences: [seq(note()), seq(null, null), seq(note())],
      harmonizerActive: true,
    });
    expect(reports).toEqual([
      { bank: 0, sampleName: 'voice', gaps: ['harmonizer'] },
      { bank: 2, sampleName: 'voice', gaps: ['harmonizer'] },
    ]);
    expect(describeOfflineVocalSupport({ sampler: [bank({ mode: 'loop' })], sequences: [seq(note())] })).toEqual([]);
  });
});

describe('formatOfflineVocalWarning', () => {
  it('names the unsupported banks and features, or returns null', () => {
    expect(formatOfflineVocalWarning([])).toBeNull();
    expect(formatOfflineVocalWarning([{ bank: 2, sampleName: 'v', gaps: ['rubber-band', 'harmonizer'] }]))
      .toBe('Vocal FX freeze unsupported: sampler stems are dry and do not match what you hear — bank 3 (stretch / formant pitch, HARM layers).');
  });
});
