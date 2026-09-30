import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AISongModal } from '../AISongModal';
import { vi } from 'vitest';

// We just mock the audio engine out so we can render
const mockAudioEngine = {} as any;

describe('AISongModal A11y', () => {
  it('manages focus and keyboard navigation for tabs', async () => {
    render(
      <AISongModal
        isOpen={true}
        onClose={vi.fn()}
        onImport={vi.fn()}
        onShowToast={vi.fn()}
        audioEngine={mockAudioEngine}
      />
    );

    // Get the tabs container and individual tabs
    const tablist = screen.getByRole('tablist', { name: /Import method/i });
    const pasteTab = screen.getByRole('tab', { name: /Paste JSON/i });
    const templateTab = screen.getByRole('tab', { name: /Template/i });
    const previewTab = screen.getByRole('tab', { name: /Preview/i });

    // Initially, paste is active (tabIndex 0)
    expect(pasteTab).toHaveAttribute('tabIndex', '0');
    expect(templateTab).toHaveAttribute('tabIndex', '-1');

    // Press ArrowRight on the tablist
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });

    // Wait for the state update
    await waitFor(() => {
        expect(templateTab).toHaveAttribute('tabIndex', '0');
    });

    // Press ArrowRight again. Since JSON is invalid, preview is disabled.
    // It should skip preview and go back to Paste (wrap around).
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });

    await waitFor(() => {
        expect(pasteTab).toHaveAttribute('tabIndex', '0');
    });
  });
});
