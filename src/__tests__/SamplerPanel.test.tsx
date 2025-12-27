import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SamplerPanel } from '../components/SamplerPanel';

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
  createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => ({
    getChannelData: () => new Float32Array(length)
  }))
} as any;

describe('SamplerPanel TTS per-bank functionality', () => {
  const defaultProps = {
    params: Array(8).fill({
      sampleName: 'bank_0',
      playbackSpeed: 1.0,
      volume: 1.0,
      filterCutoff: 20000,
      filterResonance: 0,
      drive: 0,
      delaySend: 0
    }),
    onChange: vi.fn(),
    onLoadSample: vi.fn(),
    audioContext: mockAudioContext,
    activeBankIdx: 0,
    onBankChange: vi.fn(),
    ttsPhrases: Array(8).fill("Hello World"),
    onTtsPhraseChange: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays TTS text for the active bank', () => {
    const ttsPhrases = [
      "Bank 0 text",
      "Bank 1 text",
      "Bank 2 text",
      "Bank 3 text",
      "Bank 4 text",
      "Bank 5 text",
      "Bank 6 text",
      "Bank 7 text"
    ];

    const { rerender } = render(
      <SamplerPanel {...defaultProps} ttsPhrases={ttsPhrases} activeBankIdx={0} />
    );

    // Check that the input shows Bank 0's text
    const input = screen.getByPlaceholderText('Phrase...') as HTMLInputElement;
    expect(input.value).toBe("Bank 0 text");

    // Switch to Bank 2
    rerender(
      <SamplerPanel {...defaultProps} ttsPhrases={ttsPhrases} activeBankIdx={2} />
    );

    // Check that the input now shows Bank 2's text
    expect(input.value).toBe("Bank 2 text");
  });

  it('updates TTS text for the current bank when typing', () => {
    const onTtsPhraseChange = vi.fn();
    render(
      <SamplerPanel
        {...defaultProps}
        activeBankIdx={1}
        onTtsPhraseChange={onTtsPhraseChange}
      />
    );

    const input = screen.getByPlaceholderText('Phrase...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'New text for bank 1' } });

    expect(onTtsPhraseChange).toHaveBeenCalledWith([
      "Hello World",
      "New text for bank 1",
      "Hello World",
      "Hello World",
      "Hello World",
      "Hello World",
      "Hello World",
      "Hello World"
    ]);
  });

  it('preserves TTS text when switching banks', () => {
    const onTtsPhraseChange = vi.fn();
    const { rerender } = render(
      <SamplerPanel
        {...defaultProps}
        activeBankIdx={0}
        onTtsPhraseChange={onTtsPhraseChange}
      />
    );

    // Change text for bank 0
    const input = screen.getByPlaceholderText('Phrase...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Bank 0 custom text' } });

    // Simulate the state update by re-rendering with updated phrases
    const updatedPhrases = [...defaultProps.ttsPhrases];
    updatedPhrases[0] = 'Bank 0 custom text';

    rerender(
      <SamplerPanel
        {...defaultProps}
        ttsPhrases={updatedPhrases}
        activeBankIdx={1}
        onTtsPhraseChange={onTtsPhraseChange}
      />
    );

    // Should now show Bank 1's text
    expect(input.value).toBe("Hello World");

    // Switch back to bank 0
    rerender(
      <SamplerPanel
        {...defaultProps}
        ttsPhrases={updatedPhrases}
        activeBankIdx={0}
        onTtsPhraseChange={onTtsPhraseChange}
      />
    );

    // Should show the custom text we set earlier
    expect(input.value).toBe('Bank 0 custom text');
  });

  it('renders 8 bank selector buttons', () => {
    render(<SamplerPanel {...defaultProps} />);
    
    const buttons = screen.getAllByRole('tab');
    expect(buttons).toHaveLength(8);
    
    // Check that they're labeled 1-8
    buttons.forEach((button, idx) => {
      expect(button).toHaveTextContent(`${idx + 1}`);
    });
  });

  it('highlights the active bank button', () => {
    const { rerender } = render(
      <SamplerPanel {...defaultProps} activeBankIdx={0} />
    );

    const buttons = screen.getAllByRole('tab');
    expect(buttons[0]).toHaveAttribute('aria-selected', 'true');
    expect(buttons[1]).toHaveAttribute('aria-selected', 'false');

    // Switch to bank 3
    rerender(
      <SamplerPanel {...defaultProps} activeBankIdx={3} />
    );

    expect(buttons[0]).toHaveAttribute('aria-selected', 'false');
    expect(buttons[3]).toHaveAttribute('aria-selected', 'true');
  });

  it('handles invalid bank indices gracefully', () => {
    const onTtsPhraseChange = vi.fn();
    const { rerender } = render(
      <SamplerPanel
        {...defaultProps}
        activeBankIdx={10}  // Out of range
        onTtsPhraseChange={onTtsPhraseChange}
      />
    );

    const input = screen.getByPlaceholderText('Phrase...') as HTMLInputElement;
    
    // Should show default text
    expect(input.value).toBe("Hello World");
    
    // Try to change text with invalid index
    fireEvent.change(input, { target: { value: 'Invalid bank text' } });
    
    // Should not call onTtsPhraseChange due to bounds check
    expect(onTtsPhraseChange).not.toHaveBeenCalled();
  });

  it('handles missing or incomplete ttsPhrases array', () => {
    const { rerender } = render(
      <SamplerPanel
        {...defaultProps}
        ttsPhrases={[]}  // Empty array
        activeBankIdx={0}
      />
    );

    const input = screen.getByPlaceholderText('Phrase...') as HTMLInputElement;
    expect(input.value).toBe("Hello World");

    // Test with array that's too short
    rerender(
      <SamplerPanel
        {...defaultProps}
        ttsPhrases={["Bank 0", "Bank 1"]}  // Only 2 elements
        activeBankIdx={3}  // Index beyond array length
      />
    );

    expect(input.value).toBe("Hello World");
  });
});
