/**
 * Patch bay editor: renders the live config, patches cables through the
 * controller, and surfaces refusals instead of dropping them silently.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

import { PatchBay } from '../PatchBay';
import {
    PatchController,
    buildPreset,
    setActivePatchController,
} from '../../audio/graph';

function mountWithController(): PatchController {
    const preset = buildPreset('classic-electribe');
    const controller = new PatchController(preset, preset);
    act(() => setActivePatchController(controller));
    return controller;
}

/** Ports are labelled "<label> output" / "<label> input" for hit-testing. */
function port(name: string): Element {
    return screen.getByLabelText(name);
}

describe('PatchBay', () => {
    beforeEach(() => setActivePatchController(null));
    afterEach(() => setActivePatchController(null));

    it('waits for the audio engine before showing a canvas', () => {
        render(<PatchBay />);
        expect(screen.getByText(/waiting for audio engine/i)).toBeInTheDocument();
        expect(screen.queryByRole('application')).not.toBeInTheDocument();
    });

    it('renders a node per graph node and a cable per edge', () => {
        const controller = mountWithController();
        const { container } = render(<PatchBay />);

        expect(screen.getByRole('application', { name: /audio routing graph/i })).toBeInTheDocument();
        expect(screen.getByText('Saturation')).toBeInTheDocument();
        expect(screen.getByText('Reverb Plate')).toBeInTheDocument();

        const config = controller.getConfig();
        // Two paths per cable: an invisible hit target plus the visible stroke.
        const cables = container.querySelectorAll('path');
        expect(cables.length).toBe(config.edges.length * 2);
    });

    it('patches a send by dragging an output port onto an input port', () => {
        const controller = mountWithController();
        render(<PatchBay />);

        fireEvent.mouseDown(port('Synth A output'));
        fireEvent.mouseUp(port('Reverb Plate input'));

        const edge = controller
            .getConfig()
            .edges.find((candidate) => candidate.from === 'synthABus' && candidate.to === 'reverbPlate');
        expect(edge).toBeDefined();
        // New cables are sends, so they land with a rideable level.
        expect(edge?.gain).toBeGreaterThan(0);
        expect(edge?.gain).toBeLessThan(1);
    });

    it('shows why a cable was refused', () => {
        mountWithController();
        render(<PatchBay />);

        // Master pan back into master gain would loop the master bus.
        fireEvent.mouseDown(port('Master Pan output'));
        fireEvent.mouseUp(port('Master Gain input'));

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(/feedback loop/i);

        fireEvent.click(screen.getByText('Dismiss'));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('ignores a cable dropped back onto its own node', () => {
        const controller = mountWithController();
        render(<PatchBay />);
        const before = controller.getConfig().edges.length;

        fireEvent.mouseDown(port('Delay output'));
        fireEvent.mouseUp(port('Delay input'));

        expect(controller.getConfig().edges).toHaveLength(before);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('selects a cable to ride its level and unpatch it', () => {
        const controller = mountWithController();
        const { container } = render(<PatchBay />);

        fireEvent.mouseDown(port('Synth A output'));
        fireEvent.mouseUp(port('Reverb Plate input'));

        // Click the hit target of the cable that was just patched (last pair).
        const paths = container.querySelectorAll('path');
        fireEvent.click(paths[paths.length - 2]);

        const slider = screen.getByLabelText('Send level synthABus to reverbPlate');
        fireEvent.change(slider, { target: { value: '0.75' } });
        expect(
            controller.getConfig().edges.find((e) => e.from === 'synthABus' && e.to === 'reverbPlate')
                ?.gain,
        ).toBeCloseTo(0.75, 5);

        fireEvent.click(screen.getByText('Unpatch'));
        expect(
            controller.getConfig().edges.some((e) => e.from === 'synthABus' && e.to === 'reverbPlate'),
        ).toBe(false);
    });

    it('warns when staged edits need an engine restart', () => {
        const controller = mountWithController();
        render(<PatchBay />);
        expect(screen.queryByText(/next engine restart/i)).not.toBeInTheDocument();

        // No live graph attached, so a new cable can only be staged.
        act(() => {
            controller.connect('synthABus', 'reverbHall', 0.4);
        });
        expect(screen.getByText(/next engine restart/i)).toBeInTheDocument();
    });
});
