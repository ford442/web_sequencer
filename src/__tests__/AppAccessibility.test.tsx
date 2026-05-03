import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { App } from '../App';

const mockTriggerTapeStop = vi.fn();

// Mock the AudioEngine hook to avoid actual audio context issues
vi.mock('../hooks/useAudioEngine', () => ({
  useAudioEngine: () => ({
    audioEngine: {
      setMasterVolume: vi.fn(),
      setGlobalPan: vi.fn(),
      triggerTapeStop: mockTriggerTapeStop,
      context: { currentTime: 0 }
    },
    isReady: true,
    initializeAudio: vi.fn(),
  }),
}));

// Mock Pyodide hook
vi.mock('../hooks/usePyodideEngine', () => ({
  usePyodideEngine: () => ({
    pyodide: null,
    isPyodideReady: true,
    pyodideStatus: 'ready'
  })
}));

describe('App Accessibility', () => {
  it('resets master volume when pressing Delete/Backspace', () => {
    render(<App />);
    const volumeSlider = screen.getByLabelText('Master Volume');

    // Simulate changing the value first
    fireEvent.change(volumeSlider, { target: { value: '0.5' } });
    expect(volumeSlider).toHaveValue('0.5');

    // Press Delete
    fireEvent.keyDown(volumeSlider, { key: 'Delete' });
    expect(volumeSlider).toHaveValue('0.8'); // Default value

    // Change again
    fireEvent.change(volumeSlider, { target: { value: '0.2' } });

    // Press Backspace
    fireEvent.keyDown(volumeSlider, { key: 'Backspace' });
    expect(volumeSlider).toHaveValue('0.8');
  });

  it('resets global pan when pressing Delete/Backspace', () => {
    render(<App />);
    const panSlider = screen.getByLabelText('Global Pan');

    // Simulate changing the value first
    fireEvent.change(panSlider, { target: { value: '0.5' } });
    expect(panSlider).toHaveValue('0.5');

    // Press Delete
    fireEvent.keyDown(panSlider, { key: 'Delete' });
    expect(panSlider).toHaveValue('0'); // Default value

    // Change again
    fireEvent.change(panSlider, { target: { value: '-0.5' } });

    // Press Backspace
    fireEvent.keyDown(panSlider, { key: 'Backspace' });
    expect(panSlider).toHaveValue('0');
  });

  it('triggers tape stop on Escape key press', () => {
    render(<App />);
    mockTriggerTapeStop.mockClear();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockTriggerTapeStop).toHaveBeenCalledWith(2.0);
  });
});
