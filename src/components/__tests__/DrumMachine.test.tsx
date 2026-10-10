import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DrumMachine } from '../DrumMachine';
import type { AllDrumParams } from '../../types';

const defaultParams: AllDrumParams = {
  kick: { pitch: 50, decay: 0.5, tone: 0.5, volume: 1.0 },
  snare: { decay: 0.2, tone: 200, noise: 5000, volume: 1.0 },
  closedHat: { decay: 0.05, pitch: 8000, volume: 1.0 },
  openHat: { decay: 0.5, pitch: 8000, volume: 1.0 }
};

describe('DrumMachine', () => {
  it('renders correctly and respects drumKit selection', async () => {
    const onDrumKitChange = vi.fn();
    const onParamsChange = vi.fn();
    const { rerender } = render(
      <DrumMachine params={defaultParams} onParamsChange={onParamsChange} drumKit="808" onDrumKitChange={onDrumKitChange} />
    );

    const btn808 = screen.getByRole('radio', { name: 'TR-808 Kit' });
    const btn909 = screen.getByRole('radio', { name: 'TR-909 Kit' });

    expect(btn808).toHaveAttribute('aria-checked', 'true');
    expect(btn808).toHaveAttribute('tabindex', '0');
    expect(btn909).toHaveAttribute('aria-checked', 'false');
    expect(btn909).toHaveAttribute('tabindex', '-1');

    // ArrowRight on 808 should request 909
    btn808.focus();
    fireEvent.keyDown(btn808, { key: 'ArrowRight', code: 'ArrowRight' });
    expect(onDrumKitChange).toHaveBeenCalledWith('909');

    // Simulate prop update
    rerender(
      <DrumMachine params={defaultParams} onParamsChange={onParamsChange} drumKit="909" onDrumKitChange={onDrumKitChange} />
    );

    // Wait for the timeout to shift focus
    await waitFor(() => {
      expect(document.activeElement).toBe(btn909);
    });

    expect(btn808).toHaveAttribute('aria-checked', 'false');
    expect(btn808).toHaveAttribute('tabindex', '-1');
    expect(btn909).toHaveAttribute('aria-checked', 'true');
    expect(btn909).toHaveAttribute('tabindex', '0');

    // ArrowLeft on 909 should request 808
    fireEvent.keyDown(btn909, { key: 'ArrowLeft', code: 'ArrowLeft' });
    expect(onDrumKitChange).toHaveBeenCalledWith('808');

    rerender(
      <DrumMachine params={defaultParams} onParamsChange={onParamsChange} drumKit="808" onDrumKitChange={onDrumKitChange} />
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(btn808);
    });
    expect(btn808).toHaveAttribute('aria-checked', 'true');
  });
});
