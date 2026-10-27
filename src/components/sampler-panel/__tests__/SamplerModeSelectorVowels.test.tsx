import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SamplerModeSelector } from '../SamplerModeSelector';
import type { SamplerBankParams } from '@/types';

function renderSelector(params: Partial<SamplerBankParams>, onVowelSamplesToggle = vi.fn()) {
  render(
    <SamplerModeSelector
      currentParams={{ sampleName: 'bank_0', mode: 'stretch', ...params } as SamplerBankParams}
      modeRefs={{ current: [] }}
      onModeChange={() => {}}
      onModeKeyDown={() => {}}
      onGrainSizeChange={() => {}}
      onSliceModeToggle={() => {}}
      onDynamicChopsToggle={() => {}}
      onVowelSamplesToggle={onVowelSamplesToggle}
    />,
  );
  return onVowelSamplesToggle;
}

describe('vowel samples on long notes (V2)', () => {
  it('is off by default and toggles per bank', () => {
    const toggle = renderSelector({});
    const button = screen.getByRole('button', { name: 'Use vowel samples on long notes' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveTextContent('LONG NOTES: TTS');
    expect(button.getAttribute('title')).toMatch(/500 ms or longer/);
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('shows the bank’s gate, and is unavailable in phoneme slice mode', () => {
    renderSelector({ useVowelSamplesOnLongNotes: true, minNoteDurationMs: 750, sliceMode: 'phoneme' });
    const button = screen.getByRole('button', { name: 'Use vowel samples on long notes' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button.getAttribute('title')).toMatch(/750 ms/);
    expect(button).toBeDisabled();
  });
});
