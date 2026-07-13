import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MelodicStep } from '../MelodicStep';

describe('MelodicStep', () => {
  it('places an inactive step and allows drag-to-stretch in one gesture', () => {
    const onToggle = vi.fn();
    const onEditLength = vi.fn();

    if (!(Element.prototype as any).setPointerCapture) {
      (Element.prototype as any).setPointerCapture = vi.fn();
    }
    if (!(Element.prototype as any).releasePointerCapture) {
      (Element.prototype as any).releasePointerCapture = vi.fn();
    }

    render(
      <svg aria-hidden="true">
        <MelodicStep
          stepIndex={4}
          active={false}
          rowLabel="Sampler"
          rowKey="sampler"
          refsArray={{ current: [] }}
          onToggle={onToggle}
          onEditLength={onEditLength}
        />
      </svg>
    );

    const step = screen.getByRole('button', { name: 'Sampler step 5' });

    fireEvent.pointerDown(step, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(step, { pointerId: 1, clientX: 146 });

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('sampler', 4, expect.anything());
    expect(onEditLength).toHaveBeenCalledWith('sampler', 4, 3);
  });
});
