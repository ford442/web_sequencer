import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SamplerVoicePanel } from '../../SamplerVoicePanel';
import { PlainRack } from '../PlainRack';
import { InlinePanelsContext } from '../inlinePanelsContext';

// The knob rack is irrelevant here: only where the sampler content is placed.
vi.mock('../../HardwareModule', () => ({
    HardwareModule: ({ children }: { children?: ReactNode }) => (
        <div data-testid="hardware-module">{children}</div>
    ),
}));

function panel(children: ReactNode = <div data-testid="sampler-content">TTS · GEN</div>) {
    return (
        <SamplerVoicePanel title="SAMPLER" colorHex={[0.6, 0.3, 1]} controls={[]} onParamChange={vi.fn()}>
            {children}
        </SamplerVoicePanel>
    );
}

/**
 * The plain rack shell is a fixed 380px box. The sampler panel (bank selector,
 * slicing, TTS phrase + GEN, voice editor) was an absolute overlay capped at
 * 38% of the knob module (about 80px of a 2100px panel), so it sat in a tiny
 * scroll window and the TTS controls were effectively invisible.
 */
describe('SamplerVoicePanel in the plain rack', () => {
    it('docks the sampler content in flow, outside the knob module, and asks the shell to expand', () => {
        const { container } = render(<PlainRack>{panel()}</PlainRack>);

        const dock = screen.getByTestId('sampler-dock');
        expect(within(dock).getByTestId('sampler-content')).toBeTruthy();
        expect(within(screen.getByTestId('hardware-module')).queryByTestId('sampler-content')).toBeNull();
        // The expand marker the shell's :has() rule keys on.
        expect(container.querySelector('[data-rack-expand]')).not.toBeNull();
        // Not the capped overlay.
        expect(container.innerHTML).not.toContain('max-h-[38%]');
    });

    it('keeps the capped overlay inside the knob module everywhere else (showcases, non-docking chassis modes)', () => {
        const { container } = render(panel());

        expect(screen.queryByTestId('sampler-dock')).toBeNull();
        expect(container.querySelector('[data-rack-expand]')).toBeNull();
        const overlay = within(screen.getByTestId('hardware-module')).getByTestId('sampler-content');
        expect(overlay.parentElement?.className).toContain('max-h-[38%]');
    });

    it('does not ask the shell to expand when there is nothing to dock', () => {
        const { container } = render(
            <PlainRack>
                <SamplerVoicePanel title="SAMPLER" colorHex={[0.6, 0.3, 1]} controls={[]} onParamChange={vi.fn()} />
            </PlainRack>,
        );
        expect(screen.queryByTestId('sampler-dock')).toBeNull();
        expect(container.querySelector('[data-rack-expand]')).toBeNull();
    });

    it('docks the same way when a chassis sampler view provides InlinePanelsContext', () => {
        const { container, rerender } = render(
            <InlinePanelsContext.Provider value>{panel()}</InlinePanelsContext.Provider>,
        );
        expect(within(screen.getByTestId('sampler-dock')).getByTestId('sampler-content')).toBeTruthy();
        expect(container.querySelector('[data-rack-expand]')).not.toBeNull();

        // Other chassis modes (OSC / DRM) provide false: the capped overlay stays.
        rerender(<InlinePanelsContext.Provider value={false}>{panel()}</InlinePanelsContext.Provider>);
        expect(screen.queryByTestId('sampler-dock')).toBeNull();
    });
});
