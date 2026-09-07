/**
 * The generic editor is the fallback when a plugin ships no UI, so a plugin that
 * ships nothing must still be fully operable — including by keyboard.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Wam2GenericEditor, wam2LaneParameter } from '../Wam2GenericEditor';
import type { WamHost } from '../../audio/wam/WamHost';
import type { Wam2PackageDescriptor } from '../../audio/wam/types';
import { WAM2_DEFAULT_PERMISSIONS } from '../../audio/wam/types';
import { automationStore } from '../../stores/automationStore';

const descriptor: Wam2PackageDescriptor = {
  id: 'hyphon.pulsar',
  version: '1.0.0',
  kind: 'instrument',
  title: 'Pulsar',
  vendor: 'Hyphon Community',
  license: 'MIT',
  origin: 'community',
  params: [
    { id: 'cutoff', label: 'Cutoff', min: 80, max: 12000, defaultValue: 2400 },
    { id: 'gain', label: 'Gain', min: 0, max: 1, defaultValue: 0.7 },
  ],
  integrity: { alg: 'sha256', value: 'abc' },
  offline: 'unsupported',
  isolation: 'audio-graph-slot',
  permissions: WAM2_DEFAULT_PERMISSIONS,
  capabilities: ['audio', 'midi', 'automation'],
};

function makeHost() {
  const values = new Map<string, number>([
    ['cutoff', 2400],
    ['gain', 0.7],
  ]);
  return {
    setParam: vi.fn((_slot: string, paramId: string, value: number) => {
      values.set(paramId, value);
    }),
    getParam: vi.fn((_slot: string, paramId: string) => values.get(paramId) ?? null),
    capturePreset: vi.fn(() => ({
      packageId: descriptor.id,
      version: descriptor.version,
      paramState: Object.fromEntries(values),
    })),
    applyPreset: vi.fn(() => true),
  } as unknown as WamHost;
}

beforeEach(() => {
  automationStore.importLanes([]);
  globalThis.localStorage?.clear();
});

describe('Wam2GenericEditor', () => {
  it('builds its controls from the descriptor', () => {
    render(<Wam2GenericEditor host={makeHost()} slotId="slot-1" descriptor={descriptor} />);
    expect(screen.getByRole('slider', { name: 'Cutoff' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Gain' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Cutoff value' })).toBeInTheDocument();
  });

  it('labels every control — no orphan inputs', () => {
    const { container } = render(
      <Wam2GenericEditor host={makeHost()} slotId="slot-1" descriptor={descriptor} />,
    );
    for (const input of container.querySelectorAll('input')) {
      const labelled =
        input.getAttribute('aria-label') ||
        (input.id && container.querySelector(`label[for="${input.id}"]`));
      expect(labelled, `input ${input.outerHTML} has no accessible name`).toBeTruthy();
    }
  });

  it('puts every control in the tab order, in visual order', async () => {
    const user = userEvent.setup();
    render(<Wam2GenericEditor host={makeHost()} slotId="slot-1" descriptor={descriptor} />);

    // No custom key handling and no tabindex juggling: each param row is
    // slider → number → Automate, all natively focusable.
    await user.tab();
    expect(screen.getByRole('slider', { name: 'Cutoff' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('spinbutton', { name: 'Cutoff value' })).toHaveFocus();
    await user.tab();
    expect(screen.getAllByRole('button', { name: 'Automate' })[0]).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('slider', { name: 'Gain' })).toHaveFocus();
  });

  it('sets the param from keyboard entry alone', async () => {
    // The number input is here precisely so a keyboard or screen-reader user can
    // set an exact value; a range input alone is poor for that. (jsdom does not
    // implement arrow-key stepping on range inputs, so the slider's own key
    // behaviour is the browser's to provide, not ours to assert.)
    const user = userEvent.setup();
    const host = makeHost();
    render(<Wam2GenericEditor host={host} slotId="slot-1" descriptor={descriptor} />);

    const spin = screen.getByRole('spinbutton', { name: 'Cutoff value' });
    await user.clear(spin);
    await user.type(spin, '5000');
    expect(host.setParam).toHaveBeenLastCalledWith('slot-1', 'cutoff', 5000);
  });

  it('lets an out-of-range prefix be typed, then clamps on commit', async () => {
    // Typing "5000" passes through "5", which is below this param's min of 80.
    // Clamping per keystroke would rewrite the field to "80" mid-entry and make
    // the intended value untypeable, so the clamp waits for Enter/blur.
    const user = userEvent.setup();
    const host = makeHost();
    render(<Wam2GenericEditor host={host} slotId="slot-1" descriptor={descriptor} />);
    const spin = screen.getByRole('spinbutton', { name: 'Cutoff value' });

    await user.clear(spin);
    await user.type(spin, '5');
    expect(spin).toHaveValue(5);
    await user.type(spin, '000');
    expect(host.setParam).toHaveBeenLastCalledWith('slot-1', 'cutoff', 5000);

    await user.clear(spin);
    await user.type(spin, '99999{Enter}');
    expect(host.setParam).toHaveBeenLastCalledWith('slot-1', 'cutoff', 12000);
  });

  it('creates an automation lane on the existing wam target', async () => {
    const user = userEvent.setup();
    render(<Wam2GenericEditor host={makeHost()} slotId="slot-1" descriptor={descriptor} />);
    await user.click(screen.getAllByRole('button', { name: 'Automate' })[0]);

    const lanes = automationStore.getState().lanes;
    expect(lanes).toHaveLength(1);
    expect(lanes[0].target).toBe('wam');
    expect(lanes[0].parameter).toBe(wam2LaneParameter('slot-1', 'cutoff'));
    expect(lanes[0].originalRange).toEqual([80, 12000]);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Automation lane created for Cutoff'),
    );
  });

  it('does not create a duplicate lane for the same param', async () => {
    const user = userEvent.setup();
    render(<Wam2GenericEditor host={makeHost()} slotId="slot-1" descriptor={descriptor} />);
    const automate = screen.getAllByRole('button', { name: 'Automate' })[0];
    await user.click(automate);
    await user.click(automate);
    expect(automationStore.getState().lanes).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('already exists'));
  });

  it('round-trips a preset', async () => {
    const user = userEvent.setup();
    const host = makeHost();
    render(<Wam2GenericEditor host={host} slotId="slot-1" descriptor={descriptor} />);

    await user.type(screen.getByRole('textbox', { name: 'Preset name' }), 'Bright');
    await user.click(screen.getByRole('button', { name: 'Save preset' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved preset "Bright"'));

    const list = screen.getByRole('list', { name: 'Saved presets' });
    expect(list).toHaveTextContent('Bright');
    await user.click(screen.getByRole('button', { name: 'Load' }));
    expect(host.applyPreset).toHaveBeenCalled();
  });

  it('shows the freeze-unsupported badge for a community package', () => {
    render(<Wam2GenericEditor host={makeHost()} slotId="slot-1" descriptor={descriptor} />);
    expect(screen.getByText('no freeze')).toBeInTheDocument();
  });

  it('omits the badge for a fixture that freezes natively', () => {
    render(
      <Wam2GenericEditor
        host={makeHost()}
        slotId="slot-1"
        descriptor={{ ...descriptor, origin: 'bundled', offline: 'native' }}
      />,
    );
    expect(screen.queryByText('no freeze')).not.toBeInTheDocument();
  });

  it('says so when a plugin declares no params', () => {
    render(
      <Wam2GenericEditor
        host={makeHost()}
        slotId="slot-1"
        descriptor={{ ...descriptor, params: [] }}
      />,
    );
    expect(screen.getByText(/declares no automatable parameters/)).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });
});
