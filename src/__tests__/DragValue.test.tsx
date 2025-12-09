
import { render, fireEvent } from '@testing-library/react';
import { DragValue } from '../components/DragValue';

describe('DragValue', () => {
  test('renders and responds to drag', () => {
    const onChange = vi.fn();
    const { getByRole } = render(<DragValue value={120} onChange={onChange} min={30} max={300} step={1} label="Tempo" />);
    const slider = getByRole('slider');

    // mousedown and move upward should increase the value
    fireEvent.mouseDown(slider, { clientY: 100 });
    fireEvent.mouseMove(window, { clientY: 60 });
    fireEvent.mouseUp(window);

    expect(onChange).toHaveBeenCalled();
  });

  test('responds to keyboard arrow keys', () => {
    const onChange = vi.fn();
    const { getByRole } = render(<DragValue value={120} onChange={onChange} min={30} max={300} step={1} label="Tempo" />);
    const slider = getByRole('slider');

    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalled();
  });
});
