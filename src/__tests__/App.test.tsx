import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '../App';
import { AppStateProvider } from '../contexts/AppStateContext';
import { CompactLayoutProvider } from '../contexts/CompactLayoutContext';
import { vi } from 'vitest';

vi.mock('../services/AISongStorage', () => ({
    AISongStorage: {
        saveSong: vi.fn(),
        loadSong: vi.fn()
    }
}));


describe('App', () => {
  it('renders HYPHON heading', () => {
    render(
      <AppStateProvider>
        <CompactLayoutProvider>
          <App />
        </CompactLayoutProvider>
      </AppStateProvider>
    );
    // There are now multiple HYPHON headings (one in overlay, one in header)
    const headings = screen.getAllByRole('heading', { level: 1, name: /HYPHON/i });
    expect(headings.length).toBeGreaterThan(0);
    expect(headings[0]).toBeInTheDocument();
  });

  it('renders volume control', () => {
    render(
      <AppStateProvider>
        <CompactLayoutProvider>
          <App />
        </CompactLayoutProvider>
      </AppStateProvider>
    );
    expect(screen.getByLabelText(/Master Volume/i)).toBeInTheDocument();
  });

  it('renders song controls', () => {
    render(
      <AppStateProvider>
        <CompactLayoutProvider>
          <App />
        </CompactLayoutProvider>
      </AppStateProvider>
    );
    // Check for multiple occurrences of "Song" related UI
    const songElements = screen.getAllByText(/Song/i);
    expect(songElements.length).toBeGreaterThan(0);

    // Check for the Song button (now accessible via aria-label)
    const songModeButtons = screen.getAllByRole('button', { name: /Toggle Song Mode/i });
    expect(songModeButtons.length).toBeGreaterThan(0);

    // Check visible text
    expect(screen.getAllByText('SONG')[0]).toBeInTheDocument();
  });

  it('renders Tape Stop button', () => {
    render(
      <AppStateProvider>
        <CompactLayoutProvider>
          <App />
        </CompactLayoutProvider>
      </AppStateProvider>
    );
    const tapeStopButton = screen.getByRole('button', { name: /Trigger Tape Stop Effect/i });
    expect(tapeStopButton).toBeInTheDocument();
    expect(tapeStopButton).toHaveTextContent(/Tape Stop/i);
  });
});
