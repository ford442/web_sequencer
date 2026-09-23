import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ExportModal, type ExportModalProps } from '../ExportModal';

const EMPTY = { steps: Array(32).fill(null) };

function props(overrides: Partial<ExportModalProps> = {}): ExportModalProps {
  const samplerSeqs = Array.from({ length: 8 }, () => EMPTY);
  samplerSeqs[0] = { steps: [{ note: 'C4', velocity: 1, phonemes: [{ id: 'a', symbol: 'AA', start: 0, end: 1, pitchBend: 0, elasticity: 1.2 }] }, ...Array(31).fill(null)] };
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

describe('ExportModal vocal FX badge (#1273)', () => {
  it('says vocal FX freeze is unsupported for banks the bounce renders dry', () => {
    render(<ExportModal {...props({ harmonizerActive: true })} />);
    const note = screen.getByRole('note', { name: 'Vocal FX freeze unsupported' });
    expect(within(note).getByText(/Bank 1: stretch \/ formant pitch · phoneme edits · HARM layers/)).toBeInTheDocument();
  });

  it('stays quiet when no bank depends on the live vocal chain', () => {
    const p = props();
    p.params.sampler[0] = { ...p.params.sampler[0], mode: 'loop' };
    render(<ExportModal {...p} />);
    expect(screen.queryByRole('note', { name: 'Vocal FX freeze unsupported' })).toBeNull();
  });
});
