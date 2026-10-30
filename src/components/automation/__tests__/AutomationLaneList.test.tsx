import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { AutomationLaneList } from '../AutomationLaneList';
import { useAutomationStore } from '../../../stores/automationStore';

vi.mock('../../../stores/automationStore', () => {
  const toggleLaneEnabledMock = vi.fn();
  const removeLaneMock = vi.fn();
  const updateLaneInterpolationMock = vi.fn();
  const addLaneMock = vi.fn();

  return {
    useAutomationStore: vi.fn(),
    generateLaneId: vi.fn(() => 'test-lane-id'),
    automationStore: {
      toggleLaneEnabled: toggleLaneEnabledMock,
      removeLane: removeLaneMock,
      updateLaneInterpolation: updateLaneInterpolationMock,
      addLane: addLaneMock
    },
  };
});

describe('AutomationLaneList', () => {
  const onSelectLaneMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with empty state', () => {
    vi.mocked(useAutomationStore).mockReturnValue({
      lanes: [],
    } as any);

    render(<AutomationLaneList selectedLaneId={undefined} onSelectLane={onSelectLaneMock} />);

    expect(screen.getByText('No automation lanes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Example Automation Lane' })).toBeInTheDocument();
  });

  it('renders lanes correctly with proper roles and attributes', () => {
    const mockLanes = [
      {
        id: 'lane1',
        name: 'Lane 1',
        target: 'sampler',
        parameter: 'cutoff',
        enabled: true,
        points: [],
        interpolation: 'linear',
        source: 'recorded',
      },
      {
        id: 'lane2',
        name: 'Lane 2',
        target: 'synth',
        parameter: 'volume',
        enabled: false,
        points: [],
        interpolation: 'smooth',
        source: 'ai',
      }
    ];

    vi.mocked(useAutomationStore).mockReturnValue({
      lanes: mockLanes,
    } as any);

    render(<AutomationLaneList selectedLaneId="lane1" onSelectLane={onSelectLaneMock} />);

    const listbox = screen.getByRole('listbox', { name: 'Automation Lanes' });
    expect(listbox).toBeInTheDocument();

    const options = screen.getAllByRole('option', { hidden: false }).filter(el => el.tagName === 'DIV');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(2);
    expect(switches[0]).toHaveAttribute('aria-checked', 'true');
    expect(switches[1]).toHaveAttribute('aria-checked', 'false');
  });

  it('handles keyboard navigation preventing bubbling from nested elements', () => {
    const mockLanes = [
      {
        id: 'lane1',
        name: 'Lane 1',
        target: 'sampler',
        parameter: 'cutoff',
        enabled: true,
        points: [],
        interpolation: 'linear',
        source: 'recorded',
      }
    ];

    vi.mocked(useAutomationStore).mockReturnValue({
      lanes: mockLanes,
    } as any);

    render(<AutomationLaneList selectedLaneId={undefined} onSelectLane={onSelectLaneMock} />);

    const option = screen.getAllByRole('option', { hidden: false }).find(el => el.tagName === 'DIV')!;
    const switchBtn = screen.getByRole('switch');

    // Test pressing Enter on the row itself
    fireEvent.keyDown(option, { key: 'Enter', code: 'Enter', bubbles: true });
    expect(onSelectLaneMock).toHaveBeenCalledWith('lane1');
    onSelectLaneMock.mockClear();

    // Test pressing Enter on the switch button inside the row
    fireEvent.keyDown(switchBtn, { key: 'Enter', code: 'Enter', bubbles: true });
    // Selection should NOT happen due to e.target !== e.currentTarget check
    expect(onSelectLaneMock).not.toHaveBeenCalled();
  });
});
