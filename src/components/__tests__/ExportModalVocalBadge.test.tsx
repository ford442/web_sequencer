import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ExportModal, type ExportModalProps } from '../ExportModal';
import type { Note, PartSequence } from '@/types';

const EMPTY: PartSequence = { steps: new Array<Note | null>(32).fill(null) };

function props(overrides: Partial<ExportModalProps> = {}): ExportModalProps {
  const samplerSeqs = Array.from({ length: 8 }, () => EMPTY);
  samplerSeqs[0] = { steps: [{ note: 'C4', velocity: 1, phonemes: [{ id: 'a', symbol: 'AA', start: 0, end: 1, pitchBend: 0, elasticity: 1.2 }] }, ...new Array<null>(31).fill(null)] };
  return {
    isOpen: true,
    onClose: () => {},
    onShowToast: () => {},
    songStructure: [],
    trackStorage: {} as ExportModalProps['trackStorage'],
    currentPattern: {
      partA: EMPTY, partB: EMPTY, bass2: EMPTY, kick: EMPTY, snare: EMPTY, closedHat: EMPTY, openHat: EMPTY,
      sampler: samplerSeqs,
    } as ExportModalProps['currentPattern'],
    tempo: 120,
    params: {
      sampler: Array.from({ length: 8 }, (_, i) => ({ sampleName: `bank_${i}`, mode: i === 0 ? 'stretch' : 'loop' })),
    } as unknown as ExportModalProps['params'],
    sampleBuffers: [],
    ...overrides,
  };
}

describe('ExportModal vocal bounce badge (#1273)', () => {
  it('lists the live-only layers of a stretch bank; Rubber Band and phoneme edits are bounced', () => {
    render(<ExportModal {...props({ harmonizerActive: true })} />);
    const note = screen.getByRole('note', { name: 'Not in the sampler bounce' });
    expect(within(note).getByText('Bank 1: HARM layers')).toBeInTheDocument();
    expect(within(note).queryByText(/stretch \/ formant pitch|phoneme edits/)).toBeNull();
  });

  it('stays quiet when a stretch bank renders through the offline Rubber Band host', () => {
    render(<ExportModal {...props()} />);
    expect(screen.queryByRole('note', { name: 'Not in the sampler bounce' })).toBeNull();
  });
});
