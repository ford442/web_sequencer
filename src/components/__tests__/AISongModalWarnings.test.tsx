import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AISongModal } from '../AISongModal';
import minimal from '../../../test-fixtures/ai-song/minimal.json';

const kickLane = {
  target: 'kick',
  parameter: 'decay',
  steps: Array.from({ length: 16 }, (_, i) => i * 8),
  interpolation: 'linear',
};

function renderModal() {
  return render(
    <AISongModal isOpen={true} onClose={vi.fn()} onImport={vi.fn()} onShowToast={vi.fn()} audioEngine={{}} />,
  );
}

function paste(song: object) {
  const textarea = screen.getByLabelText(/Or paste JSON directly/i);
  fireEvent.change(textarea, { target: { value: JSON.stringify(song) } });
}

describe('AISongModal — import warnings', () => {
  it('lists what the importer saved but nothing will play', async () => {
    renderModal();
    paste({ ...minimal, automation: [kickLane] });

    const warnings = await screen.findByTestId('ai-song-import-warnings', undefined, { timeout: 3000 });
    expect(warnings).toHaveTextContent('1 import warning');
    expect(warnings).toHaveTextContent('automation[0] kick.decay is saved but never plays');
    // The song is still valid and importable.
    expect(screen.getByText('Valid AI Song')).toBeInTheDocument();
  });

  it('shows no warnings block for a song that plays everything it says', async () => {
    renderModal();
    paste(minimal);
    await screen.findByText('Valid AI Song', undefined, { timeout: 3000 });
    await waitFor(() => expect(screen.queryByTestId('ai-song-import-warnings')).toBeNull());
  });
});
