import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceEditor } from '../components/VoiceEditor';

// Mock the SupertonicService and VoiceDesigner
vi.mock('../services/Supertonic', () => ({
  SupertonicService: {
    getInstance: vi.fn(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      isServiceReady: vi.fn().mockReturnValue(true),
      getStyle: vi.fn().mockReturnValue({ /* Mock style object */ }),
      updateStyleFromRaw: vi.fn(),
    })),
  }
}));

vi.mock('../services/VoiceDesigner', () => {
    return {
        // vitest 4 constructs mock implementations via Reflect.construct.
        VoiceDesigner: vi.fn().mockImplementation(function () { return ({
            setCanvas: vi.fn(),
            loadFromStyle: vi.fn(),
            getRawData: vi.fn().mockReturnValue({ ttl: {}, dp: {}, ttlDims: {}, dpDims: {} }),
            mirrorX: vi.fn().mockResolvedValue(undefined),
            mirrorY: vi.fn().mockResolvedValue(undefined),
            invertSign: vi.fn().mockResolvedValue(undefined),
            randomShift: vi.fn().mockResolvedValue(undefined),
            dspSharpen: vi.fn().mockResolvedValue(undefined),
            dspTremolo: vi.fn().mockResolvedValue(undefined),
            dspEcho: vi.fn().mockResolvedValue(undefined),
            reset: vi.fn().mockResolvedValue(undefined),
        }); })
    }
});


describe('VoiceEditor', () => {
    const defaultProps = {
        onClose: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the Voice Editor dialog', () => {
        render(<VoiceEditor {...defaultProps} />);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText(/VOICE DESIGNER/i)).toBeInTheDocument();
    });

    it('displays the heatmap canvas with correct accessibility attributes', () => {
        render(<VoiceEditor {...defaultProps} />);
        const canvas = screen.getByRole('img', { name: /Voice Heatmap Visualization/i });
        expect(canvas).toBeInTheDocument();
        expect(canvas.tagName).toBe('CANVAS');
    });

    it('renders all control buttons with accessible names/titles', () => {
        render(<VoiceEditor {...defaultProps} />);

        expect(screen.getByTitle('Mirror the voice pattern horizontally')).toBeInTheDocument();
        expect(screen.getByTitle('Mirror the voice pattern vertically')).toBeInTheDocument();
        expect(screen.getByTitle('Invert the phase of the voice pattern')).toBeInTheDocument();
        expect(screen.getByTitle('Randomly shift voice characteristics')).toBeInTheDocument();

        expect(screen.getByTitle('Enhance contrast in voice features')).toBeInTheDocument();
        expect(screen.getByTitle('Apply amplitude modulation')).toBeInTheDocument();
        expect(screen.getByTitle('Add delay/echo effect')).toBeInTheDocument();
        expect(screen.getByTitle('Reset to original voice style')).toBeInTheDocument();
    });

    it('updates status when an operation is performed', async () => {
        render(<VoiceEditor {...defaultProps} />);

        const mirrorBtn = screen.getByText('Mirror X');
        fireEvent.click(mirrorBtn);

        // Since handleOp is async, we wait for the status update
        await screen.findByText(/Applied: mirrorX/i);
    });

    it('shows loading state and calls apply on "APPLY TO ENGINE" click', async () => {
        render(<VoiceEditor {...defaultProps} />);

        const applyBtn = screen.getByText('APPLY TO ENGINE');
        fireEvent.click(applyBtn);

        expect(screen.getByText(/APPLYING.../i)).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent(/Style Applied to Engine!/i);
    });

    it('calls onClose after applying', async () => {
        vi.useFakeTimers();
        render(<VoiceEditor {...defaultProps} />);

        const applyBtn = screen.getByText('APPLY TO ENGINE');
        fireEvent.click(applyBtn);

        act(() => {
            vi.advanceTimersByTime(500);
        });

        expect(defaultProps.onClose).toHaveBeenCalled();
        vi.useRealTimers();
    });
});
