
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceEditor } from '../VoiceEditor';

// Mock dependencies
vi.mock('../services/VoiceDesigner', () => {
  return {
    VoiceDesigner: class {
      setCanvas = vi.fn();
      loadFromStyle = vi.fn();
      getRawData = vi.fn().mockReturnValue({ ttl: [], dp: [], ttlDims: [], dpDims: [] });
      mirrorX = vi.fn();
      mirrorY = vi.fn();
      invertSign = vi.fn();
      randomShift = vi.fn();
      dspSharpen = vi.fn();
      dspTremolo = vi.fn();
      dspEcho = vi.fn();
      reset = vi.fn();
    }
  };
});

vi.mock('../services/Supertonic', () => {
  return {
    SupertonicService: {
      getInstance: () => ({
        isServiceReady: () => true,
        getStyle: () => ({ ttl: { data: [] }, dp: { data: [] } }),
        updateStyleFromRaw: vi.fn(),
      })
    }
  };
});

describe('VoiceEditor Accessibility', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with correct accessibility attributes', () => {
    render(<VoiceEditor onClose={mockOnClose} />);

    // 1. Check for dialog role
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'voice-designer-title');

    // 2. Check title has ID
    const title = screen.getByText(/VOICE DESIGNER/i);
    expect(title).toHaveAttribute('id', 'voice-designer-title');

    // 3. Check close button label
    const closeBtn = screen.getByRole('button', { name: /Close Voice Designer/i });
    expect(closeBtn).toBeInTheDocument();

    // 4. Check heatmap canvas has label/role
    const canvas = screen.getByRole('img', { name: /Voice Heatmap Visualization/i });
    expect(canvas).toBeInTheDocument();

    // 5. Check status region
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute('aria-live', 'polite');
  });
});
