import { render, fireEvent } from '@testing-library/react';
import { LiveKeyboard } from '../components/LiveKeyboard';

describe('LiveKeyboard', () => {
  test('calls onPlayNote and onStopNote on key events', () => {
    const onPlay = vi.fn();
    const onStop = vi.fn();
    render(<LiveKeyboard onPlayNote={onPlay} onStopNote={onStop} activeTrackColor="#ffffff" />);

    // Simulate keydown / keyup using a mapped key (F7 is used in mapping for C5)
    fireEvent.keyDown(window, { code: 'F7' });
    expect(onPlay).toHaveBeenCalled();
    fireEvent.keyUp(window, { code: 'F7' });
    expect(onStop).toHaveBeenCalled();
  });

  test('calls onPlayNote and onStopNote on mouse events', () => {
    const onPlay = vi.fn();
    const onStop = vi.fn();
    const { getByText } = render(<LiveKeyboard onPlayNote={onPlay} onStopNote={onStop} activeTrackColor="#fff" />);

    // Click a key: pick a note label that exists, e.g., 'C5'
    const key = getByText('C5');
    fireEvent.mouseDown(key);
    expect(onPlay).toHaveBeenCalled();
    fireEvent.mouseUp(key);
    expect(onStop).toHaveBeenCalled();
  });

  test('ignores key events when typing in an input', () => {
    const onPlay = vi.fn();
    const onStop = vi.fn();
    const { getByTestId } = render(
      <div>
        <input data-testid="test-input" />
        <LiveKeyboard onPlayNote={onPlay} onStopNote={onStop} activeTrackColor="#ffffff" />
      </div>
    );

    const input = getByTestId('test-input');
    input.focus();

    // Simulate keydown on the input (bubbling up to window)
    fireEvent.keyDown(input, { code: 'F7', bubbles: true });
    expect(onPlay).not.toHaveBeenCalled();

    fireEvent.keyUp(input, { code: 'F7', bubbles: true });
    expect(onStop).not.toHaveBeenCalled();
  });
});
