import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DrumPads } from '../../src/components/DrumPads';

describe('DrumPads', () => {
  it('triggers a pad once when Enter is pressed, ignoring key repeats', () => {
    const handlePlayDrum = vi.fn();
    render(<DrumPads onPlayDrum={handlePlayDrum} />);

    // Find the first drum pad button
    const pad = screen.getByLabelText('Play KICK');

    // Simulate Enter keydown
    fireEvent.keyDown(pad, { key: 'Enter', repeat: false });
    expect(handlePlayDrum).toHaveBeenCalledTimes(1);
    expect(handlePlayDrum).toHaveBeenCalledWith('kick', 1.0); // KICK's sound ID and velocity

    // The pad should now look active (the text-black class is applied when isActive is true)
    expect(pad.className).toContain('text-black');

    // Simulate key repeat
    fireEvent.keyDown(pad, { key: 'Enter', repeat: true });
    // Expect it to still only be called once, because `if (e.repeat) return;` caught it
    expect(handlePlayDrum).toHaveBeenCalledTimes(1);

    // Simulate Key up
    fireEvent.keyUp(pad, { key: 'Enter', repeat: false });

    // Ensure state resets on key up (no longer contains text-black class, goes back to text-gray-400)
    expect(pad.className).toContain('text-gray-400');
  });

  it('triggers a pad once when Space is pressed', () => {
    const handlePlayDrum = vi.fn();
    render(<DrumPads onPlayDrum={handlePlayDrum} />);

    const pad = screen.getByLabelText('Play SNARE');

    fireEvent.keyDown(pad, { key: ' ', repeat: false });
    expect(handlePlayDrum).toHaveBeenCalledTimes(1);
    expect(handlePlayDrum).toHaveBeenCalledWith('snare', 1.0);

    expect(pad.className).toContain('text-black');

    fireEvent.keyDown(pad, { key: ' ', repeat: true });
    expect(handlePlayDrum).toHaveBeenCalledTimes(1);

    fireEvent.keyUp(pad, { key: ' ', repeat: false });
    expect(pad.className).toContain('text-gray-400');
  });
});
