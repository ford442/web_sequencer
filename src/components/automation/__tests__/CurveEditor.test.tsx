import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CurveEditor } from '../CurveEditor';
import type { UnifiedAutomationLane } from '../../../types';

// Mock WebGPU since it is not available in JSDOM
beforeEach(() => {
  // @ts-ignore
  if (!global.navigator) {
    global.navigator = {} as any;
  }
  // Ensure navigator.gpu is explicitly undefined
  // @ts-ignore
  delete global.navigator.gpu;
});

describe('CurveEditor', () => {
  const mockLane: UnifiedAutomationLane = {
    id: 'lane-1',
    target: 'synthA',
    parameter: 'filterCutoff',
    name: 'Synth A Cutoff',
    interpolation: 'linear',
    points: [
      { step: 0, value: 0.2 },
      { step: 16, value: 0.8 },
      { step: 32, value: 0.5 },
    ],
  };

  it('renders the SVG fallback when WebGPU is unavailable', () => {
    const { container } = render(<CurveEditor lane={mockLane} totalSteps={32} />);

    // Check if the SVG element is present
    const svgElement = container.querySelector('svg');
    expect(svgElement).toBeInTheDocument();

    // Check if the SVG curve path is rendered
    const fallbackGroup = container.querySelector('.webgpu-fallback-svg');
    expect(fallbackGroup).toBeInTheDocument();

    const path = fallbackGroup?.querySelector('path');
    expect(path).toBeInTheDocument();

    // Points should be rendered
    const points = container.querySelectorAll('.curve-point');
    expect(points.length).toBe(3);
  });
});
