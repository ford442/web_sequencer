
import { render, fireEvent } from '@testing-library/react';
import { Knob } from '../components/Knob';

describe('Knob', () => {
  test('keyboard arrow keys change value', () => {
    const onChange = vi.fn();
    const { getByRole } = render(<Knob label="Test" value={10} onChange={onChange} min={0} max={100} step={1} />);
    const knob = getByRole('slider');

    fireEvent.keyDown(knob, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalled();
  });

  test('focuses on mousedown', () => {
    const onChange = vi.fn();
    const { getByRole } = render(<Knob label="Test" value={10} onChange={onChange} min={0} max={100} step={1} />);
    const knob = getByRole('slider');

    expect(document.activeElement).not.toBe(knob);
    fireEvent.mouseDown(knob);
    expect(document.activeElement).toBe(knob);
  });
});
