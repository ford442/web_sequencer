import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SamplerPanel } from '../components/SamplerPanel';
import React from 'react';

// Mock the SupertonicService
vi.mock('../services/Supertonic', () => ({
  SupertonicService: {
    getInstance: () => ({
      init: vi.fn().mockResolvedValue(undefined),
      isServiceReady: () => false,
      generate: vi.fn().mockResolvedValue(new Float32Array(1000))
    })
  }
}));

// Mock AudioContext
const mockAudioContext = {
  createBuffer: vi.fn((_channels: number, length: number) => ({
    getChannelData: () => new Float32Array(length)
  }))
} as any;

describe('SamplerPanel Slice Mode', () => {
  const defaultProps = {
    params: Array(8).fill({
      sampleName: 'bank_0',
      playbackSpeed: 1.0,
      volume: 1.0,
      filterCutoff: 20000,
      filterResonance: 0,
      drive: 0,
      delaySend: 0,
      mode: 'loop', // Default is loop
      grainSize: 4410,
      sliceMode: 'off'
    }),
    onChange: vi.fn(),
    onLoadSample: vi.fn(),
    audioContext: mockAudioContext,
    activeBankIdx: 0,
    onBankChange: vi.fn(),
    ttsPhrases: Array(8).fill("Hello World"),
    onTtsPhraseChange: vi.fn(),
    onParamChange: vi.fn() // Important for testing Slice Mode toggle
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT show Slice toggle when mode is LOOP', () => {
    // @ts-ignore
    render(<SamplerPanel {...defaultProps} />);

    // Should not find the Slice toggle
    const sliceButton = screen.queryByLabelText('Toggle Slice Mode');
    expect(sliceButton).not.toBeInTheDocument();
  });

  it('does NOT show Slice toggle when mode is WAVETABLE', () => {
      const wavetableProps = {
          ...defaultProps,
          params: [{ ...defaultProps.params[0], mode: 'wavetable' }]
      };
      // @ts-ignore
    render(<SamplerPanel {...wavetableProps} />);

    const sliceButton = screen.queryByLabelText('Toggle Slice Mode');
    expect(sliceButton).not.toBeInTheDocument();
  });

  it('SHOWS Slice toggle when mode is STRETCH', () => {
      const stretchProps = {
          ...defaultProps,
          params: [{ ...defaultProps.params[0], mode: 'stretch' }]
      };
      // @ts-ignore
    render(<SamplerPanel {...stretchProps} />);

    const sliceButton = screen.getByLabelText('Toggle Slice Mode');
    expect(sliceButton).toBeInTheDocument();
    expect(sliceButton).toHaveTextContent('OFF');
  });

  it('toggles Slice Mode ON when clicked', () => {
      const onParamChange = vi.fn();
      const stretchProps = {
          ...defaultProps,
          params: [{ ...defaultProps.params[0], mode: 'stretch', sliceMode: 'off' }],
          onParamChange
      };
      // @ts-ignore
    render(<SamplerPanel {...stretchProps} />);

    const sliceButton = screen.getByLabelText('Toggle Slice Mode');
    fireEvent.click(sliceButton);

    expect(onParamChange).toHaveBeenCalledWith(0, 'sliceMode', 'phoneme');
  });

  it('toggles Slice Mode OFF when clicked again', () => {
      const onParamChange = vi.fn();
      const stretchProps = {
          ...defaultProps,
          params: [{ ...defaultProps.params[0], mode: 'stretch', sliceMode: 'phoneme' }],
          onParamChange
      };
      // @ts-ignore
    render(<SamplerPanel {...stretchProps} />);

    const sliceButton = screen.getByLabelText('Toggle Slice Mode');
    expect(sliceButton).toHaveTextContent('ON (PHONEMES)');

    fireEvent.click(sliceButton);

    expect(onParamChange).toHaveBeenCalledWith(0, 'sliceMode', 'off');
  });
});
