/**
 * PCF mode (#1586): the PCF key folds the filter plate and the patch bay into
 * the chassis stage over the current track, the rack stays mounted underneath,
 * and the master strip is a fixed footer. Drives the real ChassisNode with a
 * mocked app-state slice and a real PatchController.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ChassisNode } from '../../appParts/ChassisNode';
import { PatchBay } from '../../PatchBay';
import { PatchController, buildPreset, setActivePatchController } from '../../../audio/graph';
import type { TrackKey } from '../../../constants/appDefaults';

const app = vi.hoisted(() => ({
    selectedTrack: 'partA' as string,
    setSelectedTrack: vi.fn(),
}));

vi.mock('../../../contexts/AppStateContext', () => ({
    useAppStateSlice: () => ({
        selectedTrack: app.selectedTrack,
        setSelectedTrack: app.setSelectedTrack,
        synthA: { waveform: 'sawtooth', engine303: false },
        synthB: { waveform: 'square', engine303: false },
        bass2: { waveform: 'sawtooth', engine303: true },
        activeSamplerBank: 0,
        ttsPhrases: ['', '', '', '', '', '', '', ''],
        handleTtsPhraseChange: vi.fn(),
        handleGenerateTTS: vi.fn(),
    }),
}));

vi.mock('../../../services/Supertonic', () => ({
    SupertonicService: {
        getInstance: () => ({
            isServiceReady: () => false,
            getStyle: () => null,
            updateStyleFromRaw: vi.fn(),
            purgeCache: vi.fn(),
        }),
    },
}));

function mountController(): PatchController {
    const preset = buildPreset('classic-electribe');
    const controller = new PatchController(preset, preset);
    act(() => setActivePatchController(controller));
    return controller;
}

function renderChassis(track: TrackKey = 'partA') {
    app.selectedTrack = track;
    const view = render(
        <ChassisNode
            isCompact={false}
            sequencer={<div data-testid="sequencer" />}
            rack={<input data-testid="rack" aria-label="rack" />}
            keyboard={<div data-testid="keyboard" />}
            master={<section data-testid="master-strip" aria-label="Master loudness" />}
        />,
    );
    const rerenderTrack = (next: TrackKey) => {
        app.selectedTrack = next;
        view.rerender(
            <ChassisNode
                isCompact={false}
                sequencer={<div data-testid="sequencer" />}
                rack={<input data-testid="rack" aria-label="rack" />}
                keyboard={<div data-testid="keyboard" />}
                master={<section data-testid="master-strip" aria-label="Master loudness" />}
            />,
        );
    };
    return { ...view, rerenderTrack };
}

const body = () => screen.getByRole('region', { name: /hardware chassis/i });

/** Graph node rects are identified by the label drawn next to them. */
function graphNode(container: HTMLElement, label: string): Element {
    const rect = [...container.querySelectorAll('rect')].find((r) => r.nextElementSibling?.textContent === label);
    if (!rect) throw new Error(`no graph node "${label}"`);
    return rect;
}

describe('chassis PCF mode (#1586)', () => {
    beforeEach(() => {
        app.setSelectedTrack.mockClear();
        setActivePatchController(null);
    });
    afterEach(() => setActivePatchController(null));

    it('the PCF key is live and opens the filter plate with the patch bay beside it', () => {
        mountController();
        renderChassis();
        expect(body()).toHaveAttribute('data-chassis-mode', 'osc');
        expect(screen.queryByTestId('chassis-pcf-plate')).toBeNull();
        const rack = screen.getByTestId('rack');

        fireEvent.click(screen.getByTestId('chassis-mode-pcf'));
        expect(body()).toHaveAttribute('data-chassis-mode', 'pcf');
        expect(body().style.getPropertyValue('--chassis-stage-h')).toBe('320px');
        expect(screen.getByTestId('chassis-primary')).toContainElement(screen.getByTestId('chassis-pcf-plate'));
        const secondary = screen.getByTestId('chassis-secondary');
        expect(secondary).toHaveAttribute('data-placement', 'side');
        expect(secondary).toContainElement(screen.getByTestId('chassis-patch-deck'));
        expect(screen.getByRole('application', { name: /audio routing graph/i })).toBeInTheDocument();
        expect(screen.getByTestId('chassis-mode-badge')).toHaveTextContent('Master PCF');
        // PCF is a panel mode: it selects no track.
        expect(app.setSelectedTrack).not.toHaveBeenCalled();

        // The rack stays mounted (hidden), so it does not remount on return.
        expect(screen.getByTestId('chassis-rack')).toHaveAttribute('hidden');
        expect(screen.getByTestId('rack')).toBe(rack);

        fireEvent.click(screen.getByTestId('chassis-mode-osc'));
        expect(body()).toHaveAttribute('data-chassis-mode', 'osc');
        expect(screen.queryByTestId('chassis-pcf-plate')).toBeNull();
        expect(screen.queryByTestId('chassis-secondary')).toBeNull();
        expect(screen.getByTestId('chassis-rack')).not.toHaveAttribute('hidden');
        expect(screen.getByTestId('rack')).toBe(rack);
        expect(app.setSelectedTrack).not.toHaveBeenCalled();
    });

    it('selecting another track anywhere collapses the PCF panel back to that track', () => {
        mountController();
        const { rerenderTrack } = renderChassis('kick');
        fireEvent.click(screen.getByTestId('chassis-mode-pcf'));
        expect(body()).toHaveAttribute('data-chassis-mode', 'pcf');

        rerenderTrack('snare');
        expect(body()).toHaveAttribute('data-chassis-mode', 'drm');
        expect(screen.queryByTestId('chassis-pcf-plate')).toBeNull();

        // Returning to the track it was opened over does not reopen it.
        rerenderTrack('kick');
        expect(body()).toHaveAttribute('data-chassis-mode', 'drm');
    });

    it('drops the oscillator theme while the PCF plate owns the stage', () => {
        mountController();
        renderChassis('partA');
        expect(body()).toHaveAttribute('data-chassis-theme');
        fireEvent.click(screen.getByTestId('chassis-mode-pcf'));
        expect(body()).not.toHaveAttribute('data-chassis-theme');
    });

    it('the plate renders the PCF controls in their chassis skin and edits the patch', () => {
        const controller = mountController();
        renderChassis();
        fireEvent.click(screen.getByTestId('chassis-mode-pcf'));

        const panel = screen.getByTestId('pcf-panel');
        expect(panel).toHaveAttribute('data-surface', 'chassis');
        expect(screen.getByTestId('chassis-pcf-plate')).toContainElement(panel);
        // Chassis knobs replace the range sliders.
        expect(screen.getByRole('slider', { name: 'Cutoff' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Live PCF Cutoff')).toBeNull();
        // The master PCF is not running here: its song knobs are locked.
        expect(panel.querySelector('.hyphon-pcf-plate__knobs')).toHaveAttribute('data-disabled', 'true');

        // Filter mode is patch data, so it stays editable (staged).
        fireEvent.click(screen.getByRole('button', { name: 'openrb / ReBirth' }));
        expect(controller.getConfig().nodes.find((node) => node.factory === 'masterPcf')?.config)
            .toMatchObject({ filterMode: 'openrb' });
        expect(screen.getByRole('button', { name: 'openrb / ReBirth' })).toHaveAttribute('aria-pressed', 'true');

        // The patch bay beside it does not repeat the PCF controls.
        expect(screen.getAllByTestId('pcf-panel')).toHaveLength(1);
    });

    it('a PCF picked on the graph or on the plate keys moves the plate to it', () => {
        const controller = mountController();
        act(() => {
            controller.addNode({ id: 'pcf-1', factory: 'pcf', label: 'PCF 1' });
        });
        const { container } = renderChassis();
        fireEvent.click(screen.getByTestId('chassis-mode-pcf'));
        const plate = screen.getByTestId('chassis-pcf-plate');
        expect(plate).toHaveAttribute('data-pcf-node', 'masterPcf');

        fireEvent.mouseDown(graphNode(container, 'PCF 1'));
        expect(plate).toHaveAttribute('data-pcf-node', 'pcf-1');
        expect(screen.getByText('PCF · PCF 1')).toBeInTheDocument();
        expect(screen.getByTestId('chassis-mode-badge')).toHaveTextContent('PCF · pcf-1');

        const keys = screen.getByRole('group', { name: 'PCF node' });
        fireEvent.click(keys.querySelector('button')!);
        expect(plate).toHaveAttribute('data-pcf-node', 'masterPcf');

        // A placed PCF's knobs edit the saved patch even before it runs.
        fireEvent.mouseDown(graphNode(container, 'PCF 1'));
        fireEvent.click(screen.getByRole('button', { name: 'Filter type HP' }));
        expect(controller.getConfig().nodes.find((node) => node.id === 'pcf-1')?.config)
            .toMatchObject({ filterType: 'hp' });
    });

    it('waits for the audio engine without a patch controller', () => {
        renderChassis();
        fireEvent.click(screen.getByTestId('chassis-mode-pcf'));
        expect(screen.getByTestId('chassis-pcf-waiting')).toHaveTextContent(/waiting for audio engine/i);
    });

    it('hosts the master strip as a fixed footer under the key bed', () => {
        renderChassis();
        const footer = screen.getByTestId('chassis-footer');
        expect(footer).toContainElement(screen.getByTestId('master-strip'));
        fireEvent.click(screen.getByTestId('chassis-mode-pcf'));
        expect(screen.getByTestId('chassis-footer')).toBe(footer);
    });
});

describe('PatchBay chassis hooks (#1586)', () => {
    afterEach(() => setActivePatchController(null));

    it('reports PCF selections and can leave the PCF controls to the plate', () => {
        mountController();
        const onSelectPcfNode = vi.fn();
        const { container } = render(<PatchBay showPcfControls={false} onSelectPcfNode={onSelectPcfNode} />);
        fireEvent.mouseDown(graphNode(container, 'PCF'));
        expect(onSelectPcfNode).toHaveBeenCalledWith('masterPcf');
        expect(screen.queryByTestId('pcf-panel')).toBeNull();

        // Non-PCF nodes are not reported.
        fireEvent.mouseDown(graphNode(container, 'Saturation'));
        expect(onSelectPcfNode).toHaveBeenCalledTimes(1);
    });
});
