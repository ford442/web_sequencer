import { describe, test, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DragValue } from '../components/DragValue';

describe('DragValue', () => {
  test('renders and responds to drag', () => {
    const onChange = vi.fn();
    const { getByRole } = render(<DragValue value={120} onChange={onChange} min={30} max={300} step={1} label="Tempo" />);
    const slider = getByRole('slider');

    fireEvent.pointerDown(slider, { clientY: 100, pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(document, { clientY: 60, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(document, { pointerId: 1 });

    expect(onChange).toHaveBeenCalled();
  });

  test('responds to keyboard arrow keys', () => {
    const onChange = vi.fn();
    const { getByRole } = render(<DragValue value={120} onChange={onChange} min={30} max={300} step={1} label="Tempo" />);
    const slider = getByRole('slider');

    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalled();
  });

  test('focuses on pointer down', () => {
    const onChange = vi.fn();
    const { getByRole } = render(<DragValue value={120} onChange={onChange} min={30} max={300} step={1} label="Tempo" />);
    const slider = getByRole('slider');

    expect(document.activeElement).not.toBe(slider);
    fireEvent.pointerDown(slider, { pointerId: 1 });
    expect(document.activeElement).toBe(slider);
  });
});
