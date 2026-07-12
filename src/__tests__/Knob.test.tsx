
import { render, fireEvent } from '@testing-library/react';
import { Knob } from '../components/Knob';

function expectedRotation(value: number, min = 0, max = 100): number {
  return -135 + ((value - min) / (max - min)) * 270;
}

function getNeedleTransform(container: HTMLElement): string {
  const needle = container.querySelector('[data-testid="knob-needle"]') as HTMLElement;
  return needle?.style.transform ?? '';
}

describe('Knob', () => {
  test('keyboard arrow keys change value', () => {
    const onChange = vi.fn();
    const { getByRole } = render(<Knob label="Test" value={10} onChange={onChange} min={0} max={100} step={1} />);
    const knob = getByRole('slider');

    fireEvent.keyDown(knob, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalled();
  });

  test('clicking the knob focuses it', () => {
    const onChange = vi.fn();
    const { getByRole } = render(<Knob label="Test" value={10} onChange={onChange} min={0} max={100} step={1} />);
    const knob = getByRole('slider');

    fireEvent.pointerDown(knob);

    // Check if the element is focused
    expect(document.activeElement).toBe(knob);
  });

  test('needle has no CSS transition so external value updates are immediate', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <Knob label="Test" value={10} onChange={onChange} min={0} max={100} step={1} />
    );
    const needle = container.querySelector('[data-testid="knob-needle"]') as HTMLElement;
    expect(needle.style.transition).toBe('none');

    rerender(<Knob label="Test" value={75} onChange={onChange} min={0} max={100} step={1} />);
    expect(getNeedleTransform(container)).toBe(`rotate(${expectedRotation(75)}deg)`);
  });

  test('automated knob rotation tracks value prop without transition lag', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <Knob label="Cutoff" value={20} onChange={onChange} min={20} max={15000} step={1} isAutomated />
    );
    const needle = container.querySelector('[data-testid="knob-needle"]') as HTMLElement;
    expect(needle.style.transition).toBe('none');

    rerender(
      <Knob label="Cutoff" value={8000} onChange={onChange} min={20} max={15000} step={1} isAutomated />
    );
    expect(getNeedleTransform(container)).toBe(`rotate(${expectedRotation(8000, 20, 15000)}deg)`);
  });

  test('releasing drag does not re-enable a easing transition', () => {
    const onChange = vi.fn();
    const { container, getByRole } = render(
      <Knob label="Test" value={50} onChange={onChange} min={0} max={100} step={1} />
    );
    const knob = getByRole('slider');
    fireEvent.pointerDown(knob);
    fireEvent.pointerUp(knob);

    const needle = container.querySelector('[data-testid="knob-needle"]') as HTMLElement;
    expect(needle.style.transition).toBe('none');
  });
});
