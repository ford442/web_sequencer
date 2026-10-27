import { describe, expect, it } from 'vitest';
import type { PartSequence, SamplerBankParams } from '@/types';
import { describeOfflineVocalSupport, formatOfflineVocalWarning } from '../vocalOfflineSupport';

const bank = (params: Partial<SamplerBankParams>) => ({ sampleName: 'voice', ...params }) as SamplerBankParams;
const seq = (...steps: PartSequence['steps']): PartSequence => ({ steps });
const note = (extra: object = {}) => ({ note: 'C4', velocity: 1, ...extra });

describe('describeOfflineVocalSupport', () => {
  it('reports nothing for a stretch bank the offline Rubber Band host rendered', () => {
    expect(describeOfflineVocalSupport({ sampler: [bank({ mode: 'stretch', spectralComp: 0.5 })], sequences: [seq(note())] }))
      .toEqual([]);
  });

  it('reports a stretch bank the host could not load, with the reason and what is missing', () => {
    const reports = describeOfflineVocalSupport({
      sampler: [bank({ mode: 'stretch', spectralComp: 0.5 }), bank({ mode: 'stretch' }), bank({ mode: 'stretch', downsample: 4 })],
      sequences: [
        seq(note()),
        seq(null, note({ vocalChorus: 0.3, phonemes: [{ id: 'x', symbol: 'AA', start: 0, end: 1, pitchBend: 0 }] })),
        seq(note({ phonemeDelayAmount: 0.2 })),
      ],
      unsupported: new Map([[0, 'rubberband.wasm unavailable'], [1, 'x'], [2, 'y']]),
    });
    expect(reports.map((r) => r.gaps)).toEqual([
      ['rubber-band', 'vocal-fx'],
      ['rubber-band', 'vocal-fx', 'phoneme-edits'],
      ['rubber-band', 'vocal-fx'],
    ]);
    expect(reports[0].unsupportedReason).toBe('rubberband.wasm unavailable');
  });

  it('flags a note FX chain on a stretch bank, which the host does not play', () => {
    expect(describeOfflineVocalSupport({
      sampler: [bank({ mode: 'stretch' }), bank({ mode: 'loop' })],
      sequences: [seq(note()), seq(note())],
      noteFxBanks: new Set([0, 1]),
    })).toEqual([{ bank: 0, sampleName: 'voice', gaps: ['note-fx'] }]);
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
  it('says an unsupported bank was left out, not rendered dry, and lists partial gaps', () => {
    expect(formatOfflineVocalWarning([])).toBeNull();
    expect(formatOfflineVocalWarning([
      { bank: 2, sampleName: 'v', gaps: ['rubber-band'], unsupportedReason: 'Rubber Band did not load offline: timeout' },
      { bank: 4, sampleName: 'v', gaps: ['harmonizer'] },
    ])).toBe(
      'Vocal freeze unsupported, stem left out rather than rendered dry: bank 3 (Rubber Band did not load offline: timeout).'
      + ' Not in the sampler bounce: bank 5 (HARM layers).',
    );
  });
});
