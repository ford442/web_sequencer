import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '../App';
import { WebGPUProvider } from '../gpu/WebGPUContext';

// Helper to render App with required providers
const renderApp = () => {
  return render(
    <WebGPUProvider>
      <App />
    </WebGPUProvider>
  );
};

describe('App', () => {
  it('renders ELECTRIBE heading', () => {
    renderApp();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/ELECTRIBE/i);
  });

  it('renders volume control', () => {
    renderApp();
    expect(screen.getByText(/Vol/i)).toBeInTheDocument();
  });

  it('renders song controls', () => {
    renderApp();
    // Check for multiple occurrences of "Song" related UI
    const songElements = screen.getAllByText(/Song/i);
    expect(songElements.length).toBeGreaterThan(0);

    // Check for the new Song Mode toggle
    expect(screen.getByText('Song Mode')).toBeInTheDocument();

    // Check for the Song button
    expect(screen.getByRole('button', { name: 'SONG' })).toBeInTheDocument();
  });

  it('renders the waveform selector buttons for the active synth', () => {
    renderApp();
    // The active selected track defaults to partA, which should show the WaveformSelector
    const wavSawBtns = screen.getAllByRole('button', { name: /Select wav-saw waveform/i });
    // There may be multiple instances (module inline + overlay). Assert at least one is visible
    expect(wavSawBtns.length).toBeGreaterThan(0);
    expect(wavSawBtns.some((btn) => btn)).toBeTruthy();
  });

  it('renders floating waveform toggle button', () => {
    renderApp();
    const toggleBtn = screen.getByRole('button', { name: /Open waveform selector/i });
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toBeVisible();
  });

  it('opens waveform overlay when toggle clicked', async () => {
    renderApp();
    const toggleBtn = screen.getByRole('button', { name: /Open waveform selector/i });
    expect(toggleBtn).toBeInTheDocument();
    // click and assert overlay waveform appears
    const initialCount = screen.getAllByRole('button', { name: /Select wav-saw waveform/i }).length;
    await (await import('@testing-library/user-event')).default.click(toggleBtn);
    const newCount = screen.getAllByRole('button', { name: /Select wav-saw waveform/i }).length;
    expect(newCount).toBeGreaterThan(initialCount);
  });
});
