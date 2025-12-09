import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { LiveKeyboard } from '../components/LiveKeyboard';

describe('LiveKeyboard', () => {
  test('calls onPlayNote and onStopNote on key events', () => {
    const onPlay = vi.fn();
    const onStop = vi.fn();
    const { container } = render(<LiveKeyboard onPlayNote={onPlay} onStopNote={onStop} activeTrackColor="#ffffff" />);

    // Simulate keydown / keyup using a mapped key (F1 is used in mapping for C4)
    fireEvent.keyDown(window, { code: 'F1' });
    expect(onPlay).toHaveBeenCalled();
    fireEvent.keyUp(window, { code: 'F1' });
    expect(onStop).toHaveBeenCalled();
  });

  test('calls onPlayNote and onStopNote on mouse events', () => {
    const onPlay = vi.fn();
    const onStop = vi.fn();
    const { getByText } = render(<LiveKeyboard onPlayNote={onPlay} onStopNote={onStop} activeTrackColor="#fff" />);

    // Click a key: pick a note label that exists, e.g., 'C4'
    const key = getByText('C4');
    fireEvent.mouseDown(key);
    expect(onPlay).toHaveBeenCalled();
    fireEvent.mouseUp(key);
    expect(onStop).toHaveBeenCalled();
  });
});
