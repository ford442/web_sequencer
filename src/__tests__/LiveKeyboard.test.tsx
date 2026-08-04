import { render, fireEvent } from '@testing-library/react';
import { LiveKeyboard } from '../components/LiveKeyboard';

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

    test('re-triggers held notes at the new octave when shifted mid-hold', () => {
      const onPlay = vi.fn();
      const onStop = vi.fn();
      render(<LiveKeyboard onPlayNote={onPlay} onStopNote={onStop} activeTrackColor="#fff" />);

      fireEvent.keyDown(window, { code: 'F8' });
      expect(onPlay).toHaveBeenCalledWith('C5');

      onPlay.mockClear();
      fireEvent.keyDown(window, { code: 'BracketLeft' });
      expect(onStop).toHaveBeenCalledWith('C5');
      expect(onPlay).toHaveBeenCalledWith('C4');
    });

    test('clamps at the range bounds and disables the button', () => {
      const { getByLabelText, getByText } = render(
        <LiveKeyboard onPlayNote={vi.fn()} onStopNote={vi.fn()} activeTrackColor="#fff" />
      );

      for (let i = 0; i < 10; i++) fireEvent.keyDown(window, { code: 'BracketLeft' });
      expect(getByText('OCT 1')).toBeTruthy();
      expect((getByLabelText('Octave down') as HTMLButtonElement).disabled).toBe(true);

      for (let i = 0; i < 20; i++) fireEvent.keyDown(window, { code: 'BracketRight' });
      expect(getByText('OCT 7')).toBeTruthy();
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
