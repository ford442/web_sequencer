import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SessionLauncher } from '../SessionLauncher';
import { createDefaultSessionDocument } from '../../session/defaults';
import { TRACK_KEYS } from '../../constants';
import type { TrackKey } from '../../constants/appDefaults';
import type { SessionDocument } from '../../session/types';

const emptyPlaying = () => {
  const m = {} as Record<TrackKey, number | null>;
  for (const t of TRACK_KEYS) m[t] = null;
  return m;
};

describe('SessionLauncher accessibility', () => {
  const doc = createDefaultSessionDocument();
  doc.columns.kick.clips[0].empty = false;
  doc.columns.kick.clips[0].name = 'Kick A';

  const props = {
    isVisible: true,
    document: doc,
    playingSlots: emptyPlaying(),
    currentStep: 0,
    isCapturing: false,
    quantization: 'bar' as const,
    onClose: vi.fn(),
    onLaunchClip: vi.fn(),
    onLaunchScene: vi.fn(),
    onStopTrack: vi.fn(),
    onStopAll: vi.fn(),
    onSetQuantization: vi.fn(),
    onBeginCapture: vi.fn(),
    onFinishCapture: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    canUndo: false,
    canRedo: false,
    onLoadPack: vi.fn(),
    onUpdateDocument: vi.fn(),
  };

  it('exposes a labeled grid and launches a scene with Enter', () => {
    render(<SessionLauncher {...props} />);
    expect(screen.getByRole('grid', { name: 'Clip launcher' })).toBeTruthy();
    const scene = screen.getByTestId('session-scene-0');
    act(() => {
      scene.focus();
      fireEvent.keyDown(scene, { key: 'Enter' });
    });
    expect(props.onLaunchScene).toHaveBeenCalledWith(0);
  });

  it('launches a clip from a grid cell', () => {
    render(<SessionLauncher {...props} />);
    fireEvent.click(screen.getByTestId('session-clip-kick-0'));
    expect(props.onLaunchClip).toHaveBeenCalledWith('kick', 0);
  });
  it('renders an empty state when rowCount is 0', () => {
    // Empty document with no rows
    const columns = {} as SessionDocument['columns'];
    for (const t of TRACK_KEYS) columns[t] = { track: t, clips: [] };
    const emptyDoc: SessionDocument = { ...props.document, columns, scenes: [] };

    render(
      <SessionLauncher
        {...props}
        document={emptyDoc}
      />
    );
    expect(screen.getByText('No clips in session')).toBeInTheDocument();
    expect(screen.getByText(/Your session is empty/)).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });
});
