import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '../App';

describe('App', () => {
  it('renders ELECTRIBE heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/ELECTRIBE/i);
  });

  it('renders volume control', () => {
    render(<App />);
    expect(screen.getByText(/Vol/i)).toBeInTheDocument();
  });

  it('renders song controls', () => {
    render(<App />);
    // Check for multiple occurrences of "Song" related UI
    const songElements = screen.getAllByText(/Song/i);
    expect(songElements.length).toBeGreaterThan(0);

    // Check for the new Song Mode toggle
    expect(screen.getByText('Song Mode')).toBeInTheDocument();

    // Check for the Song button
    expect(screen.getByRole('button', { name: 'SONG' })).toBeInTheDocument();
  });
});
