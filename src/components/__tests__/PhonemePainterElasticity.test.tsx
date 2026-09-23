import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PhonemePainter } from '../PhonemePainter';
import type { Note, PhonemeData } from '@/types';

const PHONEMES: PhonemeData[] = [
  { id: 'hh', symbol: 'HH', start: 0, end: 0.2, pitchBend: 0, volume: 1 },
  { id: 'ay', symbol: 'AY', start: 0.2, end: 1, pitchBend: 0, volume: 1 },
];

function renderPainter() {
  const onSave = vi.fn();
  const note: Note = { note: 'C4', velocity: 1, length: 2, phonemes: PHONEMES };
  render(
    <PhonemePainter
      isOpen
      onClose={() => {}}
      stepIndex={3}
      note={note}
      audioBuffer={null}
      onSave={onSave}
    />,
  );
  return { onSave };
}

const pill = (symbol: string) => screen.getByRole('button', { name: new RegExp(`^${symbol} phoneme, .*elasticity`) });
const saved = (onSave: ReturnType<typeof vi.fn>) => onSave.mock.calls[0][1] as PhonemeData[];

describe('Phoneme Painter elasticity', () => {
  it('[ / ] on a selected pill squish and stretch it, and Save persists the value', () => {
    const { onSave } = renderPainter();
    fireEvent.click(pill('AY'));
    fireEvent.keyDown(pill('AY'), { key: ']' });
    fireEvent.keyDown(pill('AY'), { key: ']', shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSave).toHaveBeenCalledWith(3, expect.any(Array));
    expect(saved(onSave).find((p) => p.id === 'ay')?.elasticity).toBe(1.3);
    expect(saved(onSave).find((p) => p.id === 'hh')?.elasticity).toBeUndefined();
  });

  it('the selected-phoneme slider sets elasticity, clamped to 50–150 %', () => {
    const { onSave } = renderPainter();
    fireEvent.click(pill('HH'));
    const slider = screen.getByRole('slider', { name: 'Elasticity' });
    expect(slider).toHaveAttribute('min', '50');
    expect(slider).toHaveAttribute('max', '150');
    fireEvent.change(slider, { target: { value: '65' } });
    expect(pill('HH')).toHaveAccessibleName(/elasticity 65%/);

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saved(onSave).find((p) => p.id === 'hh')?.elasticity).toBe(0.65);
  });

  it('dragging the pill handle stretches the phoneme', () => {
    const { onSave } = renderPainter();
    fireEvent.click(pill('AY'));
    const handle = screen.getByTestId('elasticity-handle-ay');
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    // 120 px sweeps the full 0.5 → 1.5 range, so +30 px ≈ +0.25.
    fireEvent.pointerMove(document, { clientX: 130, pointerId: 1 });
    fireEvent.pointerUp(document, { pointerId: 1 });
    expect(handle).toHaveAttribute('data-elasticity', '1.25');

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saved(onSave).find((p) => p.id === 'ay')?.elasticity).toBe(1.25);
  });

  it('clicking a pill keeps it selected (the track only deselects on empty space)', () => {
    renderPainter();
    fireEvent.click(pill('AY'));
    expect(pill('AY')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Selected phoneme controls' })).toBeInTheDocument();
  });
});
