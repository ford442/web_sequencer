/**
 * The Engine HUD's per-slot "Edit" opens the generic WAM2 editor
 * (docs/adr/0001-wam2-host.md#generic-editor): the descriptor's params become
 * real controls bound to the slot, and the panel closes cleanly.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeWam2Editor, openWam2Editor } from '../openWam2Editor';
import type { WamHost } from '../../audio/wam/WamHost';
import type { Wam2PackageDescriptor } from '../../audio/wam/types';
import { WAM2_DEFAULT_PERMISSIONS } from '../../audio/wam/types';

const descriptor: Wam2PackageDescriptor = {
  id: 'hyphon.gain',
  version: '1.0.0',
  kind: 'effect',
  title: 'Gain',
  vendor: 'Hyphon',
  license: 'MIT',
  origin: 'bundled',
  params: [{ id: 'gain', label: 'Gain', min: 0, max: 1, defaultValue: 0.5 }],
  integrity: { alg: 'sha256', value: 'abc' },
  offline: 'native',
  isolation: 'audio-graph-slot',
  permissions: WAM2_DEFAULT_PERMISSIONS,
  capabilities: ['audio', 'automation'],
};

function makeHost(mounted: Record<string, Wam2PackageDescriptor>) {
  const setParam = vi.fn();
  const host = {
    getSlotDescriptor: vi.fn((slotId: string) => mounted[slotId] ?? null),
    getParam: vi.fn(() => 0.5),
    setParam,
  } as unknown as WamHost;
  return { host, setParam };
}

afterEach(() => {
  act(() => closeWam2Editor());
});

describe('Wam2EditorPanel', () => {
  it('opens the generic editor for a mounted slot and drives the host', () => {
    const { host, setParam } = makeHost({ 'slot-1': descriptor });
    act(() => openWam2Editor(host, 'slot-1'));

    expect(screen.getByRole('dialog', { name: 'WAM2 slot slot-1' })).toBeTruthy();
    const slider = screen.getByRole('slider', { name: /Gain/ });
    fireEvent.change(slider, { target: { value: '0.25' } });
    expect(setParam).toHaveBeenCalledWith('slot-1', 'gain', 0.25);
  });

  it('says so when the slot is not mounted', () => {
    act(() => openWam2Editor(makeHost({}).host, 'gone'));
    expect(screen.getByRole('status').textContent).toContain('gone is not mounted');
  });

  it('closes from the button and from Escape', () => {
    const { host } = makeHost({ 'slot-1': descriptor });
    act(() => openWam2Editor(host, 'slot-1'));
    act(() => screen.getByRole('button', { name: 'Close WAM2 editor' }).click());
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => openWam2Editor(host, 'slot-1'));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
