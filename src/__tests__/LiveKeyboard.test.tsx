import { render, fireEvent } from '@testing-library/react';
import { LiveKeyboard } from '../components/LiveKeyboard';
import { MIN_KEYBOARD_OCTAVE, MAX_KEYBOARD_OCTAVE } from '../utils/keyboardOctave';

describe('LiveKeyboard', () => {
  beforeEach(() => {
    localStorage.clear();
  });

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

  describe('octave shifting', () => {
    test('PC keys respect the octave offset', () => {
      const onPlay = vi.fn();
      const { getByLabelText } = render(
        <LiveKeyboard onPlayNote={onPlay} onStopNote={vi.fn()} activeTrackColor="#fff" />
      );

      fireEvent.keyDown(window, { code: 'F8' });
      expect(onPlay).toHaveBeenCalledWith('C5');
      fireEvent.keyUp(window, { code: 'F8' });

      onPlay.mockClear();
      fireEvent.click(getByLabelText('Octave down'));
      fireEvent.keyDown(window, { code: 'F8' });
      expect(onPlay).toHaveBeenCalledWith('C4');
    });

    test('mouse keys respect the octave offset', () => {
      const onPlay = vi.fn();
      const { getByLabelText, getByText } = render(
        <LiveKeyboard onPlayNote={onPlay} onStopNote={vi.fn()} activeTrackColor="#fff" />
      );

      fireEvent.click(getByLabelText('Octave up'));
      // Key labels re-render at the new octave
      fireEvent.mouseDown(getByText('C6'));
      expect(onPlay).toHaveBeenCalledWith('C6');
    });

    test('bracket shortcuts shift the octave down and up', () => {
      const onPlay = vi.fn();
      const { getByText } = render(
        <LiveKeyboard onPlayNote={onPlay} onStopNote={vi.fn()} activeTrackColor="#fff" />
      );

      fireEvent.keyDown(window, { code: 'BracketLeft' });
      expect(getByText('OCT 4')).toBeTruthy();

      fireEvent.keyDown(window, { code: 'BracketRight' });
      fireEvent.keyDown(window, { code: 'BracketRight' });
      expect(getByText('OCT 6')).toBeTruthy();

      fireEvent.keyDown(window, { code: 'F8' });
      expect(onPlay).toHaveBeenCalledWith('C6');
    });

    test('ignores octave shortcuts while typing in an input', () => {
      const { getByTestId, getByText } = render(
        <div>
          <input data-testid="test-input" />
          <LiveKeyboard onPlayNote={vi.fn()} onStopNote={vi.fn()} activeTrackColor="#fff" />
        </div>
      );

      fireEvent.keyDown(getByTestId('test-input'), { code: 'BracketLeft', bubbles: true });
      expect(getByText('OCT 5')).toBeTruthy();
    });

    test('leaves held notes at the pitch they were pressed at', () => {
      const onPlay = vi.fn();
      const onStop = vi.fn();
      render(<LiveKeyboard onPlayNote={onPlay} onStopNote={onStop} activeTrackColor="#fff" />);

      fireEvent.keyDown(window, { code: 'F8' });
      expect(onPlay).toHaveBeenCalledWith('C5');

      onPlay.mockClear();
      fireEvent.keyDown(window, { code: 'BracketLeft' });

      // The sounding voice is untouched: no retune, no stray note-off.
      expect(onStop).not.toHaveBeenCalled();
      expect(onPlay).not.toHaveBeenCalled();
    });

    test('releases a note shifted mid-hold at its original pitch', () => {
      const onPlay = vi.fn();
      const onStop = vi.fn();
      render(<LiveKeyboard onPlayNote={onPlay} onStopNote={onStop} activeTrackColor="#fff" />);

      fireEvent.keyDown(window, { code: 'F8' });
      expect(onPlay).toHaveBeenCalledWith('C5');

      fireEvent.keyDown(window, { code: 'BracketLeft' });
      fireEvent.keyUp(window, { code: 'F8' });

      // The note-off must match the note-on, not the octave now displayed.
      expect(onStop).toHaveBeenCalledTimes(1);
      expect(onStop).toHaveBeenCalledWith('C5');
      expect(onStop).not.toHaveBeenCalledWith('C4');
    });

    test('presses after a shift use the new octave', () => {
      const onPlay = vi.fn();
      const onStop = vi.fn();
      render(<LiveKeyboard onPlayNote={onPlay} onStopNote={onStop} activeTrackColor="#fff" />);

      // Hold one key across the shift, then press a second one.
      fireEvent.keyDown(window, { code: 'F8' });
      fireEvent.keyDown(window, { code: 'BracketLeft' });
      fireEvent.keyDown(window, { code: 'F7' });

      expect(onPlay).toHaveBeenCalledWith('C5');  // pressed at octave 5
      expect(onPlay).toHaveBeenCalledWith('D4');  // pressed at octave 4

      fireEvent.keyUp(window, { code: 'F8' });
      fireEvent.keyUp(window, { code: 'F7' });
      expect(onStop).toHaveBeenCalledWith('C5');
      expect(onStop).toHaveBeenCalledWith('D4');
    });

    test('clamps at the range bounds and disables the button', () => {
      const { getByLabelText, getByText } = render(
        <LiveKeyboard onPlayNote={vi.fn()} onStopNote={vi.fn()} activeTrackColor="#fff" />
      );

      // Overshoot both edges: the octave must saturate, never wrap around.
      for (let i = 0; i < 10; i++) fireEvent.keyDown(window, { code: 'BracketLeft' });
      expect(getByText(`OCT ${MIN_KEYBOARD_OCTAVE}`)).toBeTruthy();
      expect((getByLabelText('Octave down') as HTMLButtonElement).disabled).toBe(true);

      for (let i = 0; i < 20; i++) fireEvent.keyDown(window, { code: 'BracketRight' });
      expect(getByText(`OCT ${MAX_KEYBOARD_OCTAVE}`)).toBeTruthy();
      expect((getByLabelText('Octave up') as HTMLButtonElement).disabled).toBe(true);
    });

    test('persists the octave across remounts', () => {
      const first = render(
        <LiveKeyboard onPlayNote={vi.fn()} onStopNote={vi.fn()} activeTrackColor="#fff" />
      );
      fireEvent.keyDown(window, { code: 'BracketLeft' });
      fireEvent.keyDown(window, { code: 'BracketLeft' });
      expect(first.getByText('OCT 3')).toBeTruthy();
      first.unmount();

      const second = render(
        <LiveKeyboard onPlayNote={vi.fn()} onStopNote={vi.fn()} activeTrackColor="#fff" />
      );
      expect(second.getByText('OCT 3')).toBeTruthy();
    });
  });
});
